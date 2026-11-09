-- Individual subscriptions cover group and po2 lessons too. Keep accounting consistent.
-- Po2 subscriptions continue covering group lessons, including after completion.
CREATE OR REPLACE FUNCTION public.booking_subscription_is_usable_for_slot(_user_id uuid, _slot_date date, _slot_time time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity integer;
  v_slot_package_type text;
BEGIN
  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN false;
  END IF;

  v_slot_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
      AND (
        -- A group package is the base package and can be upgraded to po2
        -- or individual lessons by paying the applicable surcharge.
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) = 'group'
        OR (
          v_slot_package_type IN ('po2', 'group')
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'po2'
        )
        OR (
          v_slot_package_type IN ('individual', 'po2', 'group')
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'individual'
        )
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.pending_subscription_can_cover_slot(_user_id uuid, _slot_date date, _slot_time time without time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_capacity integer;
  v_package_type text;
BEGIN
  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN false;
  END IF;

  v_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = true
      AND s.lessons_used < s.lessons_total
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND (
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) IN ('group', 'po2')
        OR (
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'individual'
          AND v_package_type IN ('individual', 'po2', 'group')
        )
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.booking_matches_subscription_package(_booking_id uuid, _package_type text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = _booking_id
      AND CASE
        WHEN _package_type = 'individual'
          THEN true
        WHEN _package_type IN ('group', 'po2')
          THEN true
        ELSE false
      END
  );
$function$;

CREATE OR REPLACE FUNCTION public.allocate_booking_to_subscription(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_activated uuid;
  v_package_type text;
BEGIN
  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  IF v_booking.status = 'cancelled'
     OR v_booking.counts_in_subscription IS FALSE
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NOT_COUNTED'
    );
  END IF;

  IF v_booking.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'WAIT_UNTIL_COMPLETED'
    );
  END IF;

  -- If this completed booking is the first lesson of a queued package,
  -- activate that package on this exact date before allocating it.
  IF v_booking.subscription_id IS NULL THEN
    v_activated := public.activate_pending_subscription_for_user(
      v_booking.user_id,
      v_booking.id
    );

    IF v_activated IS NOT NULL THEN
      SELECT *
        INTO v_booking
      FROM public.bookings
      WHERE id = _booking_id
      FOR UPDATE;
    END IF;
  END IF;

  -- Existing attribution is retained only when it is still a valid
  -- subscription for this exact booking.
  IF v_booking.subscription_id IS NOT NULL THEN
    SELECT *
      INTO v_sub
    FROM public.subscriptions s
    WHERE s.id = v_booking.subscription_id
      AND s.user_id = v_booking.user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND v_booking.slot_date BETWEEN s.start_from_date AND s.expires_at
      AND (
        public.equus_effective_slot_capacity(v_booking.slot_date, v_booking.slot_time) = 0
        OR public.booking_matches_subscription_package(
          v_booking.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        ) IS TRUE
      )
    FOR UPDATE;

    IF FOUND THEN
      PERFORM public.ensure_subscription_allocation(v_booking.id);
      PERFORM public.reconcile_subscription_usage(v_booking.subscription_id);

      RETURN jsonb_build_object(
        'ok', true,
        'allocated', true,
        'subscription_id', v_booking.subscription_id,
        'reason', 'ALREADY_VALID'
      );
    END IF;

    UPDATE public.bookings
    SET
      subscription_id = NULL,
      counts_in_subscription = true,
      is_grace_booking = false
    WHERE id = v_booking.id;

    v_booking.subscription_id := NULL;
  END IF;

  SELECT CASE
    WHEN v_booking.is_individual IS TRUE
         OR public.equus_effective_slot_capacity(v_booking.slot_date, v_booking.slot_time) = 1
      THEN 'individual'
    WHEN public.equus_effective_slot_capacity(v_booking.slot_date, v_booking.slot_time) = 2
      THEN 'po2'
    ELSE 'group'
  END
  INTO v_package_type;

  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_booking.user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND s.start_from_date <= v_booking.slot_date
    AND s.expires_at >= v_booking.slot_date
    AND (
      (v_package_type = 'group' AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) IN ('group', 'po2', 'individual'))
      OR
      (v_package_type = 'po2' AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) IN ('group', 'po2', 'individual'))
      OR
      (v_package_type = 'individual' AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) = 'individual')
    )
    AND public.subscription_committed_lessons(s.id) < s.lessons_total
  ORDER BY
    s.start_from_date,
    s.purchase_date,
    s.purchased_at,
    s.id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NO_USABLE_SUBSCRIPTION'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'equus-subscription:' || v_sub.id::text,
      0
    )
  );

  IF public.subscription_committed_lessons(v_sub.id) >= v_sub.lessons_total THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NO_SUBSCRIPTION_LESSONS_LEFT'
    );
  END IF;

  UPDATE public.bookings
  SET
    subscription_id = v_sub.id,
    counts_in_subscription = true,
    is_grace_booking = false
  WHERE id = v_booking.id
    AND subscription_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', true,
      'subscription_id', v_sub.id,
      'reason', 'BOOKING_ALREADY_ATTACHED'
    );
  END IF;

  PERFORM public.ensure_subscription_allocation(v_booking.id);
  PERFORM public.reconcile_subscription_usage(v_sub.id);

  RETURN jsonb_build_object(
    'ok', true,
    'allocated', true,
    'subscription_id', v_sub.id,
    'reason', 'ALLOCATED'
  );
END;
$function$;

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

    UPDATE public.subscriptions
    SET
      start_pending = false,
      start_from_date = _slot_date,
      expires_at = _slot_date + 30,
      updated_at = now()
    WHERE id = v_sub.id;

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
$function$;
