-- The schedule can show a recurring marker without revealing another rider's account ID.
create or replace function public.get_schedule_recurring_booking_ids_safe(
  _start_date date, _end_date date
)
returns table(booking_id uuid)
language plpgsql stable security definer
set search_path to ''
as $function$
begin
  if _start_date is null or _end_date is null
     or _end_date < _start_date or _end_date - _start_date > 31 then
    raise exception 'INVALID_SCHEDULE_RANGE';
  end if;

  return query
  select b.id
  from public.bookings b
  where b.slot_date between _start_date and _end_date
    and b.status in ('active'::public.booking_status,'completed'::public.booking_status)
    and b.user_id is not null
    and exists (
      select 1 from public.permanent_slots p
      where p.user_id=b.user_id
        and p.day_of_week=extract(isodow from b.slot_date)::integer
        and p.slot_time=b.slot_time
    );
end;
$function$;
revoke all on function public.get_schedule_recurring_booking_ids_safe(date,date) from public;
grant execute on function public.get_schedule_recurring_booking_ids_safe(date,date) to anon,authenticated;
