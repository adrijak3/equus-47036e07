-- Add individual subscriptions (1–12 lessons at €50 per lesson) to the request flow.
-- They are intentionally not added to the public Kainos menu.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_package_type_chk;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_package_type_chk
  CHECK (package_type IS NULL OR package_type IN ('group','po2','individual'));

ALTER TABLE public.subscription_prices
  DROP CONSTRAINT IF EXISTS subscription_prices_package_type_check;
ALTER TABLE public.subscription_prices
  ADD CONSTRAINT subscription_prices_package_type_check
  CHECK (package_type IN ('group','po2','individual'));

ALTER TABLE public.subscription_purchase_requests
  DROP CONSTRAINT IF EXISTS subscription_purchase_requests_package_type_check;
ALTER TABLE public.subscription_purchase_requests
  ADD CONSTRAINT subscription_purchase_requests_package_type_check
  CHECK (package_type IN ('group','po2','individual'));

INSERT INTO public.subscription_prices
  (lessons_total, package_type, horse_type, price_eur, active)
SELECT n, 'individual', h.horse_type, n * 50.00, true
FROM generate_series(1, 12) AS n
CROSS JOIN (VALUES ('school'), ('own')) AS h(horse_type)
ON CONFLICT (lessons_total, package_type, horse_type)
DO UPDATE SET price_eur = EXCLUDED.price_eur, active = true, updated_at = now();

CREATE OR REPLACE FUNCTION public.booking_matches_subscription_package(
  _booking_id uuid,
  _package_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = _booking_id
      AND CASE
        WHEN _package_type = 'individual'
          THEN b.is_individual IS TRUE OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1
        WHEN b.is_individual IS TRUE
             OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1
          THEN false
        WHEN public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 2
          THEN _package_type IN ('group', 'po2')
        ELSE _package_type = 'group'
      END
  );
$$;


REVOKE ALL
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
TO service_role;

CREATE OR REPLACE FUNCTION public.pending_subscription_can_cover_slot(
  _user_id uuid,
  _slot_date date,
  _slot_time time
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $pending_usable_with_request_selections$
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
        (v_package_type = 'group' AND COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) = 'group')
        OR
        (v_package_type = 'individual' AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'individual')
        OR
        (v_package_type = 'po2' AND COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) IN ('group', 'po2'))
      )
  );
END;
$pending_usable_with_request_selections$;


REVOKE ALL
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_subscription_purchase_request(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _payment_method text,
  _booking_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_purchase_request$
DECLARE
  v_actor uuid := auth.uid();
  v_price numeric(10,2);
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_ids uuid[] := COALESCE(_booking_ids, ARRAY[]::uuid[]);
  v_selected_count integer := COALESCE(cardinality(_booking_ids), 0);
  v_valid_count integer := 0;
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL OR NOT public.owns_profile(v_actor, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _lessons_total IS NULL OR _lessons_total < 1 OR _lessons_total > 12 THEN
    RAISE EXCEPTION 'INVALID_LESSON_COUNT';
  END IF;

  IF _package_type NOT IN ('group', 'po2', 'individual') THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_TYPE';
  END IF;

  IF _horse_type NOT IN ('school', 'own') THEN
    RAISE EXCEPTION 'INVALID_HORSE_TYPE';
  END IF;

  IF _payment_method NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;

  IF v_selected_count > _lessons_total THEN
    RAISE EXCEPTION 'TOO_MANY_PAST_LESSONS';
  END IF;

  IF array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PAST_LESSON_SELECTION';
  END IF;

  -- Prevent duplicate submissions from the same rider and serialize checks
  -- against another request or purchase for that rider.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-subscription-request:' || _user_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.subscription_purchase_requests r
    WHERE r.user_id = _user_id
      AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_REQUEST_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid IS TRUE
      AND s.cancelled_at IS NULL
      AND s.start_pending IS TRUE
  ) THEN
    RAISE EXCEPTION 'PENDING_SUBSCRIPTION_ALREADY_EXISTS';
  END IF;

  SELECT sp.price_eur
    INTO v_price
  FROM public.subscription_prices sp
  WHERE sp.lessons_total = _lessons_total
    AND sp.package_type = _package_type
    AND sp.horse_type = _horse_type
    AND sp.active IS TRUE;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'PRICE_NOT_CONFIGURED';
  END IF;

  IF v_selected_count > 0 THEN
    SELECT COUNT(*)::integer
      INTO v_valid_count
    FROM public.bookings b
    WHERE b.id = ANY(v_ids)
      AND b.user_id = _user_id
      AND b.status = 'completed'
      AND b.slot_date BETWEEN v_today - 13 AND v_today
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS TRUE
      AND b.is_paused_for_subscription IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscription_purchase_request_lessons rl
        JOIN public.subscription_purchase_requests r ON r.id = rl.request_id
        WHERE rl.booking_id = b.id
          AND r.status IN ('pending', 'approved')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = b.user_id
          AND s.paid IS TRUE
          AND s.cancelled_at IS NULL
          AND s.start_pending IS FALSE
          AND s.start_from_date IS NOT NULL
          AND s.expires_at IS NOT NULL
          AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
          AND s.lessons_used < s.lessons_total
          AND public.subscription_committed_lessons(s.id) < s.lessons_total
          AND public.booking_matches_subscription_package(
            b.id,
            COALESCE(
              s.package_type,
              CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
            )
          )
      );

    -- This comparison also rejects duplicated IDs supplied by a modified client.
    IF v_valid_count <> v_selected_count THEN
      RAISE EXCEPTION 'PAST_LESSON_NOT_ELIGIBLE';
    END IF;
  END IF;

  INSERT INTO public.subscription_purchase_requests (
    user_id, lessons_total, package_type, horse_type,
    payment_method, price_eur, status
  )
  VALUES (
    _user_id, _lessons_total, _package_type, _horse_type,
    _payment_method, v_price, 'pending'
  )
  RETURNING id INTO v_request_id;

  IF v_selected_count > 0 THEN
    INSERT INTO public.subscription_purchase_request_lessons(request_id, booking_id)
    SELECT v_request_id, x.booking_id
    FROM unnest(v_ids) AS x(booking_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'price_eur', v_price,
    'payment_method', _payment_method,
    'selected_lesson_count', v_selected_count,
    'status', 'pending'
  );
END;
$create_purchase_request$;


REVOKE ALL
ON FUNCTION public.create_subscription_purchase_request(uuid,smallint,text,text,text,uuid[])
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.create_subscription_purchase_request(uuid,smallint,text,text,text,uuid[])
TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_purchase_subscription(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _allocation_mode text,
  _payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $purchase_final$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_price numeric(10,2);
  v_subscription_id uuid;
  v_payment_id uuid;
  v_booking_id uuid;
  v_allocation_id uuid;
  v_event_id uuid;
  v_purchase_at timestamptz := now();
  v_purchase_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_start_from_date date;
  v_expires_at date;
  v_previous_sub_id uuid;
  v_previous_last_booking_date date;
  v_first_future_booking_date date;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor,'admin')
    OR public.has_role(v_actor,'trainer')
    OR public.has_role(v_actor,'half_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = _user_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  IF _lessons_total IS NULL OR _lessons_total < 1 OR _lessons_total > 12 THEN
    RAISE EXCEPTION 'INVALID_LESSON_COUNT: must be 1-12';
  END IF;

  IF _package_type NOT IN ('group','po2','individual') THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_TYPE';
  END IF;

  IF _horse_type NOT IN ('school','own') THEN
    RAISE EXCEPTION 'INVALID_HORSE_TYPE';
  END IF;

  IF _allocation_mode NOT IN ('none','today','next') THEN
    RAISE EXCEPTION 'INVALID_ALLOCATION_MODE';
  END IF;

  IF _payment_method NOT IN ('cash','bank_transfer','other') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-user-purchase:' || _user_id::text, 0)
  );

  -- Keep all existing usage counters honest before deciding whether the
  -- previous subscription is still unfinished.
  FOR v_previous_sub_id IN
    SELECT s.id
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
    ORDER BY
      COALESCE(s.start_from_date, s.purchase_date),
      s.purchase_date,
      s.purchased_at,
      s.id
  LOOP
    PERFORM public.reconcile_subscription_usage(v_previous_sub_id);
  END LOOP;

  SELECT sp.price_eur
    INTO v_price
  FROM public.subscription_prices sp
  WHERE sp.lessons_total = _lessons_total
    AND sp.package_type = _package_type
    AND sp.horse_type = _horse_type
    AND sp.active = true;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'PRICE_NOT_CONFIGURED';
  END IF;

  SELECT s.id
    INTO v_previous_sub_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND public.subscription_committed_lessons(s.id) < s.lessons_total
  ORDER BY
    COALESCE(s.start_from_date, s.purchase_date),
    s.purchase_date,
    s.purchased_at,
    s.id
  LIMIT 1
  FOR UPDATE;

  IF v_previous_sub_id IS NOT NULL THEN
    SELECT max(b.slot_date)
      INTO v_previous_last_booking_date
    FROM public.bookings b
    WHERE b.subscription_id = v_previous_sub_id
      AND b.status IN ('active', 'pending_cancel', 'completed')
      AND b.counts_in_subscription IS NOT FALSE;

    SELECT b.slot_date
      INTO v_first_future_booking_date
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.slot_date > COALESCE(v_previous_last_booking_date, v_purchase_date - 1)
      AND (
        (_package_type = 'po2' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 2)
        OR (_package_type = 'group' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) >= 3)
        OR (_package_type = 'individual' AND (b.is_individual IS TRUE OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1))
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    v_start_from_date := COALESCE(
      v_first_future_booking_date,
      GREATEST(v_purchase_date, v_previous_last_booking_date + 1)
    );
  ELSE
    SELECT b.slot_date
      INTO v_first_future_booking_date
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.slot_date >= v_purchase_date
      AND (
        (_package_type = 'po2' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 2)
        OR (_package_type = 'group' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) >= 3)
        OR (_package_type = 'individual' AND (b.is_individual IS TRUE OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1))
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    v_start_from_date := COALESCE(
      v_first_future_booking_date,
      v_purchase_date
    );
  END IF;

  v_expires_at := v_start_from_date + 30;

  SELECT u.email
    INTO v_email
  FROM auth.users u
  WHERE u.id = _user_id;

  -- This RPC is the trusted Equus purchase path. The subscriptions
  -- protection trigger intentionally blocks direct financial-field writes,
  -- including INSERTs. SECURITY DEFINER does not bypass that trigger, so
  -- mark this transaction as the authorized purchase-system path.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  PERFORM set_config(
    'equus.defer_subscription_restore',
    'true',
    true
  );

  INSERT INTO public.subscriptions (
    user_id,
    lessons_total,
    lessons_used,
    price,
    purchase_date,
    expires_at,
    paid,
    lesson_type,
    package_type,
    horse_type,
    purchase_method,
    purchased_by,
    purchased_at,
    start_from_date
  )
  VALUES (
    _user_id,
    _lessons_total,
    0,
    v_price,
    v_purchase_date,
    v_expires_at,
    true,
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' WHEN _package_type = 'individual' THEN 'individual' ELSE 'sportine' END,
    _package_type,
    _horse_type,
    _payment_method,
    v_actor,
    v_purchase_at,
    v_start_from_date
  )
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.subscription_payments (
    subscription_id,
    user_id,
    amount_eur,
    payment_method,
    paid_at,
    recorded_by
  )
  VALUES (
    v_subscription_id,
    _user_id,
    v_price,
    _payment_method,
    v_purchase_at,
    v_actor
  )
  RETURNING id INTO v_payment_id;

  IF _allocation_mode IN ('today','next') THEN
    SELECT b.id
      INTO v_booking_id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND b.slot_date >= v_start_from_date
      AND b.slot_date <= v_expires_at
      AND (
        _allocation_mode = 'next'
        OR b.slot_date = v_purchase_date
      )
      AND (
        (_package_type = 'po2' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 2)
        OR (_package_type = 'group' AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) >= 3)
        OR (_package_type = 'individual' AND (b.is_individual IS TRUE OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1))
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1
    FOR UPDATE;

    IF v_booking_id IS NOT NULL THEN
      UPDATE public.bookings
      SET
        subscription_id = v_subscription_id,
        counts_in_subscription = true,
        is_grace_booking = false
      WHERE id = v_booking_id;

      SELECT id
        INTO v_allocation_id
      FROM public.subscription_allocations
      WHERE subscription_id = v_subscription_id
        AND booking_id = v_booking_id
      LIMIT 1;

      PERFORM public.reconcile_subscription_usage(v_subscription_id);
    END IF;
  END IF;

  PERFORM public.restore_paused_bookings_for_subscription(v_subscription_id);

  PERFORM set_config(
    'equus.defer_subscription_restore',
    'false',
    true
  );

  INSERT INTO public.email_events (
    event_key,
    event_type,
    user_id,
    email,
    subscription_id,
    booking_id,
    status
  )
  VALUES (
    'subscription_purchase:' || v_subscription_id::text,
    'subscription_purchase',
    _user_id,
    v_email,
    v_subscription_id,
    v_booking_id,
    'pending'
  )
  ON CONFLICT(event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  INSERT INTO public.subscription_audit_log (
    actor_user_id,
    target_user_id,
    subscription_id,
    payment_id,
    booking_id,
    action,
    new_value,
    metadata
  )
  VALUES (
    v_actor,
    _user_id,
    v_subscription_id,
    v_payment_id,
    v_booking_id,
    'subscription_cash_purchase',
    jsonb_build_object(
      'lessons_total', _lessons_total,
      'package_type', _package_type,
      'horse_type', _horse_type,
      'price_eur', v_price,
      'payment_method', _payment_method,
      'allocation_mode', _allocation_mode,
      'purchase_date', v_purchase_date,
      'start_from_date', v_start_from_date,
      'expires_at', v_expires_at
    ),
    jsonb_build_object(
      'email_event_id', v_event_id,
      'previous_subscription_id', v_previous_sub_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_subscription_id,
    'payment_id', v_payment_id,
    'booking_id', v_booking_id,
    'allocation_id', v_allocation_id,
    'email_event_id', v_event_id,
    'email_status', 'pending',
    'price_eur', v_price,
    'lessons_total', _lessons_total,
    'lessons_used', (
      SELECT lessons_used
      FROM public.subscriptions
      WHERE id = v_subscription_id
    ),
    'remaining', (
      SELECT lessons_total - lessons_used
      FROM public.subscriptions
      WHERE id = v_subscription_id
    ),
    'purchase_date', v_purchase_date,
    'start_from_date', v_start_from_date,
    'expires_at', v_expires_at,
    'previous_subscription_id', v_previous_sub_id
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'equus.defer_subscription_restore',
      'false',
      true
    );
    RAISE;
END;
$purchase_final$;


REVOKE ALL
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text)
TO authenticated;
