-- Equus: canonical subscription + recurring-booking rules
-- Approved business rules:
--   * lessons_used = COMPLETED lessons only
--   * ordinary future bookings stay unattached until completion
--   * one grace/advance future booking without a subscription is allowed
--   * buying a new subscription may explicitly claim the next reservation as its first lesson
--   * recurring future bookings can be paused without occupying slot capacity
--   * restoring paused recurring bookings only happens when there is real capacity
--   * completed booking history is never rewritten by recurring-time changes
--   * recurring-time changes CANCEL the old future occurrence + CREATE a new occurrence
--   * released subscription allocations remain audit history; current booking attribution
--     has exactly one live allocation
--   * old subscriptions are automatically removed one month after expiry
--
-- This migration is additive and intentionally does not edit previously-applied migrations.

-- ---------------------------------------------------------------------------
-- 1. Canonical slot/package helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.equus_effective_slot_capacity(
  _slot_date date,
  _slot_time time
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT so.max_capacity::integer
      FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date
        AND so.slot_time = _slot_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity::integer
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
  );
$$;

REVOKE ALL
ON FUNCTION public.equus_effective_slot_capacity(date,time)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.equus_effective_slot_capacity(date,time)
TO service_role;


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
      AND (
        CASE
          WHEN b.is_individual IS TRUE
               OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1
            THEN 'individual'
          WHEN public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 2
            THEN 'po2'
          ELSE 'group'
        END
      ) = _package_type
  );
$$;

REVOKE ALL
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
TO service_role;


-- ---------------------------------------------------------------------------
-- 2. lessons_used = completed-only; committed = completed + future attached
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
        AND public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        )
        AND b.slot_date BETWEEN
          COALESCE(s.start_from_date, s.purchase_date)
          AND s.expires_at
    ),
    0
  )::smallint
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id;
$$;

REVOKE ALL
ON FUNCTION public.subscription_committed_lessons(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.subscription_committed_lessons(uuid)
TO service_role;


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
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.slot_date BETWEEN
      COALESCE(s.start_from_date, s.purchase_date)
      AND s.expires_at
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    );

  UPDATE public.subscriptions
  SET lessons_used = LEAST(v_total, v_used)
  WHERE id = _subscription_id;

  RETURN LEAST(v_total, v_used);
END;
$$;

REVOKE ALL
ON FUNCTION public.reconcile_subscription_usage(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reconcile_subscription_usage(uuid)
TO service_role;


-- ---------------------------------------------------------------------------
-- 3. One canonical allocation writer + concurrency lock
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_subscription_allocation(
  _booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_allocation_id uuid;
  v_allocation_number smallint;
BEGIN
  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_booking.subscription_id IS NULL
     OR v_booking.status = 'cancelled'
     OR v_booking.counts_in_subscription IS FALSE
  THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = v_booking.subscription_id
    AND user_id = v_booking.user_id
    AND paid = true
    AND cancelled_at IS NULL
    AND v_booking.slot_date BETWEEN
      COALESCE(start_from_date, purchase_date)
      AND expires_at
    AND booking_matches_subscription_package(
      v_booking.id,
      COALESCE(
        package_type,
        CASE WHEN lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'equus-subscription-allocation:' || v_sub.id::text,
      0
    )
  );

  SELECT id
    INTO v_allocation_id
  FROM public.subscription_allocations
  WHERE subscription_id = v_sub.id
    AND booking_id = v_booking.id
  LIMIT 1;

  IF v_allocation_id IS NOT NULL THEN
    UPDATE public.subscription_allocations
    SET
      status = CASE
        WHEN v_booking.status = 'completed' THEN 'consumed'
        ELSE 'allocated'
      END,
      consumed_at = CASE
        WHEN v_booking.status = 'completed'
          THEN COALESCE(consumed_at, now())
        ELSE consumed_at
      END,
      released_at = NULL
    WHERE id = v_allocation_id;

    RETURN v_allocation_id;
  END IF;

  SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
    INTO v_allocation_number
  FROM public.subscription_allocations sa
  WHERE sa.subscription_id = v_sub.id;

  INSERT INTO public.subscription_allocations (
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
    CASE
      WHEN v_booking.status = 'completed' THEN 'consumed'
      ELSE 'allocated'
    END,
    CASE
      WHEN v_booking.status = 'completed' THEN now()
      ELSE NULL
    END
  )
  RETURNING id INTO v_allocation_id;

  RETURN v_allocation_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.ensure_subscription_allocation(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.ensure_subscription_allocation(uuid)
TO service_role;


CREATE OR REPLACE FUNCTION public.sync_subscription_usage_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_trigger$
DECLARE
  v_old_sub uuid;
  v_new_sub uuid;
BEGIN
  v_old_sub := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.subscription_id
    ELSE NULL
  END;

  v_new_sub := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.subscription_id
    ELSE NULL
  END;

  IF TG_OP IN ('UPDATE', 'DELETE')
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
        WHEN TG_OP = 'DELETE'
          OR NEW.status = 'cancelled'
          OR NEW.counts_in_subscription IS FALSE
          THEN 'released'
        WHEN NEW.status = 'completed'
          THEN 'consumed'
        ELSE 'allocated'
      END,
      released_at = CASE
        WHEN TG_OP = 'DELETE'
          OR NEW.status = 'cancelled'
          OR NEW.counts_in_subscription IS FALSE
          THEN COALESCE(released_at, now())
        ELSE NULL
      END,
      consumed_at = CASE
        WHEN TG_OP = 'UPDATE'
          AND NEW.status = 'completed'
          AND NEW.counts_in_subscription IS NOT FALSE
          THEN COALESCE(consumed_at, now())
        ELSE consumed_at
      END
    WHERE subscription_id = v_old_sub
      AND booking_id = OLD.id;

    PERFORM public.reconcile_subscription_usage(v_old_sub);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND v_new_sub IS NOT NULL
     AND NEW.status <> 'cancelled'
     AND NEW.counts_in_subscription IS NOT FALSE
  THEN
    PERFORM public.ensure_subscription_allocation(NEW.id);
    PERFORM public.reconcile_subscription_usage(v_new_sub);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$equus_trigger$;

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


-- ---------------------------------------------------------------------------
-- 4. Package-aware usability + completion-only allocator
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_subscription_is_usable_for_slot(
  _user_id uuid,
  _slot_date date,
  _slot_time time
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_slot_sub$
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

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
      AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) = v_package_type
  );
END;
$equus_slot_sub$;

REVOKE ALL
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time)
TO authenticated, service_role;


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

  -- Ordinary future reservations stay unattached until completion.
  IF v_booking.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'WAIT_UNTIL_COMPLETED'
    );
  END IF;

  -- Existing attribution is kept only when the referenced subscription is
  -- still valid for this exact booking. Otherwise recover it below.
  IF v_booking.subscription_id IS NOT NULL THEN
    SELECT *
      INTO v_sub
    FROM public.subscriptions s
    WHERE s.id = v_booking.subscription_id
      AND s.user_id = v_booking.user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND v_booking.slot_date BETWEEN
        COALESCE(s.start_from_date, s.purchase_date)
        AND s.expires_at
      AND public.booking_matches_subscription_package(
        v_booking.id,
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        )
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

    -- Broken/orphan/incorrect attribution is not allowed to remain attached.
    UPDATE public.bookings
    SET
      subscription_id = NULL,
      counts_in_subscription = true,
      is_grace_booking = false
    WHERE id = v_booking.id;

    v_booking.subscription_id := NULL;
  END IF;

  -- FIFO among subscriptions whose actual validity period covers the lesson
  -- and whose package matches the actual slot. Future reservations already
  -- explicitly attached to a subscription also count as committed capacity.
  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_booking.user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND COALESCE(s.lessons_total, 0) > 0
    AND COALESCE(s.start_from_date, s.purchase_date) <= v_booking.slot_date
    AND s.expires_at >= v_booking.slot_date
    AND public.booking_matches_subscription_package(
      v_booking.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    )
    AND public.subscription_committed_lessons(s.id) < s.lessons_total
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
$equus_allocate$;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;


-- ---------------------------------------------------------------------------
-- 5. Eligibility: paused bookings do NOT occupy capacity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_booking_eligibility(
  _user_id uuid,
  _slot_date date,
  _slot_time time,
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

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

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
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;

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
ON FUNCTION public.check_booking_eligibility(uuid,date,time,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time,boolean)
TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6. Pause/restore model for recurring bookings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase_final$
DECLARE
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_keep_id uuid;
  v_paused integer := 0;
  r record;
BEGIN
  IF _user_id IS NULL
     OR public.has_role(_user_id, 'admin')
     OR public.is_subscription_rule_exempt(_user_id)
  THEN
    RETURN 0;
  END IF;

  SELECT b.id
    INTO v_keep_id
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= v_local_date
    AND b.status = 'active'
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS NOT FALSE
    AND b.is_paused_for_subscription = false
    AND NOT public.booking_is_permanent(b.id)
  ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LIMIT 1;

  PERFORM set_config(
    'equus.allow_subscription_pause_update',
    'true',
    true
  );

  -- Permanent recurring reservations do not use the one-booking grace.
  -- Without a valid subscription they are all paused; their permanent slot
  -- remains intact.
  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= v_local_date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND public.booking_is_permanent(b.id)
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET
      is_paused_for_subscription = true,
      is_grace_booking = false
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  -- Among ordinary future reservations keep exactly one grace booking.
  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= v_local_date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND NOT public.booking_is_permanent(b.id)
      AND b.id IS DISTINCT FROM v_keep_id
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET
      is_paused_for_subscription = true,
      is_grace_booking = false
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  IF v_keep_id IS NOT NULL THEN
    UPDATE public.bookings
    SET is_grace_booking = true
    WHERE id = v_keep_id;
  END IF;

  RETURN v_paused;
END;
$phase_final$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;


CREATE OR REPLACE FUNCTION public.restore_paused_bookings_for_subscription(
  _subscription_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $restore_final$
DECLARE
  v_user_id uuid;
  v_lessons_total smallint;
  v_start_date date;
  v_expires_at date;
  v_package_type text;
  v_committed smallint := 0;
  v_reserved_permanent integer := 0;
  v_restored integer := 0;
  v_local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  r record;
BEGIN
  SELECT
    s.user_id,
    s.lessons_total,
    COALESCE(s.start_from_date, s.purchase_date),
    s.expires_at,
    COALESCE(
      s.package_type,
      CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
    )
  INTO
    v_user_id,
    v_lessons_total,
    v_start_date,
    v_expires_at,
    v_package_type
  FROM public.subscriptions s
  WHERE s.id = _subscription_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  SELECT public.subscription_committed_lessons(_subscription_id)
    INTO v_committed;

  SELECT count(*)::integer
    INTO v_reserved_permanent
  FROM public.bookings b
  WHERE b.user_id = v_user_id
    AND b.status = 'active'
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS NOT FALSE
    AND b.is_paused_for_subscription = false
    AND public.booking_is_permanent(b.id)
    AND b.slot_date BETWEEN v_start_date AND v_expires_at
    AND (
      b.slot_date > v_local_now::date
      OR (
        b.slot_date = v_local_now::date
        AND b.slot_time >= v_local_now::time
      )
    );

  FOR r IN
    SELECT b.id, b.slot_date, b.slot_time
    FROM public.bookings b
    WHERE b.user_id = v_user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = true
      AND public.booking_is_permanent(b.id)
      AND b.slot_date BETWEEN v_start_date AND v_expires_at
      AND (
        b.slot_date > v_local_now::date
        OR (
          b.slot_date = v_local_now::date
          AND b.slot_time >= v_local_now::time
        )
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    EXIT WHEN v_committed + v_reserved_permanent >= v_lessons_total;

    IF NOT public.booking_matches_subscription_package(
      r.id,
      v_package_type
    ) THEN
      CONTINUE;
    END IF;

    IF (
      SELECT count(*)
      FROM public.bookings occupied
      WHERE occupied.slot_date = r.slot_date
        AND occupied.slot_time = r.slot_time
        AND occupied.status IN ('active', 'pending_cancel')
        AND occupied.is_paused_for_subscription IS NOT TRUE
        AND occupied.id <> r.id
    ) >= public.equus_effective_slot_capacity(r.slot_date, r.slot_time)
    THEN
      CONTINUE;
    END IF;

    PERFORM set_config(
      'equus.allow_subscription_pause_update',
      'true',
      true
    );

    UPDATE public.bookings
    SET
      is_paused_for_subscription = false,
      is_grace_booking = false
    WHERE id = r.id
      AND is_paused_for_subscription = true;

    IF FOUND THEN
      v_reserved_permanent := v_reserved_permanent + 1;
      v_restored := v_restored + 1;
    END IF;
  END LOOP;

  RETURN v_restored;
END;
$restore_final$;

REVOKE ALL
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
TO service_role;


CREATE OR REPLACE FUNCTION public.restore_paused_bookings_after_subscription_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $restore_trigger$
BEGIN
  IF NEW.paid = true
     AND NEW.cancelled_at IS NULL
     AND COALESCE(
       current_setting('equus.defer_subscription_restore', true),
       'false'
     ) <> 'true'
  THEN
    PERFORM public.restore_paused_bookings_for_subscription(NEW.id);
  END IF;

  RETURN NEW;
END;
$restore_trigger$;

DROP TRIGGER IF EXISTS trg_restore_paused_bookings_after_subscription_purchase
ON public.subscriptions;

CREATE TRIGGER trg_restore_paused_bookings_after_subscription_purchase
AFTER INSERT ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.restore_paused_bookings_after_subscription_purchase();


CREATE OR REPLACE FUNCTION public.enforce_subscription_requirement_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $deadline_final$
DECLARE
  local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  paused_count integer := 0;
  r record;
  v_booking_id uuid;
  v_deadline timestamp;
  v_slot_date date;
  v_slot_time time;
BEGIN
  FOR r IN
    SELECT DISTINCT b.user_id
    FROM public.bookings b
    WHERE b.user_id IS NOT NULL
      AND b.slot_date >= DATE '2026-10-18'
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND NOT public.has_role(b.user_id, 'admin')
      AND NOT public.is_subscription_rule_exempt(b.user_id)
  LOOP
    SELECT
      b.id,
      b.slot_date,
      b.slot_time
    INTO
      v_booking_id,
      v_slot_date,
      v_slot_time
    FROM public.bookings b
    WHERE b.user_id = r.user_id
      AND b.slot_date >= DATE '2026-10-18'
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    IF v_booking_id IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM public.queue_subscription_requirement_warning(v_booking_id);

    IF public.booking_subscription_is_usable_for_slot(
      r.user_id,
      v_slot_date,
      v_slot_time
    ) THEN
      CONTINUE;
    END IF;

    v_deadline := (v_slot_date - 2) + time '20:00';

    IF local_now >= v_deadline THEN
      paused_count := paused_count
        + public.pause_uncovered_future_bookings(r.user_id);
    END IF;
  END LOOP;

  RETURN paused_count;
END;
$deadline_final$;

REVOKE ALL
ON FUNCTION public.enforce_subscription_requirement_deadlines()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enforce_subscription_requirement_deadlines()
TO service_role;


-- ---------------------------------------------------------------------------
-- 7. Canonical recurring materializer: paused occurrences do not occupy seats
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $materialize_final$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
  v_capacity integer;
  v_occupied integer;
  v_has_subscription boolean;
  v_pause boolean;
BEGIN
  IF _end < _start THEN
    RETURN 0;
  END IF;

  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;

    WHILE d <= _end LOOP
      IF EXTRACT(ISODOW FROM d)::integer = ps.day_of_week
        AND NOT EXISTS (
          SELECT 1
          FROM public.slot_overrides so
          WHERE so.slot_date = d
            AND so.slot_time = ps.slot_time
            AND so.max_capacity = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.permanent_booking_exceptions pbe
          WHERE pbe.user_id = ps.user_id
            AND pbe.slot_date = d
            AND pbe.slot_time = ps.slot_time
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.vacations v
          WHERE v.user_id = ps.user_id
            AND d BETWEEN v.starts_on AND v.ends_on
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.user_id = ps.user_id
            AND b.slot_date = d
            AND b.slot_time = ps.slot_time
            AND b.status IN ('active', 'pending_cancel')
        )
        AND (
          d > (now() AT TIME ZONE 'Europe/Vilnius')::date
          OR make_timestamptz(
            EXTRACT(YEAR FROM d)::integer,
            EXTRACT(MONTH FROM d)::integer,
            EXTRACT(DAY FROM d)::integer,
            EXTRACT(HOUR FROM ps.slot_time)::integer,
            EXTRACT(MINUTE FROM ps.slot_time)::integer,
            EXTRACT(SECOND FROM ps.slot_time),
            'Europe/Vilnius'
          ) >= now() + interval '3 hours'
        )
      THEN
        v_capacity := public.equus_effective_slot_capacity(d, ps.slot_time);

        SELECT count(*)::integer
          INTO v_occupied
        FROM public.bookings occupied
        WHERE occupied.slot_date = d
          AND occupied.slot_time = ps.slot_time
          AND occupied.status IN ('active', 'pending_cancel')
          AND occupied.is_paused_for_subscription IS NOT TRUE;

        v_has_subscription :=
          d < DATE '2026-10-18'
          OR public.booking_subscription_is_usable_for_slot(
            ps.user_id,
            d,
            ps.slot_time
          );

        v_pause := NOT v_has_subscription OR v_occupied >= v_capacity;

        BEGIN
          INSERT INTO public.bookings (
            user_id,
            slot_date,
            slot_time,
            status,
            counts_in_subscription,
            is_paused_for_subscription,
            is_grace_booking
          )
          VALUES (
            ps.user_id,
            d,
            ps.slot_time,
            'active',
            true,
            v_pause,
            false
          );

          inserted_count := inserted_count + 1;
        EXCEPTION
          WHEN unique_violation THEN
            NULL;
        END;
      END IF;

      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$materialize_final$;

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date,date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date,date)
TO service_role;


-- ---------------------------------------------------------------------------
-- 8. Waitlist: paused cancellations must not open a seat
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.promote_from_waiting_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $waitlist_final$
DECLARE
  next_user uuid;
  next_id uuid;
  slot_date_value date;
  slot_time_value time;
BEGIN
  slot_date_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.slot_date ELSE NEW.slot_date END;
  slot_time_value := CASE WHEN TG_OP = 'DELETE' THEN OLD.slot_time ELSE NEW.slot_time END;

  IF (
    (TG_OP = 'UPDATE'
      AND OLD.status = 'active'
      AND NEW.status <> 'active'
      AND OLD.is_paused_for_subscription IS NOT TRUE)
    OR
    (TG_OP = 'DELETE'
      AND OLD.status = 'active'
      AND OLD.is_paused_for_subscription IS NOT TRUE)
  )
  AND COALESCE(
    current_setting('equus.skip_waitlist_promotion', true),
    'false'
  ) <> 'true'
  THEN
    SELECT id, user_id
      INTO next_id, next_user
    FROM public.waiting_list
    WHERE slot_date = slot_date_value
      AND slot_time = slot_time_value
    ORDER BY created_at ASC
    LIMIT 1;

    IF next_user IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.bookings
        WHERE user_id = next_user
          AND slot_date = slot_date_value
          AND slot_time = slot_time_value
          AND status IN ('active', 'pending_cancel')
      ) THEN
        INSERT INTO public.bookings (
          user_id,
          slot_date,
          slot_time,
          status
        )
        VALUES (
          next_user,
          slot_date_value,
          slot_time_value,
          'active'
        )
        ON CONFLICT DO NOTHING;
      END IF;

      DELETE FROM public.waiting_list
      WHERE id = next_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$waitlist_final$;

DROP TRIGGER IF EXISTS trg_promote_after_cancel
ON public.bookings;

CREATE TRIGGER trg_promote_after_cancel
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.promote_from_waiting_list();


-- ---------------------------------------------------------------------------
-- 9. Recurring time change = cancel old future occurrences + create new ones
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_apply_recurring_time_change(
  _slot_id uuid,
  _new_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $recurring_time_final$
DECLARE
  caller uuid := auth.uid();
  slot_row public.time_slots%ROWTYPE;
  old_time time;
  tomorrow date := (now() AT TIME ZONE 'Europe/Vilnius')::date + 1;
  affected_users uuid[];
  affected_count integer := 0;
  created_count integer := 0;
  v_old public.bookings%ROWTYPE;
  v_new_booking_id uuid;
  v_capacity integer;
  v_occupied integer;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT *
    INTO slot_row
  FROM public.time_slots
  WHERE id = _slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  IF slot_row.one_off_date IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_RECURRING_SLOT';
  END IF;

  old_time := slot_row.slot_time;

  IF old_time = _new_time THEN
    RETURN jsonb_build_object(
      'ok', true,
      'bookings_recreated', 0
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.time_slots x
    WHERE x.id <> slot_row.id
      AND x.active
      AND x.one_off_date IS NULL
      AND x.day_of_week = slot_row.day_of_week
      AND x.slot_time = _new_time
      AND x.trainer_name IS NOT DISTINCT FROM slot_row.trainer_name
  ) THEN
    RAISE EXCEPTION 'TARGET_TIME_EXISTS';
  END IF;

  SELECT ARRAY_AGG(DISTINCT ps.user_id)
    INTO affected_users
  FROM public.permanent_slots ps
  WHERE ps.day_of_week = slot_row.day_of_week
    AND ps.slot_time = old_time;

  IF affected_users IS NULL THEN
    affected_users := ARRAY[]::uuid[];
  END IF;

  -- Any affected rider who already has the target-time occurrence causes a
  -- real conflict; do not partially apply the change.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = ANY(affected_users)
      AND b.slot_date >= tomorrow
      AND b.slot_time = _new_time
      AND b.status IN ('active', 'pending_cancel')
  ) THEN
    RAISE EXCEPTION 'RECURRING_MOVE_CONFLICT';
  END IF;

  -- Capacity preflight. Paused bookings do not occupy seats.
  FOR v_old IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.user_id = ANY(affected_users)
      AND b.slot_time = old_time
      AND b.slot_date >= tomorrow
      AND b.status IN ('active', 'pending_cancel')
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    v_capacity := public.equus_effective_slot_capacity(
      v_old.slot_date,
      _new_time
    );

    SELECT count(*)::integer
      INTO v_occupied
    FROM public.bookings c
    WHERE c.slot_date = v_old.slot_date
      AND c.slot_time = _new_time
      AND c.status IN ('active', 'pending_cancel')
      AND c.is_paused_for_subscription IS NOT TRUE;

    IF v_occupied >= v_capacity THEN
      RAISE EXCEPTION 'RECURRING_MOVE_CONFLICT';
    END IF;
  END LOOP;

  PERFORM set_config(
    'equus.skip_waitlist_promotion',
    'true',
    true
  );

  -- Update the canonical weekly templates first so the new booking is
  -- recognized as the current permanent occurrence.
  UPDATE public.time_slots
  SET slot_time = _new_time
  WHERE id = slot_row.id;

  UPDATE public.permanent_slots
  SET slot_time = _new_time
  WHERE day_of_week = slot_row.day_of_week
    AND slot_time = old_time;

  -- Recreate future occurrences one-by-one. Completed and past history is
  -- untouched. Existing booking attribution, grace state, and horse
  -- assignments are carried forward.
  FOR v_old IN
    SELECT b.*
    FROM public.bookings b
    WHERE b.user_id = ANY(affected_users)
      AND b.slot_time = old_time
      AND b.slot_date >= tomorrow
      AND b.status IN ('active', 'pending_cancel')
      AND public.booking_is_permanent(b.id)
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    v_capacity := public.equus_effective_slot_capacity(
      v_old.slot_date,
      _new_time
    );

    SELECT count(*)::integer
      INTO v_occupied
    FROM public.bookings c
    WHERE c.slot_date = v_old.slot_date
      AND c.slot_time = _new_time
      AND c.status IN ('active', 'pending_cancel')
      AND c.is_paused_for_subscription IS NOT TRUE;

    -- The old occurrence is not at the target slot, so only current target
    -- occupancy matters here.
    IF v_occupied >= v_capacity THEN
      RAISE EXCEPTION 'RECURRING_MOVE_CONFLICT';
    END IF;

    UPDATE public.bookings
    SET
      status = 'cancelled',
      counts_in_subscription = false,
      updated_at = now()
    WHERE id = v_old.id;

    INSERT INTO public.bookings (
      user_id,
      slot_date,
      slot_time,
      status,
      subscription_id,
      counts_in_subscription,
      is_individual,
      guest_name,
      is_guest,
      guest_rider_id,
      trainer_name,
      extra_fee_eur,
      extra_fee_paid,
      is_paused_for_subscription,
      is_grace_booking,
      created_at
    )
    VALUES (
      v_old.user_id,
      v_old.slot_date,
      _new_time,
      v_old.status,
      v_old.subscription_id,
      v_old.counts_in_subscription,
      v_old.is_individual,
      v_old.guest_name,
      v_old.is_guest,
      v_old.guest_rider_id,
      v_old.trainer_name,
      v_old.extra_fee_eur,
      v_old.extra_fee_paid,
      v_old.is_paused_for_subscription,
      v_old.is_grace_booking,
      v_old.created_at
    )
    RETURNING id INTO v_new_booking_id;

    UPDATE public.horse_assignments
    SET
      booking_id = v_new_booking_id,
      slot_time = _new_time
    WHERE booking_id = v_old.id;

    created_count := created_count + 1;
  END LOOP;

  -- Repair stale/missing future occurrences without touching existing
  -- completed history.
  created_count := created_count
    + public.materialize_permanent_bookings(
        tomorrow,
        tomorrow + 120
      );

  PERFORM set_config(
    'equus.skip_waitlist_promotion',
    'false',
    true
  );

  SELECT count(DISTINCT ps.user_id)
    INTO affected_count
  FROM public.permanent_slots ps
  WHERE ps.day_of_week = slot_row.day_of_week
    AND ps.slot_time = _new_time;

  RETURN jsonb_build_object(
    'ok', true,
    'bookings_recreated', created_count,
    'permanent_riders_affected', affected_count,
    'old_time', old_time,
    'new_time', _new_time
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'equus.skip_waitlist_promotion',
      'false',
      true
    );
    RAISE;
END;
$recurring_time_final$;

REVOKE ALL
ON FUNCTION public.admin_apply_recurring_time_change(uuid,time)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_apply_recurring_time_change(uuid,time)
TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10. Purchase engine: actual first lesson starts the new subscription
-- ---------------------------------------------------------------------------

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
SET search_path = public
AS $purchase_wrapper$
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
$purchase_wrapper$;

REVOKE ALL
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
TO authenticated;


-- ---------------------------------------------------------------------------
-- 11. Po2 booking: preserve explicit future subscription booking, but never
--     hand-calculate allocation numbers
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
AS $po2_final$
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
    trainer_name,
    is_grace_booking
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
    v_trainer_name,
    false
  )
  RETURNING id INTO v_booking;

  SELECT id
    INTO v_allocation_id
  FROM public.subscription_allocations
  WHERE subscription_id = _subscription_id
    AND booking_id = v_booking
  LIMIT 1;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking,
    'subscription_id', _subscription_id,
    'extra_fee_eur', v_extra_fee,
    'allocation_id', v_allocation_id
  );
END;
$po2_final$;

REVOKE ALL
ON FUNCTION public.book_po2_with_subscription(date,time,uuid,numeric)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.book_po2_with_subscription(date,time,uuid,numeric)
TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 12. One-month old subscription cleanup (approved rule)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_old_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cleanup_old_subs$
DECLARE
  v_removed integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.expires_at < (
      (now() AT TIME ZONE 'Europe/Vilnius')::date - INTERVAL '1 month'
    )
    ORDER BY s.expires_at, s.id
  LOOP
    INSERT INTO public.subscription_audit_log (
      target_user_id,
      subscription_id,
      action,
      old_value,
      metadata
    )
    VALUES (
      r.user_id,
      r.id,
      'subscription_auto_deleted',
      jsonb_build_object(
        'lessons_total', r.lessons_total,
        'lessons_used', r.lessons_used,
        'purchase_date', r.purchase_date,
        'start_from_date', r.start_from_date,
        'expires_at', r.expires_at
      ),
      jsonb_build_object(
        'reason', 'one_month_after_expiry'
      )
    );

    UPDATE public.bookings
    SET
      subscription_id = NULL,
      counts_in_subscription = false,
      is_grace_booking = false
    WHERE subscription_id = r.id;

    DELETE FROM public.subscription_allocations
    WHERE subscription_id = r.id;

    DELETE FROM public.email_events
    WHERE subscription_id = r.id;

    DELETE FROM public.subscription_payments
    WHERE subscription_id = r.id;

    DELETE FROM public.subscriptions
    WHERE id = r.id;

    v_removed := v_removed + 1;
  END LOOP;

  RETURN v_removed;
END;
$cleanup_old_subs$;

REVOKE ALL
ON FUNCTION public.cleanup_old_subscriptions()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cleanup_old_subscriptions()
TO service_role;


CREATE OR REPLACE FUNCTION public.cleanup_old_fully_used_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cleanup_old_fully_used$
BEGIN
  RETURN public.cleanup_old_subscriptions();
END;
$cleanup_old_fully_used$;

REVOKE ALL
ON FUNCTION public.cleanup_old_fully_used_subscriptions()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cleanup_old_fully_used_subscriptions()
TO service_role;


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'equus-cleanup-old-fully-used-subscriptions'
  ) THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'equus-cleanup-old-fully-used-subscriptions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'equus-cleanup-old-subscriptions'
  ) THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'equus-cleanup-old-subscriptions';
  END IF;

  PERFORM cron.schedule(
    'equus-cleanup-old-subscriptions',
    '15 3 * * *',
    $cron$SELECT public.cleanup_old_subscriptions();$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END
$$;


-- ---------------------------------------------------------------------------
-- 13. Repair existing historical attribution safely + normalize allocation metadata
-- ---------------------------------------------------------------------------

DO $repair_existing$
DECLARE
  b record;
  v_candidate uuid;
  v_old_sub uuid;
  v_changed integer := 0;
BEGIN
  -- 13a. Completed rows with missing, orphaned, or invalid subscription links:
  -- select the oldest valid subscription whose real period covers the lesson.
  FOR b IN
    SELECT b.*
    FROM public.bookings b
    LEFT JOIN public.subscriptions s
      ON s.id = b.subscription_id
    WHERE b.status = 'completed'
      AND b.counts_in_subscription IS NOT FALSE
      AND (
        b.subscription_id IS NULL
        OR s.id IS NULL
        OR s.user_id IS DISTINCT FROM b.user_id
        OR s.paid IS NOT TRUE
        OR s.cancelled_at IS NOT NULL
        OR b.slot_date NOT BETWEEN
          COALESCE(s.start_from_date, s.purchase_date)
          AND s.expires_at
        OR NOT public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        )
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    v_old_sub := b.subscription_id;
    v_candidate := NULL;

    SELECT s.id
      INTO v_candidate
    FROM public.subscriptions s
    WHERE s.user_id = b.user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND COALESCE(s.start_from_date, s.purchase_date) <= b.slot_date
      AND s.expires_at >= b.slot_date
      AND public.booking_matches_subscription_package(
        b.id,
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        )
      )
    ORDER BY
      COALESCE(s.start_from_date, s.purchase_date),
      s.purchase_date,
      s.purchased_at,
      s.id
    LIMIT 1;

    IF v_candidate IS NOT NULL THEN
      UPDATE public.bookings
      SET
        subscription_id = v_candidate,
        counts_in_subscription = true,
        is_grace_booking = false,
        updated_at = now()
      WHERE id = b.id;

      INSERT INTO public.subscription_audit_log (
        target_user_id,
        subscription_id,
        booking_id,
        action,
        old_value,
        new_value,
        metadata
      )
      VALUES (
        b.user_id,
        v_candidate,
        b.id,
        'subscription_attribution_repaired',
        jsonb_build_object('subscription_id', v_old_sub),
        jsonb_build_object('subscription_id', v_candidate),
        jsonb_build_object(
          'reason',
          CASE
            WHEN v_old_sub IS NULL THEN 'completed_booking_was_unassigned'
            WHEN v_old_sub IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.subscriptions sx WHERE sx.id = v_old_sub
            ) THEN 'completed_booking_pointed_to_missing_subscription'
            ELSE 'completed_booking_pointed_to_invalid_subscription'
          END
        )
      );

      v_changed := v_changed + 1;
    ELSIF v_old_sub IS NOT NULL THEN
      -- Do not invent a subscription. Leave the lesson completed, but remove
      -- the broken link so it is visible as an unassigned historical lesson.
      UPDATE public.bookings
      SET
        subscription_id = NULL,
        counts_in_subscription = true,
        is_grace_booking = false,
        updated_at = now()
      WHERE id = b.id;

      INSERT INTO public.subscription_audit_log (
        target_user_id,
        booking_id,
        action,
        old_value,
        new_value,
        metadata
      )
      VALUES (
        b.user_id,
        b.id,
        'subscription_attribution_unresolved',
        jsonb_build_object('subscription_id', v_old_sub),
        jsonb_build_object('subscription_id', NULL),
        jsonb_build_object(
          'reason',
          'no_valid_subscription_period_and_package_candidate'
        )
      );
    END IF;
  END LOOP;

  -- 13b. Future rows pointing at a deleted/invalid subscription are detached.
  -- Ordinary future reservations remain unassigned until completion.
  FOR b IN
    SELECT b.*
    FROM public.bookings b
    LEFT JOIN public.subscriptions s
      ON s.id = b.subscription_id
    WHERE b.status IN ('active', 'pending_cancel')
      AND b.subscription_id IS NOT NULL
      AND (
        s.id IS NULL
        OR s.user_id IS DISTINCT FROM b.user_id
        OR s.paid IS NOT TRUE
        OR s.cancelled_at IS NOT NULL
        OR b.slot_date NOT BETWEEN
          COALESCE(s.start_from_date, s.purchase_date)
          AND s.expires_at
        OR NOT public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        )
      )
  LOOP
    v_old_sub := b.subscription_id;

    UPDATE public.bookings
    SET
      subscription_id = NULL,
      counts_in_subscription = true,
      is_grace_booking = false,
      updated_at = now()
    WHERE id = b.id;

    INSERT INTO public.subscription_audit_log (
      target_user_id,
      booking_id,
      action,
      old_value,
      new_value,
      metadata
    )
    VALUES (
      b.user_id,
      b.id,
      'future_subscription_attribution_cleared',
      jsonb_build_object('subscription_id', v_old_sub),
      jsonb_build_object('subscription_id', NULL),
      jsonb_build_object(
        'reason',
        'future_booking_pointed_to_invalid_subscription'
      )
    );
  END LOOP;

  -- 13c. Any allocation no longer matching the booking is released, not deleted.
  UPDATE public.subscription_allocations sa
  SET
    status = 'released',
    released_at = COALESCE(sa.released_at, now())
  FROM public.bookings b
  WHERE b.id = sa.booking_id
    AND sa.subscription_id IS DISTINCT FROM b.subscription_id
    AND sa.status <> 'released';

  -- 13d. Recreate/repair allocation metadata for every currently attached
  -- counted active/completed booking. Allocation numbers are concurrency-safe
  -- because ensure_subscription_allocation() locks the subscription.
  FOR b IN
    SELECT b.id
    FROM public.bookings b
    JOIN public.subscriptions s
      ON s.id = b.subscription_id
    WHERE b.status IN ('active', 'pending_cancel', 'completed')
      AND b.counts_in_subscription IS NOT FALSE
      AND b.slot_date BETWEEN
        COALESCE(s.start_from_date, s.purchase_date)
        AND s.expires_at
      AND public.booking_matches_subscription_package(
        b.id,
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        )
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    PERFORM public.ensure_subscription_allocation(b.id);
  END LOOP;

  -- 13e. Recompute every subscription counter from completed booking truth.
  FOR b IN
    SELECT id
    FROM public.subscriptions
  LOOP
    PERFORM public.reconcile_subscription_usage(b.id);
  END LOOP;

  -- 13f. Safe cleanup of stale duplicate future recurring occurrences:
  -- only cancel an old occurrence when the same rider/date already has the
  -- current recurring occurrence. Never touch completed history.
  PERFORM set_config('equus.skip_waitlist_promotion', 'true', true);

  WITH stale AS (
    SELECT stale_booking.id
    FROM public.bookings stale_booking
    JOIN public.permanent_slots ps
      ON ps.user_id = stale_booking.user_id
     AND ps.day_of_week = EXTRACT(ISODOW FROM stale_booking.slot_date)::integer
     AND ps.slot_time <> stale_booking.slot_time
    JOIN public.bookings current_booking
      ON current_booking.user_id = stale_booking.user_id
     AND current_booking.slot_date = stale_booking.slot_date
     AND current_booking.slot_time = ps.slot_time
     AND current_booking.status IN ('active', 'pending_cancel')
     AND current_booking.trainer_name IS NULL
     AND COALESCE(current_booking.is_individual, false) = false
    WHERE stale_booking.status IN ('active', 'pending_cancel')
      AND stale_booking.trainer_name IS NULL
      AND COALESCE(stale_booking.is_individual, false) = false
      AND stale_booking.slot_date >= (
        (now() AT TIME ZONE 'Europe/Vilnius')::date + 1
      )
      AND current_booking.created_at >= stale_booking.created_at
  )
  UPDATE public.bookings b
  SET
    status = 'cancelled',
    counts_in_subscription = false,
    updated_at = now()
  WHERE b.id IN (SELECT id FROM stale);

  PERFORM set_config('equus.skip_waitlist_promotion', 'false', true);
END;
$repair_existing$;


-- ---------------------------------------------------------------------------
-- 14. Re-assert security after later migrations granted overly broad access
-- ---------------------------------------------------------------------------

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date,date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date,date)
TO service_role;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;

REVOKE ALL
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
TO service_role;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;

REVOKE ALL
ON FUNCTION public.enforce_subscription_requirement_deadlines()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enforce_subscription_requirement_deadlines()
TO service_role;
