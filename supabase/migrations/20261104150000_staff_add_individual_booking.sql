-- Staff can add a truly individual, separately paid 50 EUR lesson for a
-- registered rider or guest, even when they have no subscription.
-- The whole change (slot capacity + booking) is atomic.
CREATE OR REPLACE FUNCTION public.staff_add_individual_booking(
  _slot_date date,
  _slot_time time without time zone,
  _user_id uuid DEFAULT NULL,
  _guest_rider_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_slot public.time_slots%ROWTYPE;
  v_guest_name text;
  v_existing integer;
  v_booking_id uuid;
  v_previous_setting text;
BEGIN
  IF v_caller IS NULL OR NOT (
    public.has_role(v_caller, 'admin'::public.app_role)
    OR public.has_role(v_caller, 'trainer'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY' USING ERRCODE='insufficient_privilege';
  END IF;

  IF _slot_date IS NULL OR _slot_time IS NULL
     OR (_user_id IS NULL) = (_guest_rider_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_RIDER_OR_SLOT' USING ERRCODE='check_violation';
  END IF;

  SELECT * INTO v_slot
  FROM public.time_slots t
  WHERE t.active = true
    AND t.slot_time = _slot_time
    AND (
      t.one_off_date = _slot_date
      OR (t.one_off_date IS NULL AND t.day_of_week = extract(isodow from _slot_date)::integer)
    )
  ORDER BY (t.one_off_date IS NOT NULL) DESC, t.max_capacity DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND' USING ERRCODE='check_violation';
  END IF;

  IF _user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id
  ) THEN
    RAISE EXCEPTION 'RIDER_NOT_FOUND' USING ERRCODE='check_violation';
  END IF;

  IF _guest_rider_id IS NOT NULL THEN
    SELECT concat_ws(' ',g.first_name,g.last_name) INTO v_guest_name
    FROM public.guest_riders g WHERE g.id = _guest_rider_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'GUEST_RIDER_NOT_FOUND' USING ERRCODE='check_violation';
    END IF;
  END IF;

  -- Same advisory lock used by the booking capacity trigger.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-slot:' || _slot_date::text || ':' || _slot_time::text, 0)
  );
  SELECT count(*)::integer INTO v_existing
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'INDIVIDUAL_REQUIRES_EMPTY_SLOT' USING ERRCODE='check_violation';
  END IF;

  -- Reserve exactly one seat for this date/time. Unchanged recurring schedule.
  INSERT INTO public.slot_overrides (slot_date,slot_time,max_capacity)
  VALUES (_slot_date,_slot_time,1)
  ON CONFLICT (slot_date,slot_time)
  DO UPDATE SET max_capacity=1;

  -- The existing eligibility trigger normally requires a subscription.
  -- Reuse its narrowly scoped system-insert bypass only after staff validation,
  -- then restore its original value before returning. This permits a paid
  -- standalone individual lesson without granting a lifetime grace booking.
  v_previous_setting := current_setting('equus.allow_family_booking_insert', true);
  PERFORM set_config('equus.allow_family_booking_insert', 'true', true);
  BEGIN
    INSERT INTO public.bookings (
      user_id, guest_rider_id, is_guest, guest_name,
      slot_date, slot_time, trainer_name, status, created_by,
      is_individual, subscription_id, counts_in_subscription,
      is_grace_booking, extra_fee_eur, extra_fee_paid
    )
    VALUES (
      _user_id, _guest_rider_id, _guest_rider_id IS NOT NULL, v_guest_name,
      _slot_date, _slot_time, v_slot.trainer_name, 'active', v_caller,
      true, NULL, false, false, 50.00, false
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('equus.allow_family_booking_insert', COALESCE(v_previous_setting,''), true);
    RAISE;
  END;
  PERFORM set_config('equus.allow_family_booking_insert', COALESCE(v_previous_setting,''), true);

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'INDIVIDUAL_BOOKING_NOT_SAVED' USING ERRCODE='check_violation';
  END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id,
    'individual_price_eur', 50, 'slot_date', _slot_date, 'slot_time', _slot_time);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_add_individual_booking(date,time without time zone,uuid,uuid)
 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_add_individual_booking(date,time without time zone,uuid,uuid)
 TO authenticated;
