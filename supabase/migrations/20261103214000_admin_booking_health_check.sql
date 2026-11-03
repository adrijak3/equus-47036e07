-- Read-only dashboard diagnostic. Only admin JWTs may call this function.
-- No individual rider data is disclosed; no booking rows are modified.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_booking_health_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $health$
DECLARE v_from date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_to date := v_from + 45;
  v_duplicate_active integer;
  v_invalid_slot integer;
  v_exceeds_capacity integer;
  v_missing_cancel_exception integer;
  v_cancelled_active_overlap integer;
  v_horse_collision integer;
  v_unavailable_horse integer;
  v_bad_subscription integer;
  v_pending_cancellations integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_duplicate_active FROM (
    SELECT user_id, slot_date, slot_time FROM public.bookings
    WHERE user_id IS NOT NULL AND status='active' AND slot_date BETWEEN v_from AND v_to
    GROUP BY 1,2,3 HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO v_invalid_slot FROM public.bookings b
  WHERE b.status='active' AND b.slot_date BETWEEN v_from AND v_to
    AND NOT EXISTS (
      SELECT 1 FROM public.time_slots ts
      WHERE ts.active AND ts.slot_time=b.slot_time AND
        (ts.one_off_date=b.slot_date OR
          (ts.one_off_date IS NULL AND ts.day_of_week=extract(isodow from b.slot_date)::integer))
    );

  SELECT count(*) INTO v_exceeds_capacity FROM (
    SELECT b.slot_date,b.slot_time
    FROM public.bookings b
    WHERE b.slot_date BETWEEN v_from AND v_to
    GROUP BY 1,2
    HAVING count(*) FILTER (WHERE b.status='active' AND b.is_paused_for_subscription IS NOT TRUE)
       > public.equus_effective_slot_capacity(b.slot_date,b.slot_time)
  ) s;

  SELECT count(*) INTO v_missing_cancel_exception FROM public.bookings b
  JOIN public.permanent_slots ps ON ps.user_id=b.user_id AND ps.slot_time=b.slot_time
     AND ps.day_of_week=extract(isodow from b.slot_date)::integer
  LEFT JOIN public.permanent_booking_exceptions e ON e.user_id=b.user_id
     AND e.slot_date=b.slot_date AND e.slot_time=b.slot_time
  WHERE b.status='cancelled' AND b.slot_date BETWEEN v_from AND v_to AND e.user_id IS NULL;

  SELECT count(*) INTO v_cancelled_active_overlap FROM (
    SELECT user_id,slot_date,slot_time
    FROM public.bookings
    WHERE user_id IS NOT NULL AND slot_date BETWEEN v_from AND v_to
    GROUP BY user_id,slot_date,slot_time
    HAVING bool_or(status='cancelled') AND bool_or(status='active')
  ) x;

  SELECT count(*) INTO v_horse_collision FROM (
    SELECT slot_date,slot_time,horse_id FROM public.horse_assignments
    WHERE slot_date BETWEEN v_from AND v_to
    GROUP BY 1,2,3 HAVING count(*)>1
  ) x;

  SELECT count(*) INTO v_unavailable_horse FROM public.horse_assignments a
  JOIN public.horses h ON h.id=a.horse_id
  WHERE a.slot_date BETWEEN v_from AND v_to
    AND NOT (extract(isodow from a.slot_date)::integer = ANY(h.allowed_weekdays));

  SELECT count(*) INTO v_bad_subscription FROM public.subscriptions
  WHERE lessons_total < 0 OR lessons_used < 0 OR lessons_used > lessons_total;

  SELECT count(*) INTO v_pending_cancellations FROM public.cancellation_requests
  WHERE status='pending';

  RETURN jsonb_build_object(
    'checked_at',now(),'period_start',v_from,'period_end',v_to,
    'duplicate_active_rider_slots',v_duplicate_active,
    'active_bookings_without_active_slot',v_invalid_slot,
    'slots_over_capacity',v_exceeds_capacity,
    'cancelled_recurring_without_exception',v_missing_cancel_exception,
    'cancelled_and_active_same_rider_slot',v_cancelled_active_overlap,
    'horse_double_assignments',v_horse_collision,
    'horse_unavailable_day_assignments',v_unavailable_horse,
    'invalid_subscription_balances',v_bad_subscription,
    'pending_cancellation_requests',v_pending_cancellations);
END;
$health$;
REVOKE ALL ON FUNCTION public.admin_booking_health_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_booking_health_check() TO authenticated,service_role;
COMMIT;
