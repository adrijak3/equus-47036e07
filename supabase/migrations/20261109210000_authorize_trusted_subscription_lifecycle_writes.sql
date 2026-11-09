-- Allow trusted lifecycle and approved sickness credit writes to protected fields.
-- Preserve the existing financial-integrity trigger for all other operations.
CREATE OR REPLACE FUNCTION public.activate_pending_subscription_for_user(_user_id uuid, _preferred_booking_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_now_time time := (now() AT TIME ZONE 'Europe/Vilnius')::time;
  v_slot_capacity integer;
  v_occupied integer;
  v_previous_financial_setting text := current_setting('equus.allow_subscription_financial_update', true);
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'equus-user-subscription-sequence:' || _user_id::text,
      0
    )
  );

  -- Do not activate a queued package while an older active package still has
  -- usable lessons remaining.
  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.expires_at >= v_today
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
  ) THEN
    RETURN NULL;
  END IF;

  SELECT s.*
    INTO v_subscription
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = true
  ORDER BY s.purchased_at, s.purchase_date, s.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Preferred booking is used by completion processing when that completed
  -- lesson itself is the first lesson of the queued package.
  IF _preferred_booking_id IS NOT NULL THEN
    SELECT *
      INTO v_booking
    FROM public.bookings b
    WHERE b.id = _preferred_booking_id
      AND b.user_id = _user_id
      AND b.counts_in_subscription IS NOT FALSE
      AND b.status IN ('active', 'completed')
      AND b.subscription_id IS NULL
      AND (
        b.status = 'completed'
        OR b.slot_date > v_today
        OR (b.slot_date = v_today AND b.slot_time >= v_now_time)
      )
      AND (
        b.is_paused_for_subscription IS NOT TRUE
        OR (
          public.booking_is_permanent(b.id)
          AND (
            SELECT count(*)
            FROM public.bookings occ
            WHERE occ.slot_date = b.slot_date
              AND occ.slot_time = b.slot_time
              AND occ.status IN ('active', 'pending_cancel')
              AND occ.is_paused_for_subscription IS NOT TRUE
              AND occ.id <> b.id
          ) < public.equus_effective_slot_capacity(b.slot_date, b.slot_time)
        )
      )
      AND public.booking_matches_subscription_package(
        b.id,
        COALESCE(
          v_subscription.package_type,
          CASE WHEN v_subscription.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        )
      )
    LIMIT 1;
  END IF;

  -- Otherwise select the earliest actual upcoming eligible reservation.
  IF v_booking.id IS NULL THEN
    SELECT b.*
      INTO v_booking
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND (
        b.slot_date > v_today
        OR (b.slot_date = v_today AND b.slot_time >= v_now_time)
      )
      AND (
        b.is_paused_for_subscription IS NOT TRUE
        OR (
          public.booking_is_permanent(b.id)
          AND (
            SELECT count(*)
            FROM public.bookings occ
            WHERE occ.slot_date = b.slot_date
              AND occ.slot_time = b.slot_time
              AND occ.status IN ('active', 'pending_cancel')
              AND occ.is_paused_for_subscription IS NOT TRUE
              AND occ.id <> b.id
          ) < public.equus_effective_slot_capacity(b.slot_date, b.slot_time)
        )
      )
      AND public.booking_matches_subscription_package(
        b.id,
        COALESCE(
          v_subscription.package_type,
          CASE WHEN v_subscription.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        )
      )
    ORDER BY
      CASE WHEN b.is_grace_booking THEN 0 ELSE 1 END,
      b.slot_date,
      b.slot_time,
      b.created_at,
      b.id
    LIMIT 1;
  END IF;

  IF v_booking.id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  UPDATE public.subscriptions
  SET
    start_pending = false,
    start_from_date = v_booking.slot_date,
    expires_at = v_booking.slot_date + 30,
    updated_at = now()
  WHERE id = v_subscription.id;

  PERFORM set_config('equus.allow_subscription_financial_update',
    CASE WHEN v_previous_financial_setting = 'true' THEN 'true' ELSE 'false' END, true);

  UPDATE public.bookings
  SET is_grace_booking = false
  WHERE id = v_booking.id
    AND is_grace_booking = true;

  RETURN v_subscription.id;
END;
$function$

CREATE OR REPLACE FUNCTION public.book_po2_with_subscription(_slot_date date, _slot_time time without time zone, _subscription_id uuid, _extra_fee_eur numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_booking uuid;
  v_trainer_name text;
  v_capacity integer;
  v_booked_count integer;
  v_committed smallint;
  v_package_type text;
  v_extra_fee numeric(10,2);
  v_allocation_id uuid;
  v_previous_financial_setting text := current_setting('equus.allow_subscription_financial_update', true);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <> 2 THEN
    RAISE EXCEPTION 'NOT_PO2_SLOT';
  END IF;

  SELECT count(*)::integer
    INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;

  IF v_booked_count >= 2 THEN
    RAISE EXCEPTION 'SLOT_FULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = v_user
      AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time
      AND b.status IN ('active', 'pending_cancel')
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BOOKING';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.id = _subscription_id
    AND s.user_id = v_user
    AND s.paid = true
    AND s.cancelled_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  v_package_type := COALESCE(
    v_sub.package_type,
    CASE
      WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2'
      ELSE 'group'
    END
  );

  IF v_package_type NOT IN ('group', 'po2', 'individual') THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
  END IF;

  IF v_sub.start_pending THEN
    -- A queued package may activate only after all older active packages are
    -- fully completed. This is the same FIFO rule used by normal registration.
    IF EXISTS (
      SELECT 1
      FROM public.subscriptions older
      WHERE older.user_id = v_user
        AND older.id <> v_sub.id
        AND older.paid = true
        AND older.cancelled_at IS NULL
        AND older.start_pending = false
        AND older.start_from_date IS NOT NULL
        AND older.expires_at IS NOT NULL
        AND older.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
        AND public.subscription_committed_lessons(older.id) < older.lessons_total
        AND older.purchase_date <= v_sub.purchase_date
    ) THEN
      RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED';
    END IF;

    IF NOT (
      v_package_type IN ('po2', 'individual')
    ) THEN
      RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
    END IF;

    PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

    UPDATE public.subscriptions
    SET
      start_pending = false,
      start_from_date = _slot_date,
      expires_at = _slot_date + 30,
      updated_at = now()
    WHERE id = v_sub.id;

    PERFORM set_config('equus.allow_subscription_financial_update',
        CASE WHEN v_previous_financial_setting = 'true' THEN 'true' ELSE 'false' END, true);

    SELECT *
      INTO v_sub
    FROM public.subscriptions
    WHERE id = v_sub.id
    FOR UPDATE;
  END IF;

  IF v_sub.start_from_date IS NULL
     OR v_sub.expires_at IS NULL
  THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED';
  END IF;

  IF v_sub.start_from_date > _slot_date THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED';
  END IF;

  IF v_sub.expires_at < _slot_date THEN
    RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED';
  END IF;

  v_committed := public.subscription_committed_lessons(v_sub.id);

  IF v_committed >= v_sub.lessons_total THEN
    RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT';
  END IF;

  IF v_package_type IN ('po2', 'individual') THEN
    v_extra_fee := 0;
  ELSE
    v_extra_fee := GREATEST(
      0,
      ROUND(
        45 - (v_sub.price / v_sub.lessons_total),
        2
      )
    );
  END IF;

  SELECT trainer_name
    INTO v_trainer_name
  FROM public.time_slots
  WHERE active = true
    AND (
      one_off_date = _slot_date
      OR (
        one_off_date IS NULL
        AND day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
      )
    )
    AND slot_time = _slot_time
  ORDER BY id
  LIMIT 1;

  INSERT INTO public.bookings (
    user_id,
    slot_date,
    slot_time,
    status,
    subscription_id,
    counts_in_subscription,
    extra_fee_eur,
    extra_fee_paid,
    trainer_name,
    is_grace_booking
  )
  VALUES (
    v_user,
    _slot_date,
    _slot_time,
    'active',
    v_sub.id,
    true,
    v_extra_fee,
    false,
    v_trainer_name,
    false
  )
  RETURNING id INTO v_booking;

  SELECT id
    INTO v_allocation_id
  FROM public.subscription_allocations
  WHERE subscription_id = v_sub.id
    AND booking_id = v_booking
  LIMIT 1;

  PERFORM public.reconcile_subscription_usage(v_sub.id);

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking,
    'subscription_id', v_sub.id,
    'extra_fee_eur', v_extra_fee,
    'allocation_id', v_allocation_id
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.recalculate_pending_subscription_after_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_next_booking public.bookings%ROWTYPE;
  v_previous_financial_setting text := current_setting('equus.allow_subscription_financial_update', true);
BEGIN
  IF OLD.status NOT IN ('active', 'pending_cancel')
     OR NEW.status <> 'cancelled'
     OR NEW.user_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = NEW.user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date = NEW.slot_date
    -- Only queued packages may move. A started subscription never moves backward or forward.
    AND s.start_from_date > (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND s.start_from_date > s.purchase_date
    AND s.lessons_used = 0
  ORDER BY s.purchased_at, s.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- If this was the first planned lesson, move the start to the next actual
  -- eligible reservation. Do not manufacture a new date.
  SELECT b.*
    INTO v_next_booking
  FROM public.bookings b
  WHERE b.user_id = NEW.user_id
    AND b.id <> NEW.id
    AND b.status = 'active'
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS NOT FALSE
    AND (
      b.slot_date > (now() AT TIME ZONE 'Europe/Vilnius')::date
      OR (
        b.slot_date = (now() AT TIME ZONE 'Europe/Vilnius')::date
        AND b.slot_time >= (now() AT TIME ZONE 'Europe/Vilnius')::time
      )
    )
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        v_sub.package_type,
        CASE WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    )
    AND b.is_paused_for_subscription IS NOT TRUE
  ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LIMIT 1;

  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  IF v_next_booking.id IS NULL THEN
    UPDATE public.subscriptions
    SET
      start_pending = true,
      start_from_date = NULL,
      expires_at = NULL,
      updated_at = now()
    WHERE id = v_sub.id;
  ELSE
    UPDATE public.subscriptions
    SET
      start_from_date = v_next_booking.slot_date,
      expires_at = v_next_booking.slot_date + 30,
      updated_at = now()
    WHERE id = v_sub.id;
  END IF;

  PERFORM set_config('equus.allow_subscription_financial_update',
    CASE WHEN v_previous_financial_setting = 'true' THEN 'true' ELSE 'false' END, true);

  RETURN NEW;
END;
$function$

CREATE OR REPLACE FUNCTION public.apply_sickness_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_sub uuid;
  cancel_date date;
  v_previous_financial_setting text := current_setting('equus.allow_subscription_financial_update', true);
BEGIN
  IF NEW.sickness = true
     AND NEW.status = 'approved'
     AND COALESCE(NEW.admin_decision_counts, false) = false
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved' OR OLD.sickness IS DISTINCT FROM true)
  THEN
    -- Get the date of the cancelled booking (the "lost" lesson date)
    SELECT slot_date INTO cancel_date FROM public.bookings WHERE id = NEW.booking_id;

    -- Prefer a NEWER subscription purchased on/after the cancellation date
    SELECT id INTO target_sub
    FROM public.subscriptions
    WHERE user_id = NEW.user_id
      AND purchase_date >= COALESCE(cancel_date, CURRENT_DATE)
      AND expires_at >= CURRENT_DATE
    ORDER BY purchase_date ASC
    LIMIT 1;

    -- Fallback: latest active sub
    IF target_sub IS NULL THEN
      SELECT id INTO target_sub
      FROM public.subscriptions
      WHERE user_id = NEW.user_id
        AND expires_at >= CURRENT_DATE
      ORDER BY purchase_date DESC
      LIMIT 1;
    END IF;

    IF target_sub IS NOT NULL THEN
      PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
      UPDATE public.subscriptions
      SET sickness_credits = sickness_credits + 1,
          lessons_total = lessons_total + 1
      WHERE id = target_sub;
      PERFORM set_config('equus.allow_subscription_financial_update',
          CASE WHEN v_previous_financial_setting = 'true' THEN 'true' ELSE 'false' END, true);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
