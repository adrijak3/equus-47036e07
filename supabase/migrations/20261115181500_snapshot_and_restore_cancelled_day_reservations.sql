-- Preserve exactly the day-cancelled bookings and their horse choices, and restore them on undo.
-- Existing individual cancellations are never included.
create table if not exists public.day_cancellation_booking_snapshots (
 note_date date not null,
 booking_id uuid not null references public.bookings(id) on delete cascade,
 trainer_name text,
 previous_counts_in_subscription boolean,
 previous_subscription_id uuid,
 previous_is_grace_booking boolean,
 horse_id uuid,
 horse_user_id uuid,
 horse_guest_name text,
 horse_assigned_by uuid,
 created_at timestamptz not null default now(),
 primary key(note_date,booking_id)
);
alter table public.day_cancellation_booking_snapshots enable row level security;
revoke all on public.day_cancellation_booking_snapshots from public,anon,authenticated;
create or replace function public.snapshot_day_cancellation_bookings()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
 insert into public.day_cancellation_booking_snapshots(
 note_date,booking_id,trainer_name,previous_counts_in_subscription,previous_subscription_id,
 previous_is_grace_booking,horse_id,horse_user_id,horse_guest_name,horse_assigned_by)
 select NEW.note_date,b.id,NEW.trainer_name,b.counts_in_subscription,b.subscription_id,b.is_grace_booking,
 h.horse_id,h.user_id,h.guest_name,h.assigned_by
 from public.bookings b left join public.horse_assignments h on h.booking_id=b.id
 where b.slot_date=NEW.note_date and b.status='active'::public.booking_status
 and (NEW.trainer_name is null or b.trainer_name=NEW.trainer_name)
 on conflict(note_date,booking_id) do nothing;
 return NEW;
end;
$function$;
drop trigger if exists trg_snapshot_day_cancellation_bookings on public.day_cancellations;
create trigger trg_snapshot_day_cancellation_bookings before insert on public.day_cancellations
for each row execute function public.snapshot_day_cancellation_bookings();
create or replace function public.on_day_cancellation_insert()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
 update public.bookings b
 set status='cancelled'::public.booking_status,counts_in_subscription=false
 where b.slot_date=NEW.note_date and b.status='active'::public.booking_status
 and (NEW.trainer_name is null or b.trainer_name=NEW.trainer_name);
 return NEW;
end;
$function$;
create or replace function public.restore_day_cancellation_bookings()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
 item record;
 restored_booking public.bookings%rowtype;
begin
 for item in select * from public.day_cancellation_booking_snapshots s
 where s.note_date=OLD.note_date and s.trainer_name is not distinct from OLD.trainer_name
 order by s.booking_id
 loop
 restored_booking := null;
 update public.bookings b
 set status='active'::public.booking_status,
     counts_in_subscription=item.previous_counts_in_subscription,
     subscription_id=item.previous_subscription_id,
     is_grace_booking=item.previous_is_grace_booking
 where b.id=item.booking_id and b.slot_date=OLD.note_date and b.status='cancelled'::public.booking_status
   and not exists (
     select 1 from public.day_cancellations other
     where other.note_date=OLD.note_date
       and (other.trainer_name is null or other.trainer_name=b.trainer_name))
 returning b.* into restored_booking;
 if restored_booking.id is not null and item.horse_id is not null then
  begin
   insert into public.horse_assignments(
     booking_id,user_id,guest_name,slot_date,slot_time,horse_id,assigned_by)
   select restored_booking.id,coalesce(item.horse_user_id,restored_booking.user_id),
     item.horse_guest_name,restored_booking.slot_date,restored_booking.slot_time,
     item.horse_id,item.horse_assigned_by
   where not exists(select 1 from public.horse_assignments h where h.booking_id=restored_booking.id)
   on conflict do nothing;
  exception when others then
   raise warning 'Unable to restore horse for booking %: %',restored_booking.id,sqlerrm;
  end;
 end if;
 end loop;
 delete from public.day_cancellation_booking_snapshots s
 where s.note_date=OLD.note_date and s.trainer_name is not distinct from OLD.trainer_name;
 return OLD;
end;
$function$;
drop trigger if exists trg_restore_day_cancellation_bookings on public.day_cancellations;
create trigger trg_restore_day_cancellation_bookings after delete on public.day_cancellations
for each row execute function public.restore_day_cancellation_bookings();
revoke all on function public.snapshot_day_cancellation_bookings() from public,anon,authenticated;
revoke all on function public.restore_day_cancellation_bookings() from public,anon,authenticated;
revoke all on function public.on_day_cancellation_insert() from public,anon,authenticated;
