-- Final production hardening for the subscription booking engine.
--
-- This migration is intentionally additive: it fixes functions that are already
-- deployed in production instead of editing previously-applied migrations.

-- ---------------------------------------------------------------------------
-- 1. Fix the already-deployed duplicate repair function.
--    bookings.id is uuid, so min(uuid) is invalid. lesson_kind is not a real
--    bookings column; derive the lesson kind from is_individual instead.
--    Keep lessons_used as completed-only accounting.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dedupe_subscription_day_bookings(
  _user_id uuid,
  _slot_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subscription_id uuid;
  v_subscription_booking_id uuid;
  v_horse_booking_id uuid;
  v_subscription_counts boolean;
  v_subscription_extra_fee numeric;
  v_subscription_extra_paid boolean;
  candidate_count integer;
  removed_count integer := 0;
BEGIN
  IF _user_id IS NULL OR _slot_date IS NULL THEN
    RETURN 0;
  END IF;

  IF pg_trigger_depth() > 1 THEN
    RETURN 0;
  END IF;

  IF (
    SELECT count(*)
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.status IN ('active', 'pending_cancel')
      AND b.subscription_id IS NOT NULL
      AND b.counts_in_subscription = true
  ) <> 1 THEN
    RETURN 0;
  END IF;

  FOR v_subscription_booking_id, v_subscription_id, v_subscription_counts,
      v_subscription_extra_fee, v_subscription_extra_paid IN
    SELECT
      b.id,
      b.subscription_id,
      b.counts_in_subscription,
      b.extra_fee_eur,
      b.extra_fee_paid
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.status IN ('active', 'pending_cancel')
      AND b.subscription_id IS NOT NULL
      AND b.counts_in_subscription = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.horse_assignments ha
        WHERE ha.booking_id = b.id
      )
      AND EXISTS (
        SELECT 1
        FROM public.bookings h
        WHERE h.user_id = b.user_id
          AND h.slot_date = b.slot_date
          AND h.status IN ('active', 'pending_cancel')
          AND h.id <> b.id
          AND EXISTS (
            SELECT 1
            FROM public.horse_assignments ha2
            WHERE ha2.booking_id = h.id
          )
          AND abs(extract(epoch FROM (h.slot_time - b.slot_time))) <= 900
          AND (
            CASE
              WHEN h.is_individual IS TRUE THEN 'individual'
              ELSE 'group'
            END
          ) = (
            CASE
              WHEN b.is_individual IS TRUE THEN 'individual'
              ELSE 'group'
            END
          )
      )
  LOOP
    SELECT count(*)
      INTO candidate_count
    FROM public.bookings h
    WHERE h.user_id = _user_id
      AND h.slot_date = _slot_date
      AND h.status IN ('active', 'pending_cancel')
      AND h.id <> v_subscription_booking_id
      AND EXISTS (
        SELECT 1
        FROM public.horse_assignments ha
        WHERE ha.booking_id = h.id
      )
      AND abs(extract(epoch FROM (h.slot_time - (
        SELECT b.slot_time
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      )))) <= 900
      AND (
        CASE
          WHEN h.is_individual IS TRUE THEN 'individual'
          ELSE 'group'
        END
      ) = (
        SELECT CASE
          WHEN b.is_individual IS TRUE THEN 'individual'
          ELSE 'group'
        END
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      );

    IF candidate_count <> 1 THEN
      CONTINUE;
    END IF;

    SELECT h.id
      INTO v_horse_booking_id
    FROM public.bookings h
    WHERE h.user_id = _user_id
      AND h.slot_date = _slot_date
      AND h.status IN ('active', 'pending_cancel')
      AND h.id <> v_subscription_booking_id
      AND EXISTS (
        SELECT 1
        FROM public.horse_assignments ha
        WHERE ha.booking_id = h.id
      )
      AND abs(extract(epoch FROM (h.slot_time - (
        SELECT b.slot_time
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      )))) <= 900
      AND (
        CASE
          WHEN h.is_individual IS TRUE THEN 'individual'
          ELSE 'group'
        END
      ) = (
        SELECT CASE
          WHEN b.is_individual IS TRUE THEN 'individual'
          ELSE 'group'
        END
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      )
    LIMIT 1;

    IF v_horse_booking_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.bookings
    SET
      subscription_id = v_subscription_id,
      counts_in_subscription = true,
      extra_fee_eur = COALESCE(v_subscription_extra_fee, 0),
      extra_fee_paid = COALESCE(v_subscription_extra_paid, false)
    WHERE id = v_horse_booking_id
      AND subscription_id IS NULL;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.bookings
    WHERE id = v_subscription_booking_id;

    removed_count := removed_count + 1;

    PERFORM public.reconcile_subscription_usage(v_subscription_id);
  END LOOP;

  RETURN removed_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. One canonical definition of committed subscription lessons.
--    lessons_used remains completed-only; committed includes reservations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.subscription_committed_lessons(
  _subscription_id uuid
)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    COUNT(*) FILTER (
      WHERE b.status IN ('active', 'pending_cancel', 'completed')
        AND b.counts_in_subscription IS NOT FALSE
    ),
    0
  )::smallint
  FROM public.bookings b
  WHERE b.subscription_id = _subscription_id;
$$;

REVOKE ALL
ON FUNCTION public.subscription_committed_lessons(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.subscription_committed_lessons(uuid)
TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Subscription usability must check committed lessons, not only completed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_subscription_is_usable_for_slot(
  _user_id uuid,
  _slot_date date,
  _slot_time time without time zone
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_slot_sub$
DECLARE
  v_capacity integer;
BEGIN
  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date
        AND so.slot_time = _slot_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.active = true
        AND ts.slot_time = _slot_time
        AND (
          ts.one_off_date = _slot_date
          OR (
            ts.one_off_date IS NULL
            AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
          )
        )
      ORDER BY ts.max_capacity DESC
      LIMIT 1
    )
  )
  INTO v_capacity;

  IF COALESCE(v_capacity, 0) <= 0 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND COALESCE(s.paid, false) = true
      AND s.cancelled_at IS NULL
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
      AND (
        (s.package_type IS NULL AND s.lesson_type IS NULL)
        OR (
          v_capacity = 2
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'po2'
        )
        OR (
          v_capacity >= 3
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'group'
        )
      )
  );
END;
$equus_slot_sub$;

REVOKE ALL
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time without time zone)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time without time zone)
TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Eligibility: auth.uid() is the actor. Never treat the target rider as
--    the actor. Admin bypass is based on the authenticated actor.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_booking_eligibility(
  _user_id uuid,
  _slot_date date,
  _slot_time time without time zone,
  _allow_admin_bypass boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_eligibility$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_existing boolean := false;
  v_weekly_slot boolean := false;
  v_is_permanent boolean := false;
  v_subscription_usable boolean := false;
  v_grace_count integer := 0;
  v_enforcement_active boolean := false;
  v_capacity integer := 0;
  v_booked_count integer := 0;
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_AUTHENTICATED',
      'message', 'Prisijunkite, kad galėtumėte registruotis.'
    );
  END IF;

  IF _user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'USER_REQUIRED',
      'message', 'Nenurodytas raitelis.'
    );
  END IF;

  IF _slot_date IS NULL OR _slot_time IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SLOT',
      'message', 'Neteisingas treniruotės laikas.'
    );
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin');

  IF _allow_admin_bypass AND v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', true,
      'bypass', true,
      'reason', 'ADMIN'
    );
  END IF;

  IF _user_id <> v_actor THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_ALLOWED',
      'message', 'Neturite teisės registruoti kito raitelio.'
    );
  END IF;

  v_is_exempt := public.is_subscription_rule_exempt(_user_id);

  IF EXISTS (
    SELECT 1
    FROM public.vacations v
    WHERE v.user_id = _user_id
      AND _slot_date BETWEEN v.starts_on AND v.ends_on
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'USER_ON_VACATION',
      'message', 'Šiai datai pasirinktos atostogos.'
    );
  END IF;

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date
        AND so.slot_time = _slot_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.active = true
        AND ts.slot_time = _slot_time
        AND (
          ts.one_off_date = _slot_date
          OR (
            ts.one_off_date IS NULL
            AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
          )
        )
      ORDER BY ts.max_capacity DESC
      LIMIT 1
    ),
    0
  )
  INTO v_capacity;

  IF v_capacity <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'SLOT_NOT_AVAILABLE',
      'message', 'Šio laiko grafike nėra.'
    );
  END IF;

  SELECT count(*)::integer
    INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel');

  IF v_booked_count >= v_capacity THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'SLOT_FULL',
      'message', 'Ši treniruotė jau pilna.'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time
      AND b.status IN ('active', 'pending_cancel')
  )
  INTO v_existing;

  IF v_existing THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'DUPLICATE_BOOKING',
      'message', 'Jūs jau užregistruoti į šią pamoką.',
      'subscription_exempt', v_is_exempt
    );
  END IF;

  v_is_permanent := EXISTS (
    SELECT 1
    FROM public.permanent_slots ps
    WHERE ps.user_id = _user_id
      AND ps.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
      AND ps.slot_time = _slot_time
  );

  v_weekly_slot := public.is_laura_weekly_registration_slot(
    _slot_date,
    _slot_time
  );

  IF v_weekly_slot
     AND NOT v_is_permanent
     AND NOT public.weekly_registration_window_is_open(_slot_date)
  THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'WEEKLY_REGISTRATION_NOT_OPEN',
      'message', 'Registracija į šią savaitę dar neatidaryta. Registracija atsidaro sekmadienį 01:00 val.',
      'subscription_exempt', v_is_exempt,
      'weekly_registration_restricted', true,
      'permanent_booking', false
    );
  END IF;

  v_enforcement_active := _slot_date >= DATE '2026-10-18';

  IF v_enforcement_active
     AND NOT v_is_exempt
     AND NOT v_is_permanent
  THEN
    v_subscription_usable := public.booking_subscription_is_usable_for_slot(
      _user_id,
      _slot_date,
      _slot_time
    );

    IF NOT v_subscription_usable THEN
      SELECT COUNT(*)::integer
        INTO v_grace_count
      FROM public.bookings b
      WHERE b.user_id = _user_id
        AND b.slot_date >= v_local_date
        AND b.status IN ('active', 'pending_cancel')
        AND b.subscription_id IS NULL
        AND b.counts_in_subscription IS NOT FALSE
        AND b.is_paused_for_subscription = false
        AND NOT public.booking_is_permanent(b.id);

      IF v_grace_count >= 1 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'GRACE_BOOKING_ALREADY_USED',
          'message', 'Be abonemento galima turėti tik vieną būsimą treniruotę. Norėdami registruotis toliau, pirmiausia įsigykite abonementą.',
          'subscription_exempt', false,
          'subscription_required', true,
          'grace_booking_used', true
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'bypass', false,
        'subscription_exempt', false,
        'subscription_required', true,
        'grace_booking', true,
        'grace_booking_used', false,
        'duplicate_protected', true
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bypass', false,
    'subscription_exempt', v_is_exempt,
    'permanent_booking', v_is_permanent,
    'weekly_registration_restricted', v_weekly_slot AND NOT v_is_permanent,
    'weekly_registration_window_open',
      NOT v_weekly_slot
      OR v_is_permanent
      OR public.weekly_registration_window_is_open(_slot_date),
    'subscription_required',
      v_enforcement_active AND NOT v_is_exempt AND NOT v_is_permanent,
    'subscription_usable', v_subscription_usable,
    'grace_booking', false,
    'duplicate_protected', true
  );
END;
$equus_eligibility$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Allocator: reserve against committed lessons, while lessons_used remains
--    completed-only. Lock the chosen subscription before the final check.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_booking_to_subscription(
  _booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_allocate$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_candidate public.subscriptions%ROWTYPE;
  v_allocation_number smallint;
  v_existing_allocation public.subscription_allocations%ROWTYPE;
  v_package_type text;
  v_capacity integer;
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

  IF v_booking.status = 'cancelled'
     OR v_booking.counts_in_subscription IS FALSE
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NOT_COUNTED'
    );
  END IF;

  IF v_booking.is_paused_for_subscription THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'PAUSED_FOR_SUBSCRIPTION'
    );
  END IF;

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

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = v_booking.slot_date
        AND so.slot_time = v_booking.slot_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.active = true
        AND ts.slot_time = v_booking.slot_time
        AND (
          ts.one_off_date = v_booking.slot_date
          OR (
            ts.one_off_date IS NULL
            AND ts.day_of_week = EXTRACT(ISODOW FROM v_booking.slot_date)::integer
          )
        )
      ORDER BY ts.max_capacity DESC
      LIMIT 1
    ),
    5
  )
  INTO v_capacity;

  IF v_booking.is_individual IS TRUE OR v_capacity = 1 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'INDIVIDUAL_NOT_SUBSCRIPTION_ELIGIBLE'
    );
  END IF;

  v_package_type := CASE
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  FOR v_candidate IN
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.user_id = v_booking.user_id
      AND COALESCE(s.paid, false) = true
      AND s.cancelled_at IS NULL
      AND COALESCE(s.lessons_total, 0) > 0
      AND COALESCE(s.start_from_date, s.purchase_date) <= v_booking.slot_date
      AND s.expires_at >= v_booking.slot_date
      AND (
        (s.package_type IS NULL AND s.lesson_type IS NULL)
        OR COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) = v_package_type
      )
    ORDER BY
      COALESCE(s.start_from_date, s.purchase_date),
      s.purchase_date,
      s.purchased_at,
      s.id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('equus-subscription:' || v_candidate.id::text, 0)
    );

    SELECT *
      INTO v_sub
    FROM public.subscriptions s
    WHERE s.id = v_candidate.id
    FOR UPDATE;

    IF FOUND
       AND public.subscription_committed_lessons(v_sub.id) < v_sub.lessons_total
    THEN
      EXIT;
    END IF;

    v_sub := NULL;
  END LOOP;

  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NO_USABLE_SUBSCRIPTION'
    );
  END IF;

  UPDATE public.bookings
  SET subscription_id = v_sub.id
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
    'reason', 'ALLOCATED',
    'package_type', v_package_type
  );
END;
$equus_allocate$;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Po2 booking: server calculates the extra fee and uses committed lessons.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_po2_with_subscription(
  _slot_date date,
  _slot_time time,
  _subscription_id uuid,
  _extra_fee_eur numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_allocation_number smallint;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  -- Kept in the signature for backwards compatibility; the server now owns
  -- the price calculation and never trusts this client-supplied value.
  IF _extra_fee_eur IS NULL THEN
    NULL;
  END IF;

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date
        AND so.slot_time = _slot_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.active = true
        AND (
          ts.one_off_date = _slot_date
          OR (
            ts.one_off_date IS NULL
            AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
          )
        )
        AND ts.slot_time = _slot_time
      ORDER BY ts.max_capacity DESC
      LIMIT 1
    ),
    0
  )
  INTO v_capacity;

  IF v_capacity <> 2 THEN
    RAISE EXCEPTION 'NOT_PO2_SLOT';
  END IF;

  SELECT count(*)::integer
    INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel');

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
  FROM public.subscriptions
  WHERE id = _subscription_id
    AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  IF NOT COALESCE(v_sub.paid, false) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_PAID';
  END IF;

  IF COALESCE(v_sub.start_from_date, v_sub.purchase_date) > _slot_date THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED';
  END IF;

  IF v_sub.expires_at < _slot_date THEN
    RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED';
  END IF;

  IF COALESCE(v_sub.lessons_total, 0) <= 0 THEN
    RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT';
  END IF;

  v_committed := public.subscription_committed_lessons(v_sub.id);

  IF v_committed >= v_sub.lessons_total THEN
    RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT';
  END IF;

  v_package_type := COALESCE(
    v_sub.package_type,
    CASE
      WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2'
      ELSE 'group'
    END
  );

  IF v_package_type NOT IN ('group', 'po2') THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
  END IF;

  IF v_package_type = 'po2' THEN
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
    trainer_name
  )
  VALUES (
    v_user,
    _slot_date,
    _slot_time,
    'active',
    _subscription_id,
    true,
    v_extra_fee,
    false,
    v_trainer_name
  )
  RETURNING id INTO v_booking;

  SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
    INTO v_allocation_number
  FROM public.subscription_allocations sa
  WHERE sa.subscription_id = _subscription_id;

  INSERT INTO public.subscription_allocations(
    subscription_id,
    booking_id,
    allocation_number,
    status
  )
  VALUES (
    _subscription_id,
    v_booking,
    v_allocation_number,
    'allocated'
  )
  ON CONFLICT (subscription_id, booking_id) DO NOTHING;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking,
    'subscription_id', _subscription_id,
    'extra_fee_eur', v_extra_fee
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric)
TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Use the horse's configured daily limit instead of a hardcoded 2.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_horse_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  SELECT GREATEST(COALESCE(h.max_daily_rides, 2), 0)
    INTO v_limit
  FROM public.horses h
  WHERE h.id = NEW.horse_id;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'HORSE_NOT_FOUND';
  END IF;

  SELECT count(*)
    INTO v_count
  FROM public.horse_assignments ha
  WHERE ha.horse_id = NEW.horse_id
    AND ha.slot_date = NEW.slot_date
    AND ha.id <> COALESCE(
      NEW.id,
      '00000000-0000-0000-0000-000000000000'::uuid
    );

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'HORSE_LIMIT_REACHED'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.enforce_horse_daily_limit()
FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. materialize_permanent_bookings mutates all riders' bookings and must not
--    be callable by ordinary authenticated users.
-- ---------------------------------------------------------------------------

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date, date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date, date)
TO service_role;
