-- Fix: cancelled recurring bookings should not re-materialize
create or replace function public.materialize_permanent_bookings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ps record;
  d date;
  exists_any boolean;
begin
  for ps in select * from public.permanent_slots loop
    d := current_date;
    while d <= (current_date + interval '30 days') loop
      select exists (
        select 1 from public.bookings
        where user_id = ps.user_id
          and slot_date = d
          and slot_time = ps.slot_time
      ) into exists_any;

      if not exists_any then
        insert into public.bookings (user_id, slot_date, slot_time, status, source)
        values (ps.user_id, d, ps.slot_time, 'active', 'permanent');
      end if;

      d := d + interval '1 day';
    end loop;
  end loop;
end;
$$;
