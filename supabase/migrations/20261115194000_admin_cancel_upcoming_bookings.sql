-- Admin can cancel pending, active, and confirmed/upcoming bookings without client-side RLS update surprises.
-- Historical completed attendance remains immutable; correction requires a separate audited workflow.
create or replace function public.admin_cancel_booking(_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_booking public.bookings%rowtype;
begin
  if v_actor is null or not public.has_role(v_actor,'admin'::public.app_role) then
    raise exception 'ADMIN_ONLY' using errcode='42501';
  end if;
  select * into v_booking from public.bookings
    where id=_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  if v_booking.status='cancelled'::public.booking_status then
    return jsonb_build_object('ok',true,'already_cancelled',true);
  end if;
  if v_booking.status='completed'::public.booking_status
     and v_booking.slot_date <= (now() at time zone 'Europe/Vilnius')::date then
    raise exception 'COMPLETED_LESSON_REQUIRES_FINANCIAL_CORRECTION';
  end if;
  update public.bookings set status='cancelled'::public.booking_status,
    counts_in_subscription=false
    where id=_booking_id;
  return jsonb_build_object('ok',true,'cancelled',true);
end;
$function$;
revoke all on function public.admin_cancel_booking(uuid) from public,anon;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;
