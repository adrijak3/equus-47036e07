-- Self-service permanent weekly lesson requests and safe capacity checks.
create table if not exists public.permanent_slot_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  day_of_week int not null check (day_of_week between 1 and 7),
  slot_time time not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);

alter table public.permanent_slot_requests enable row level security;

drop policy if exists "users read own permanent requests" on public.permanent_slot_requests;
create policy "users read own permanent requests" on public.permanent_slot_requests for select using (auth.uid() = user_id or public.has_role(auth.uid(), 'admin'));
drop policy if exists "users create own permanent requests" on public.permanent_slot_requests;
create policy "users create own permanent requests" on public.permanent_slot_requests for insert with check (auth.uid() = user_id);
drop policy if exists "admins update permanent requests" on public.permanent_slot_requests;
create policy "admins update permanent requests" on public.permanent_slot_requests for update using (public.has_role(auth.uid(), 'admin'));

create or replace function public.request_or_create_permanent_slot(_day int, _time time)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  _uid uuid := auth.uid();
  _cap int;
  _existing int;
  _conflict record;
begin
  if _uid is null then raise exception 'Prisijunkite'; end if;
  select max_capacity into _cap from public.time_slots
   where active=true and one_off_date is null and day_of_week=_day and slot_time=_time limit 1;
  if _cap is null then return jsonb_build_object('ok',false,'message','Šio laiko grafike nėra.'); end if;
  if exists(select 1 from public.permanent_slots where user_id=_uid and day_of_week=_day and slot_time=_time) then
    return jsonb_build_object('ok',false,'message','Šį nuolatinį laiką jau turite.');
  end if;
  if _cap <= 2 then
    insert into public.permanent_slot_requests(user_id,day_of_week,slot_time)
    values(_uid,_day,_time);
    return jsonb_build_object('ok',true,'requested',true,'message','Prašymas išsiųstas administracijai.');
  end if;
  select count(*) into _existing from public.permanent_slots where day_of_week=_day and slot_time=_time;
  if _existing >= 5 then return jsonb_build_object('ok',false,'message','Šis laikas jau turi 5 nuolatines vietas.'); end if;

  select b.slot_date, count(*) as taken into _conflict
  from public.bookings b
  where b.slot_time=_time and b.status in ('active','completed')
    and b.slot_date >= current_date
    and extract(isodow from b.slot_date::date)::int = _day
  group by b.slot_date
  having count(*) + 1 > coalesce((select so.max_capacity from public.slot_overrides so where so.slot_date=b.slot_date and so.slot_time=_time), _cap)
  order by b.slot_date limit 1;
  if found then return jsonb_build_object('ok',false,'message',format('Negalima pridėti: %s ši treniruotė jau būtų virš talpos.', _conflict.slot_date)); end if;

  insert into public.permanent_slots(user_id,day_of_week,slot_time) values(_uid,_day,_time);
  perform public.materialize_permanent_bookings(current_date, current_date + 120);
  return jsonb_build_object('ok',true,'requested',false,'message','Nuolatinis laikas pridėtas.');
end $$;

grant execute on function public.request_or_create_permanent_slot(int,time) to authenticated;

create or replace function public.decide_permanent_slot_request(_request_id uuid, _approve boolean, _note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.permanent_slot_requests%rowtype; _cap int; _existing int;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Tik administratorius'; end if;
  select * into r from public.permanent_slot_requests where id=_request_id and status='pending' for update;
  if not found then return jsonb_build_object('ok',false,'message','Prašymas neberastas.'); end if;
  if not _approve then
    update public.permanent_slot_requests set status='rejected',admin_note=_note,decided_at=now(),decided_by=auth.uid() where id=r.id;
    return jsonb_build_object('ok',true);
  end if;
  select max_capacity into _cap from public.time_slots where active=true and one_off_date is null and day_of_week=r.day_of_week and slot_time=r.slot_time limit 1;
  select count(*) into _existing from public.permanent_slots where day_of_week=r.day_of_week and slot_time=r.slot_time;
  if _existing >= 5 then return jsonb_build_object('ok',false,'message','Šis laikas jau turi 5 nuolatines vietas.'); end if;
  insert into public.permanent_slots(user_id,day_of_week,slot_time) values(r.user_id,r.day_of_week,r.slot_time) on conflict do nothing;
  update public.permanent_slot_requests set status='approved',admin_note=_note,decided_at=now(),decided_by=auth.uid() where id=r.id;
  perform public.materialize_permanent_bookings(current_date, current_date + 120);
  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.decide_permanent_slot_request(uuid,boolean,text) to authenticated;
