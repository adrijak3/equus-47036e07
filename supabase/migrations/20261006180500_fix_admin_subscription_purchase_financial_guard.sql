-- Fix: the admin purchase RPC is the trusted Equus purchase system.
-- The subscription financial-field protection trigger also runs on INSERT,
-- so SECURITY DEFINER alone is not enough. Set the same transaction-local
-- authorization marker already used by the other trusted subscription RPCs.
--
-- This replaces only the canonical admin purchase function; normal direct
-- client writes remain protected.

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
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' ELSE 'sportine' END,
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
