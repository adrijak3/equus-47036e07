-- Equus Phase 4: subscription accounting engine
-- Goals:
--   * one calendar day may contain multiple distinct lessons
--   * the exact same booking can never consume twice
--   * subscription allocation is FIFO and concurrency-safe
--   * future/grace bookings can be allocated when the new subscription starts
--   * lessons_used is reconciled from counted, non-cancelled allocations
--   * a new subscription starts on the first actual lesson after the previous
--     unfinished subscription's last counted lesson when that booking exists

CREATE OR REPLACE FUNCTION public.reconcile_subscription_usage(
  _subscription_id uuid
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used smallint := 0;
  v_total smallint;
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lessons_total
    INTO v_total
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::smallint
    INTO v_used
  FROM public.bookings b
  WHERE b.subscription_id = _subscription_id
    AND b.status <> 'cancelled'
    AND b.counts_in_subscription IS NOT FALSE;

  UPDATE public.subscriptions
  SET lessons_used = LEAST(v_total, v_used)
  WHERE id = _subscription_id;

  RETURN LEAST(v_total, v_used);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_booking_to_subscription(
  _booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_allocation_number smallint;
  v_existing_allocation public.subscription_allocations%ROWTYPE;
  v_start_date date;
BEGIN
  IF _booking_id IS NULL THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- Cancelled / explicitly non-counting bookings never consume a lesson.
  IF v_booking.status = 'cancelled'
     OR v_booking.counts_in_subscription IS FALSE
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NOT_COUNTED'
    );
  END IF;

  -- A booking already attached to a subscription is idempotent.
  IF v_booking.subscription_id IS NOT NULL THEN
    SELECT *
      INTO v_existing_allocation
    FROM public.subscription_allocations
    WHERE subscription_id = v_booking.subscription_id
      AND booking_id = v_booking.id
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
        INTO v_allocation_number
      FROM public.subscription_allocations sa
      WHERE sa.subscription_id = v_booking.subscription_id;

      INSERT INTO public.subscription_allocations(
        subscription_id,
        booking_id,
        allocation_number,
        status,
        consumed_at
      )
      VALUES (
        v_booking.subscription_id,
        v_booking.id,
        v_allocation_number,
        CASE WHEN v_booking.status = 'completed' THEN 'consumed' ELSE 'allocated' END,
        CASE WHEN v_booking.status = 'completed' THEN now() ELSE NULL END
      )
      ON CONFLICT (subscription_id, booking_id) DO NOTHING;
    END IF;

    PERFORM public.reconcile_subscription_usage(v_booking.subscription_id);

    RETURN jsonb_build_object(
      'ok', true,
      'allocated', true,
      'subscription_id', v_booking.subscription_id,
      'reason', 'ALREADY_ALLOCATED'
    );
  END IF;

  -- Find the oldest paid unfinished subscription that can legitimately cover
  -- this lesson date. The row lock prevents two concurrent workers from
  -- assigning the same remaining lesson.
  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_booking.user_id
    AND COALESCE(s.paid, false) = true
    AND COALESCE(s.cancelled_at IS NULL, true)
    AND s.lessons_used < s.lessons_total
    AND COALESCE(s.start_from_date, s.purchase_date) <= v_booking.slot_date
    AND s.expires_at >= v_booking.slot_date
  ORDER BY
    COALESCE(s.start_from_date, s.purchase_date),
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

  v_start_date := COALESCE(v_sub.start_from_date, v_sub.purchase_date);

  -- A future subscription must never consume a booking before its start.
  IF v_start_date > v_booking.slot_date THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'SUBSCRIPTION_NOT_STARTED'
    );
  END IF;

  -- Re-check the actual number of counted bookings while holding the
  -- subscription lock. This prevents lessons_used drift from causing an
  -- over-allocation.
  PERFORM public.reconcile_subscription_usage(v_sub.id);

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = v_sub.id
  FOR UPDATE;

  IF v_sub.lessons_used >= v_sub.lessons_total THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NO_SUBSCRIPTION_LESSONS_LEFT'
    );
  END IF;

  UPDATE public.bookings
  SET subscription_id = v_sub.id
  WHERE id = v_booking.id
    AND subscription_id IS NULL;

  IF NOT FOUND THEN
    -- Another transaction attached it while we were working; make the
    -- operation idempotent instead of consuming a second lesson.
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', true,
      'subscription_id', v_sub.id,
      'reason', 'BOOKING_ALREADY_ATTACHED'
    );
  END IF;

  SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
    INTO v_allocation_number
  FROM public.subscription_allocations sa
  WHERE sa.subscription_id = v_sub.id;

  INSERT INTO public.subscription_allocations(
    subscription_id,
    booking_id,
    allocation_number,
    status,
    consumed_at
  )
  VALUES (
    v_sub.id,
    v_booking.id,
    v_allocation_number,
    CASE WHEN v_booking.status = 'completed' THEN 'consumed' ELSE 'allocated' END,
    CASE WHEN v_booking.status = 'completed' THEN now() ELSE NULL END
  )
  ON CONFLICT (subscription_id, booking_id) DO NOTHING;

  PERFORM public.reconcile_subscription_usage(v_sub.id);

  RETURN jsonb_build_object(
    'ok', true,
    'allocated', true,
    'subscription_id', v_sub.id,
    'reason', 'ALLOCATED'
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;


-- Keep lessons_used synchronized whenever a booking is attached, released,
-- cancelled, or completed. This is deliberately based on the booking rows,
-- so two separate lessons on the same date count as two lessons.
CREATE OR REPLACE FUNCTION public.sync_subscription_usage_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_trigger$
DECLARE
  v_old_sub uuid;
  v_new_sub uuid;
  v_allocation_number smallint;
BEGIN
  v_old_sub := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.subscription_id ELSE NULL END;
  v_new_sub := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.subscription_id ELSE NULL END;

  IF TG_OP IN ('UPDATE','DELETE')
     AND v_old_sub IS NOT NULL
     AND (
       TG_OP = 'DELETE'
       OR v_old_sub IS DISTINCT FROM v_new_sub
       OR OLD.counts_in_subscription IS DISTINCT FROM NEW.counts_in_subscription
       OR OLD.status IS DISTINCT FROM NEW.status
     )
  THEN
    UPDATE public.subscription_allocations
    SET
      status = CASE
        WHEN TG_OP = 'DELETE' OR NEW.status = 'cancelled' OR NEW.counts_in_subscription IS FALSE
          THEN 'released'
        WHEN NEW.status = 'completed'
          THEN 'consumed'
        ELSE status
      END,
      released_at = CASE
        WHEN TG_OP = 'DELETE' OR NEW.status = 'cancelled' OR NEW.counts_in_subscription IS FALSE
          THEN COALESCE(released_at, now())
        ELSE released_at
      END,
      consumed_at = CASE
        WHEN TG_OP = 'UPDATE' AND NEW.status = 'completed' AND NEW.counts_in_subscription IS NOT FALSE
          THEN COALESCE(consumed_at, now())
        ELSE consumed_at
      END
    WHERE subscription_id = v_old_sub
      AND booking_id = OLD.id;

    PERFORM public.reconcile_subscription_usage(v_old_sub);
  END IF;

  IF TG_OP IN ('INSERT','UPDATE')
     AND v_new_sub IS NOT NULL
     AND NEW.status <> 'cancelled'
     AND NEW.counts_in_subscription IS NOT FALSE
  THEN
    SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
      INTO v_allocation_number
    FROM public.subscription_allocations sa
    WHERE sa.subscription_id = v_new_sub;

    INSERT INTO public.subscription_allocations(
      subscription_id,
      booking_id,
      allocation_number,
      status,
      consumed_at
    )
    VALUES(
      v_new_sub,
      NEW.id,
      v_allocation_number,
      CASE WHEN NEW.status = 'completed' THEN 'consumed' ELSE 'allocated' END,
      CASE WHEN NEW.status = 'completed' THEN now() ELSE NULL END
    )
    ON CONFLICT (subscription_id, booking_id) DO UPDATE
      SET status = EXCLUDED.status,
          consumed_at = COALESCE(
            public.subscription_allocations.consumed_at,
            EXCLUDED.consumed_at
          );

    PERFORM public.reconcile_subscription_usage(v_new_sub);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_subscription_usage_from_booking
ON public.bookings;

CREATE TRIGGER trg_sync_subscription_usage_from_booking
AFTER INSERT OR DELETE OR UPDATE OF subscription_id, counts_in_subscription, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_subscription_usage_from_booking();

REVOKE ALL
ON FUNCTION public.sync_subscription_usage_from_booking()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.sync_subscription_usage_from_booking()
TO service_role;


-- Replace the lesson processor so it uses the central idempotent allocator.



-- Fix the existing purchase engine:
-- * a queued subscription starts at the first known booking after the old
--   subscription's last counted booking, not on the same day as the old last
--   lesson;
-- * allocation still supports today's booking and the next eligible booking;
-- * subscription usage is reconciled from actual counted bookings.
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
  v_first_future_booking_date date;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT (
    public.has_role(v_actor,'admin')
    OR public.has_role(v_actor,'trainer')
    OR public.has_role(v_actor,'half_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

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

  -- Oldest unfinished subscription is the only subscription that can block
  -- the new one from starting.
  SELECT s.id
    INTO v_previous_sub_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND COALESCE(s.paid, false) = true
    AND COALESCE(s.cancelled_at IS NULL, true)
    AND s.lessons_used < s.lessons_total
  ORDER BY
    COALESCE(s.start_from_date, s.purchase_date),
    s.purchase_date,
    s.purchased_at,
    s.id
  LIMIT 1;

  IF v_previous_sub_id IS NOT NULL THEN
    SELECT max(b.slot_date)
      INTO v_previous_last_booking_date
    FROM public.bookings b
    WHERE b.subscription_id = v_previous_sub_id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE;

    IF v_previous_last_booking_date IS NOT NULL THEN
      SELECT min(b.slot_date)
        INTO v_first_future_booking_date
      FROM public.bookings b
      WHERE b.user_id = _user_id
        AND b.status = 'active'
        AND b.subscription_id IS NULL
        AND b.counts_in_subscription IS NOT FALSE
        AND b.slot_date > v_previous_last_booking_date
        AND (
          (_package_type = 'po2' AND EXISTS (
            SELECT 1
            FROM public.time_slots ts
            WHERE ts.active = true
              AND ts.slot_time = b.slot_time
              AND ts.max_capacity = 2
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
          ))
          OR
          (_package_type = 'group' AND EXISTS (
            SELECT 1
            FROM public.time_slots ts
            WHERE ts.active = true
              AND ts.slot_time = b.slot_time
              AND ts.max_capacity >= 3
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
          ))
        );
    END IF;

    v_start_from_date :=
      COALESCE(
        v_first_future_booking_date,
        GREATEST(current_date, v_previous_last_booking_date + 1)
      );
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
    SELECT b.id
      INTO v_booking_id
    FROM public.bookings b
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (
          SELECT so.max_capacity
          FROM public.slot_overrides so
          WHERE so.slot_date = b.slot_date
            AND so.slot_time = b.slot_time
          LIMIT 1
        ),
        (
          SELECT ts.max_capacity
          FROM public.time_slots ts
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
          ORDER BY ts.max_capacity DESC
          LIMIT 1
        ),
        5
      ) AS effective_capacity
    ) cap
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.slot_date >= v_start_from_date
      AND b.slot_date <= v_expires_at
      AND (
        _allocation_mode = 'next'
        OR b.slot_date = current_date
      )
      AND (
        (_package_type = 'po2' AND cap.effective_capacity = 2)
        OR (_package_type = 'group' AND cap.effective_capacity >= 3)
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at
    FOR UPDATE OF b SKIP LOCKED
    LIMIT 1;

    IF v_booking_id IS NOT NULL THEN
      UPDATE public.bookings
      SET subscription_id = v_subscription_id,
          counts_in_subscription = true
      WHERE id = v_booking_id;

      SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
        INTO v_allocation_number
      FROM public.subscription_allocations sa
      WHERE sa.subscription_id = v_subscription_id;

      INSERT INTO public.subscription_allocations(
        subscription_id, booking_id, allocation_number, status
      )
      VALUES(
        v_subscription_id,
        v_booking_id,
        v_allocation_number,
        'allocated'
      )
      ON CONFLICT (subscription_id, booking_id) DO NOTHING
      RETURNING id INTO v_allocation_id;

      PERFORM public.reconcile_subscription_usage(v_subscription_id);
    END IF;
  END IF;

  INSERT INTO public.email_events(
    event_key,
    event_type,
    user_id,
    email,
    subscription_id,
    booking_id,
    status
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
    actor_user_id,
    target_user_id,
    subscription_id,
    payment_id,
    booking_id,
    action,
    new_value,
    metadata
  )
  VALUES(
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
      SELECT lessons_used FROM public.subscriptions WHERE id = v_subscription_id
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
END;
$$;

REVOKE ALL
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text,text)
TO authenticated;


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

REVOKE ALL
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
TO authenticated;
