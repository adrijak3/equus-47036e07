-- Equus: subscription purchase flow
-- - keeps the existing 5-argument admin_purchase_subscription API (cash wrapper)
-- - adds payment method support
-- - starts a newly purchased subscription only when the previous unfinished
--   subscription has reached its last allocated/used booking date
-- - preserves the purchase date for audit/history

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_payment_method_check;

ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'other'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_purchase_method_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_purchase_method_chk
  CHECK (purchase_method IS NULL OR purchase_method IN ('cash', 'bank_transfer', 'other'));

CREATE OR REPLACE FUNCTION public.admin_purchase_subscription(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _allocation_mode text DEFAULT 'none'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.admin_purchase_subscription(
    _user_id,
    _lessons_total,
    _package_type,
    _horse_type,
    _allocation_mode,
    'cash'
  );
END;
$$;

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
SET search_path = ''
AS $$
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
  v_purchase_date date := current_date;
  v_start_from_date date := current_date;
  v_expires_at date;
  v_allocation_number smallint;
  v_previous_sub_id uuid;
  v_previous_last_booking_date date;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'trainer')) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  IF _user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = _user_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  IF _lessons_total IS NULL OR _lessons_total < 1 OR _lessons_total > 12 THEN
    RAISE EXCEPTION 'INVALID_LESSON_COUNT: must be 1-12';
  END IF;

  IF _package_type NOT IN ('group','po2') THEN
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

  -- Serialize purchases for one rider so two staff members cannot create
  -- competing "next" subscriptions at the same time.
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text, 0));

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

  -- If the rider already has a paid unfinished subscription, the new
  -- subscription waits for that subscription's last counted booking.
  -- Example: old subscription finishes on July 20, a purchase made July 10
  -- starts on July 20 and expires 30 days after July 20.
  SELECT s.id
    INTO v_previous_sub_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND COALESCE(s.paid, false) = true
    AND COALESCE(s.cancelled_at IS NULL, true)
    AND s.lessons_used < s.lessons_total
    AND s.id <> COALESCE(
      (
        SELECT s2.id
        FROM public.subscriptions s2
        WHERE s2.user_id = _user_id
          AND s2.paid = true
          AND s2.lessons_used < s2.lessons_total
          AND COALESCE(s2.cancelled_at IS NULL, true)
        ORDER BY s2.start_from_date NULLS FIRST, s2.purchase_date, s2.purchased_at
        LIMIT 1
      ),
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  ORDER BY s.start_from_date NULLS FIRST, s.purchase_date, s.purchased_at
  LIMIT 1;

  -- The query above is intentionally conservative: pick the oldest
  -- unfinished subscription. If there is one, use its latest counted booking
  -- as the new subscription's start date. If there are no counted bookings
  -- after today, the new subscription can start today.
  IF v_previous_sub_id IS NOT NULL THEN
    SELECT max(b.slot_date)
      INTO v_previous_last_booking_date
    FROM public.bookings b
    WHERE b.subscription_id = v_previous_sub_id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE;

    IF v_previous_last_booking_date IS NOT NULL THEN
      v_start_from_date := GREATEST(current_date, v_previous_last_booking_date);
    END IF;
  END IF;

  v_expires_at := v_start_from_date + 30;

  SELECT u.email
    INTO v_email
  FROM auth.users u
  WHERE u.id = _user_id;

  INSERT INTO public.subscriptions (
    user_id, lessons_total, lessons_used, price, purchase_date, expires_at, paid,
    lesson_type, package_type, horse_type, purchase_method, purchased_by,
    purchased_at, start_from_date
  ) VALUES (
    _user_id, _lessons_total, 0, v_price, v_purchase_date, v_expires_at, true,
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' ELSE 'sportine' END,
    _package_type, _horse_type, _payment_method, v_actor, v_purchase_at,
    v_start_from_date
  )
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.subscription_payments (
    subscription_id, user_id, amount_eur, payment_method, paid_at, recorded_by
  ) VALUES (
    v_subscription_id, _user_id, v_price, _payment_method, v_purchase_at, v_actor
  )
  RETURNING id INTO v_payment_id;

  IF _allocation_mode IN ('today','next') THEN
    SELECT b.id INTO v_booking_id
    FROM public.bookings b
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT so.max_capacity FROM public.slot_overrides so
          WHERE so.slot_date = b.slot_date AND so.slot_time = b.slot_time
          LIMIT 1
        ),
        (
          SELECT ts.max_capacity FROM public.time_slots ts
          WHERE ts.active = true
            AND ts.slot_time = b.slot_time
            AND (
              ts.one_off_date = b.slot_date
              OR (
                ts.one_off_date IS NULL
                AND ts.day_of_week = CASE
                  WHEN extract(dow FROM b.slot_date)::int = 0 THEN 7
                  ELSE extract(dow FROM b.slot_date)::int
                END
              )
            )
            AND (b.trainer_name IS NULL OR ts.trainer_name IS NOT DISTINCT FROM b.trainer_name)
          ORDER BY ts.max_capacity DESC
          LIMIT 1
        ),
        5
      ) AS effective_capacity
    ) cap
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription = true
      AND b.slot_date BETWEEN
        CASE WHEN _allocation_mode = 'today' THEN current_date ELSE current_date + 1 END
        AND v_expires_at
      AND (_allocation_mode = 'next' OR b.slot_date = current_date)
      AND (
        (_package_type = 'po2' AND cap.effective_capacity = 2)
        OR (_package_type = 'group' AND cap.effective_capacity >= 3)
      )
      AND b.slot_date >= v_start_from_date
    ORDER BY b.slot_date, b.slot_time
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
      UPDATE public.bookings
      SET subscription_id = v_subscription_id,
          counts_in_subscription = true
      WHERE id = v_booking_id;

      SELECT COALESCE(max(sa.allocation_number),0) + 1
        INTO v_allocation_number
      FROM public.subscription_allocations sa
      WHERE sa.subscription_id = v_subscription_id;

      INSERT INTO public.subscription_allocations(
        subscription_id, booking_id, allocation_number, status
      )
      VALUES(v_subscription_id, v_booking_id, v_allocation_number, 'allocated')
      RETURNING id INTO v_allocation_id;

      UPDATE public.subscriptions s
      SET lessons_used = (
        SELECT count(*)::smallint
        FROM public.bookings b2
        WHERE b2.subscription_id = s.id
          AND b2.status <> 'cancelled'
          AND b2.counts_in_subscription IS NOT FALSE
      )
      WHERE s.id = v_subscription_id;
    END IF;
  END IF;

  INSERT INTO public.email_events(
    event_key, event_type, user_id, email, subscription_id, booking_id, status
  )
  VALUES(
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

  INSERT INTO public.subscription_audit_log(
    actor_user_id, target_user_id, subscription_id, payment_id, booking_id,
    action, new_value, metadata
  )
  VALUES(
    v_actor, _user_id, v_subscription_id, v_payment_id, v_booking_id,
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
    'lessons_used', CASE WHEN v_booking_id IS NULL THEN 0 ELSE 1 END,
    'remaining', _lessons_total - CASE WHEN v_booking_id IS NULL THEN 0 ELSE 1 END,
    'purchase_date', v_purchase_date,
    'start_from_date', v_start_from_date,
    'expires_at', v_expires_at,
    'previous_subscription_id', v_previous_sub_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) TO authenticated;
