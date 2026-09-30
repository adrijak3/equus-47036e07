-- EQUUS: Exact subscription pricing for every quantity 1-12.
-- No proportional/tier calculation is used. Each quantity has its own configured price.

-- Keep the price table deterministic: one active price per quantity/type/horse combination.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_prices_unique_quantity_type_horse
ON public.subscription_prices (lessons_total, package_type, horse_type);

-- Replace the active 1-12 price matrix with the exact current price list.
DELETE FROM public.subscription_prices
WHERE lessons_total BETWEEN 1 AND 12;

INSERT INTO public.subscription_prices
  (lessons_total, package_type, horse_type, price_eur, active)
VALUES
  (1,  'group', 'school', 40.00, true),
  (1,  'group', 'own',    40.00, true),
  (1,  'po2',   'school', 45.00, true),
  (1,  'po2',   'own',    45.00, true),

  (2,  'group', 'school', 75.00, true),
  (2,  'group', 'own',    70.00, true),
  (2,  'po2',   'school', 85.00, true),
  (2,  'po2',   'own',    80.00, true),

  (3,  'group', 'school', 112.00, true),
  (3,  'group', 'own',    105.00, true),
  (3,  'po2',   'school', 125.00, true),
  (3,  'po2',   'own',    120.00, true),

  (4,  'group', 'school', 150.00, true),
  (4,  'group', 'own',    140.00, true),
  (4,  'po2',   'school', 170.00, true),
  (4,  'po2',   'own',    160.00, true),

  (5,  'group', 'school', 185.00, true),
  (5,  'group', 'own',    175.00, true),
  (5,  'po2',   'school', 210.00, true),
  (5,  'po2',   'own',    200.00, true),

  (6,  'group', 'school', 225.00, true),
  (6,  'group', 'own',    210.00, true),
  (6,  'po2',   'school', 255.00, true),
  (6,  'po2',   'own',    240.00, true),

  (7,  'group', 'school', 260.00, true),
  (7,  'group', 'own',    245.00, true),
  (7,  'po2',   'school', 295.00, true),
  (7,  'po2',   'own',    280.00, true),

  (8,  'group', 'school', 280.00, true),
  (8,  'group', 'own',    260.00, true),
  (8,  'po2',   'school', 320.00, true),
  (8,  'po2',   'own',    300.00, true),

  (9,  'group', 'school', 315.00, true),
  (9,  'group', 'own',    290.00, true),
  (9,  'po2',   'school', 360.00, true),
  (9,  'po2',   'own',    335.00, true),

  (10, 'group', 'school', 350.00, true),
  (10, 'group', 'own',    325.00, true),
  (10, 'po2',   'school', 400.00, true),
  (10, 'po2',   'own',    375.00, true),

  (11, 'group', 'school', 385.00, true),
  (11, 'group', 'own',    355.00, true),
  (11, 'po2',   'school', 440.00, true),
  (11, 'po2',   'own',    410.00, true),

  (12, 'group', 'school', 400.00, true),
  (12, 'group', 'own',    360.00, true),
  (12, 'po2',   'school', 480.00, true),
  (12, 'po2',   'own',    450.00, true);

-- Exact pricing: the requested quantity must exist in the 1-12 price matrix.
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
  v_expires_at date := current_date + 30;
  v_allocation_number smallint;
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

  SELECT u.email
    INTO v_email
  FROM auth.users u
  WHERE u.id = _user_id;

  INSERT INTO public.subscriptions (
    user_id, lessons_total, lessons_used, price, purchase_date, expires_at, paid,
    lesson_type, package_type, horse_type, purchase_method, purchased_by, purchased_at,
    start_from_date
  ) VALUES (
    _user_id, _lessons_total, 0, v_price, v_purchase_date, v_expires_at, true,
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' ELSE 'sportine' END,
    _package_type, _horse_type, 'cash', v_actor, v_purchase_at, current_date
  )
  RETURNING id INTO v_subscription_id;

  INSERT INTO public.subscription_payments (
    subscription_id, user_id, amount_eur, payment_method, paid_at, recorded_by
  ) VALUES (
    v_subscription_id, _user_id, v_price, 'cash', v_purchase_at, v_actor
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
    ORDER BY b.slot_date, b.slot_time
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
      UPDATE public.bookings
      SET subscription_id = v_subscription_id, counts_in_subscription = true
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
      'payment_method', 'cash',
      'allocation_mode', _allocation_mode
    ),
    jsonb_build_object('email_event_id', v_event_id)
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
    'remaining', _lessons_total - CASE WHEN v_booking_id IS NULL THEN 0 ELSE 1 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text) TO authenticated;
