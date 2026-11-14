-- Individual lessons should use a paid individual package whenever available.
-- Preserve standalone €50 bookings for guests and riders without an eligible package.
-- Completed lessons consume the reservation automatically; future lessons only reserve package capacity.

CREATE OR REPLACE FUNCTION public.staff_add_individual_booking(_slot_date date, _slot_time time without time zone, _user_id uuid DEFAULT NULL::uuid, _guest_rider_id uuid DEFAULT NULL::uuid)
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
  v_subscription_id uuid;
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

  -- Individual lessons use the rider's paid individual package by default.
  -- No package (or a guest) still gets a standalone 50 EUR booking.
  IF _user_id IS NOT NULL THEN
    SELECT s.id INTO v_subscription_id
      FROM public.subscriptions s
     WHERE s.user_id = _user_id
       AND s.paid IS TRUE
       AND s.cancelled_at IS NULL
       AND s.start_pending IS NOT TRUE
       AND s.package_type = 'individual'
       AND _slot_date BETWEEN s.start_from_date AND s.expires_at
       AND public.subscription_committed_lessons(s.id) < s.lessons_total
     ORDER BY s.start_from_date, s.purchase_date, s.id
     LIMIT 1
     FOR UPDATE OF s;
  END IF;

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
      true, v_subscription_id, (v_subscription_id IS NOT NULL), false,
      CASE WHEN v_subscription_id IS NOT NULL THEN 0.00 ELSE 50.00 END, false
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
$function$
;

CREATE OR REPLACE FUNCTION public.make_booking_individual(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  b public.bookings%ROWTYPE;
  active_count integer;
  old_subscription_id uuid;
  v_subscription_id uuid;
BEGIN
  IF caller IS NULL
     OR (
       NOT public.has_role(caller, 'admin')
       AND NOT public.has_role(caller, 'trainer')
     )
  THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT *
  INTO b
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF b.status <> 'active' THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE';
  END IF;

  IF b.is_guest THEN
    RAISE EXCEPTION 'GUEST_BOOKING_NOT_SUPPORTED';
  END IF;

  SELECT count(*)
  INTO active_count
  FROM public.bookings
  WHERE slot_date = b.slot_date
    AND slot_time = b.slot_time
    AND status = 'active';

  IF active_count > 1 THEN
    RAISE EXCEPTION 'INDIVIDUAL_REQUIRES_SINGLE_RIDER';
  END IF;

  -- Keep/use an eligible individual package instead of silently detaching it.
  -- Standalone pricing is the fallback only when no individual package fits.
  SELECT s.id INTO v_subscription_id
    FROM public.subscriptions s
   WHERE s.user_id = b.user_id
     AND s.paid IS TRUE
     AND s.cancelled_at IS NULL
     AND s.start_pending IS NOT TRUE
     AND s.package_type = 'individual'
     AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
     AND (
       s.id = b.subscription_id
       OR public.subscription_committed_lessons(s.id) < s.lessons_total
     )
   ORDER BY (s.id = b.subscription_id) DESC, s.start_from_date, s.purchase_date, s.id
   LIMIT 1
   FOR UPDATE OF s;

  old_subscription_id := b.subscription_id;

  UPDATE public.bookings
  SET
    is_individual = true,
    subscription_id = v_subscription_id,
    counts_in_subscription = (v_subscription_id IS NOT NULL),
    extra_fee_eur = CASE WHEN v_subscription_id IS NOT NULL THEN 0.00 ELSE 50.00 END,
    extra_fee_paid = false
  WHERE id = b.id;

  INSERT INTO public.slot_overrides (
    slot_date,
    slot_time,
    max_capacity
  )
  VALUES (
    b.slot_date,
    b.slot_time,
    1
  )
  ON CONFLICT (slot_date, slot_time)
  DO UPDATE SET max_capacity = 1;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', b.id,
    'slot_date', b.slot_date,
    'slot_time', b.slot_time,
    'individual_price_eur', 50.00,
    'previous_subscription_id', old_subscription_id
  );
END;
$function$
;
