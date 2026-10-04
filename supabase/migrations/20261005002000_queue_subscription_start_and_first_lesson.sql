-- Equus: queued subscription start and first-lesson activation.
--
-- Approved rules:
--   * A newly purchased subscription starts on the date of its actual first lesson.
--   * If an older valid subscription still has lessons remaining, the new one waits.
--   * Future ordinary bookings stay unattached until they are completed.
--   * The single advance/grace booking becomes the first lesson of the new package.
--   * A pending package has no expiry date until its first lesson date is known.
--   * Permanent recurring bookings may be restored only where real capacity exists.
--
-- This migration intentionally builds on 20261005001000 and does not edit any
-- previously-applied migration.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS start_pending boolean NOT NULL DEFAULT false;

ALTER TABLE public.subscriptions
  ALTER COLUMN expires_at DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_pending_start_per_user
ON public.subscriptions(user_id)
WHERE start_pending = true
  AND cancelled_at IS NULL;

-- Existing subscriptions already have concrete dates and therefore are active
-- historical records, not queued purchases.
UPDATE public.subscriptions
SET start_pending = false
WHERE start_pending IS NULL;

-- ---------------------------------------------------------------------------
-- 1. Pending subscription helpers
-- ---------------------------------------------------------------------------

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
AS $pending_usable$
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

  -- The oldest active unfinished package always wins. A queued package may
  -- become usable only when no older active package remains.
  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND COALESCE(s.lessons_total, 0) > 0
      AND s.lessons_used < s.lessons_total
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
      AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) = v_package_type
  );
END;
$pending_usable$;

REVOKE ALL
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.activate_pending_subscription_for_user(
  _user_id uuid,
  _preferred_booking_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $activate_pending$
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_now_time time := (now() AT TIME ZONE 'Europe/Vilnius')::time;
  v_slot_capacity integer;
  v_occupied integer;
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
      AND s.lessons_used < s.lessons_total
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
      b.slot_date,
      b.slot_time,
      b.created_at,
      b.id
    LIMIT 1;
  END IF;

  IF v_booking.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.subscriptions
  SET
    start_pending = false,
    start_from_date = v_booking.slot_date,
    expires_at = v_booking.slot_date + 30,
    updated_at = now()
  WHERE id = v_subscription.id;

  UPDATE public.bookings
  SET is_grace_booking = false
  WHERE id = v_booking.id
    AND is_grace_booking = true;

  RETURN v_subscription.id;
END;
$activate_pending$;

REVOKE ALL
ON FUNCTION public.activate_pending_subscription_for_user(uuid,uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.activate_pending_subscription_for_user(uuid,uuid)
TO service_role;


-- ---------------------------------------------------------------------------
-- 2. Active-subscription predicates now ignore queued purchases
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
      WHERE s.start_pending = false
        AND b.status IN ('active', 'pending_cancel', 'completed')
        AND b.counts_in_subscription IS NOT FALSE
        AND public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        )
        AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
    ),
    0
  )::smallint
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id;
$$;


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
AS $active_sub_usable$
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
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.lessons_used < s.lessons_total
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND s.start_from_date <= _slot_date
      AND s.expires_at >= _slot_date
      AND COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      ) = v_package_type
  );
END;
$active_sub_usable$;

REVOKE ALL
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time)
TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Booking eligibility recognizes a queued package without attaching it
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
AS $queued_eligibility$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_existing boolean := false;
  v_weekly_slot boolean := false;
  v_is_permanent boolean := false;
  v_subscription_usable boolean := false;
  v_pending_usable boolean := false;
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

  IF _user_id IS NULL OR _slot_date IS NULL OR _slot_time IS NULL THEN
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

    v_pending_usable := public.pending_subscription_can_cover_slot(
      _user_id,
      _slot_date,
      _slot_time
    );

    IF NOT v_subscription_usable AND NOT v_pending_usable THEN
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
    'subscription_pending_start', v_pending_usable,
    'grace_booking', false,
    'duplicate_protected', true
  );
END;
$queued_eligibility$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time,boolean)
TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. Future booking insertion activates queued subscriptions from the first
--    actual reservation date, without attaching subscription_id.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.activate_pending_subscription_after_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pending_booking_trigger$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NEW.status IN ('active', 'completed')
  THEN
    PERFORM public.activate_pending_subscription_for_user(
      NEW.user_id,
      CASE WHEN NEW.subscription_id IS NULL THEN NEW.id ELSE NULL END
    );

    -- A newly activated subscription may restore permanent occurrences.
    IF public.activate_pending_subscription_for_user(
      NEW.user_id,
      CASE WHEN NEW.subscription_id IS NULL THEN NEW.id ELSE NULL END
    ) IS NOT NULL THEN
      NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$pending_booking_trigger$;

DROP TRIGGER IF EXISTS trg_activate_pending_subscription_after_booking
ON public.bookings;

CREATE TRIGGER trg_activate_pending_subscription_after_booking
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.activate_pending_subscription_after_booking();


CREATE OR REPLACE FUNCTION public.recalculate_pending_subscription_after_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pending_cancel$
DECLARE
  v_sub public.subscriptions%ROWTYPE;
  v_next_booking public.bookings%ROWTYPE;
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

  RETURN NEW;
END;
$pending_cancel$;

DROP TRIGGER IF EXISTS trg_recalculate_pending_subscription_after_cancellation
ON public.bookings;

CREATE TRIGGER trg_recalculate_pending_subscription_after_cancellation
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_pending_subscription_after_cancellation();


-- ---------------------------------------------------------------------------
-- 5. Allocator can activate a queued package when a completed lesson is its
--    first lesson; otherwise it retains normal FIFO period rules.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.allocate_booking_to_subscription(
  _booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $queued_allocate$
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
    AND COALESCE(
      s.package_type,
      CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
    ) = v_package_type
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
$queued_allocate$;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;


-- ---------------------------------------------------------------------------
-- 6. Purchase engine: create queued subscription, activate only from the
--    first actual eligible reservation, never attach ordinary future bookings.
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
AS $purchase_queued$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_price numeric(10,2);
  v_subscription_id uuid;
  v_payment_id uuid;
  v_event_id uuid;
  v_booking_id uuid;
  v_allocation_id uuid;
  v_purchase_at timestamptz := now();
  v_purchase_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_current_sub uuid;
  v_start_pending boolean := true;
  v_start_from_date date := NULL;
  v_expires_at date := NULL;
  v_activated uuid;
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
    hashtextextended(
      'equus-user-purchase:' || _user_id::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = true
  ) THEN
    RAISE EXCEPTION 'PENDING_SUBSCRIPTION_ALREADY_EXISTS';
  END IF;

  -- Refresh current active usage before deciding whether the new package
  -- needs to wait behind an older one.
  FOR v_current_sub IN
    SELECT s.id
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
    ORDER BY s.start_from_date, s.purchase_date, s.purchased_at, s.id
  LOOP
    PERFORM public.reconcile_subscription_usage(v_current_sub);
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

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.expires_at >= v_purchase_date
      AND s.lessons_used < s.lessons_total
  ) THEN
    -- Current package still exists. The new one is queued and receives no
    -- start date until the old package is actually completed.
    v_start_pending := true;
  ELSE
    -- No unfinished active package remains. A queued package may start on the
    -- earliest actual eligible reservation, including the one grace booking.
    v_start_pending := true;
  END IF;

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
    start_from_date,
    start_pending
  )
  VALUES (
    _user_id,
    _lessons_total,
    0,
    v_price,
    v_purchase_date,
    NULL,
    true,
    CASE WHEN _package_type = 'po2' THEN 'sportine_po2' ELSE 'sportine' END,
    _package_type,
    _horse_type,
    _payment_method,
    v_actor,
    v_purchase_at,
    NULL,
    true
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

  -- If an older active package exists, activation deliberately does nothing.
  -- Otherwise it chooses the first actual future reservation. The "none" mode
  -- still honors the single grace booking by allowing normal activation from
  -- the earliest eligible reservation.
  v_activated := public.activate_pending_subscription_for_user(_user_id, NULL);

  IF v_activated = v_subscription_id THEN
    v_start_pending := false;

    SELECT
      s.start_from_date,
      s.expires_at
    INTO
      v_start_from_date,
      v_expires_at
    FROM public.subscriptions s
    WHERE s.id = v_subscription_id;

    IF _allocation_mode IN ('today','next') THEN
      SELECT b.id
        INTO v_booking_id
      FROM public.bookings b
      WHERE b.user_id = _user_id
        AND b.status = 'active'
        AND b.subscription_id IS NULL
        AND b.counts_in_subscription IS NOT FALSE
        AND (
          _allocation_mode = 'next'
          OR b.slot_date = v_purchase_date
        )
        AND b.slot_date BETWEEN v_start_from_date AND v_expires_at
        AND public.booking_matches_subscription_package(
          b.id,
          _package_type
        )
      ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
      LIMIT 1;
    END IF;

    PERFORM public.restore_paused_bookings_for_subscription(v_subscription_id);
  END IF;

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
    action,
    new_value,
    metadata
  )
  VALUES (
    v_actor,
    _user_id,
    v_subscription_id,
    v_payment_id,
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
      'expires_at', v_expires_at,
      'start_pending', v_start_pending
    ),
    jsonb_build_object(
      'email_event_id', v_event_id,
      'first_reservation_id', v_booking_id
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
    'start_pending', v_start_pending,
    'previous_subscription_id', v_current_sub
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
$purchase_queued$;

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
AS $purchase_wrapper_queued$
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
$purchase_wrapper_queued$;

REVOKE ALL
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_purchase_subscription(uuid,smallint,text,text,text)
TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. Complete lessons can activate and restore queued subscriptions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_completed_booking_subscription_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $completed_activation$
DECLARE
  v_activated uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'completed'
     AND NEW.status = 'completed'
     AND NEW.user_id IS NOT NULL
  THEN
    v_activated := public.activate_pending_subscription_for_user(
      NEW.user_id,
      CASE WHEN NEW.subscription_id IS NULL THEN NEW.id ELSE NULL END
    );

    IF v_activated IS NOT NULL THEN
      PERFORM public.restore_paused_bookings_for_subscription(v_activated);
    END IF;
  END IF;

  RETURN NEW;
END;
$completed_activation$;

DROP TRIGGER IF EXISTS trg_z_process_completed_booking_subscription_activation
ON public.bookings;

CREATE TRIGGER trg_z_process_completed_booking_subscription_activation
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.process_completed_booking_subscription_activation();


-- ---------------------------------------------------------------------------
-- 8. QR/read-only subscription views understand queued purchases
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_client_qr(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $resolve_qr_queued$
DECLARE
  _caller uuid := auth.uid();
  _user_id uuid;
  _profile public.profiles%ROWTYPE;
  _current_sub jsonb;
  _next_sub jsonb;
  _reservations jsonb;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.has_role(_caller, 'admin'::public.app_role)
    OR public.has_role(_caller, 'trainer'::public.app_role)
    OR public.has_role(_caller, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY' USING ERRCODE = 'P0001';
  END IF;

  IF _token IS NULL OR length(trim(_token)) < 32 OR length(trim(_token)) > 200 THEN
    RAISE EXCEPTION 'INVALID_QR' USING ERRCODE = 'P0001';
  END IF;

  SELECT q.user_id INTO _user_id
  FROM public.client_qr_tokens q
  WHERE q.token_hash = encode(extensions.digest(trim(_token), 'sha256'), 'hex')
    AND q.token = trim(_token)
    AND q.revoked_at IS NULL;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'QR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _profile
  FROM public.profiles
  WHERE id = _user_id;

  SELECT to_jsonb(s)
    INTO _current_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND s.expires_at >= current_date
    AND s.start_from_date <= current_date
    AND s.lessons_used < s.lessons_total
  ORDER BY s.start_from_date, s.purchase_date DESC, s.id
  LIMIT 1;

  SELECT to_jsonb(s)
    INTO _next_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.lessons_used < s.lessons_total
    AND (
      s.start_pending = true
      OR (
        s.start_pending = false
        AND s.start_from_date IS NOT NULL
        AND s.start_from_date > current_date
      )
    )
  ORDER BY
    CASE WHEN s.start_pending THEN 0 ELSE 1 END,
    s.start_from_date,
    s.purchase_date DESC,
    s.id
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.slot_date, b.slot_time), '[]'::jsonb)
    INTO _reservations
  FROM (
    SELECT *
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND (b.slot_date::date + b.slot_time::time) >= now()
    ORDER BY b.slot_date, b.slot_time
    LIMIT 10
  ) b;

  RETURN jsonb_build_object(
    'ok', true,
    'client', jsonb_build_object(
      'id', _profile.id,
      'full_name', _profile.full_name,
      'email', (SELECT email FROM auth.users WHERE id = _user_id),
      'phone', _profile.phone
    ),
    'subscription', COALESCE(_current_sub, 'null'::jsonb),
    'next_subscription', COALESCE(_next_sub, 'null'::jsonb),
    'reservations', _reservations
  );
END;
$resolve_qr_queued$;

REVOKE ALL ON FUNCTION public.resolve_client_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_client_qr(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.qr_today_subscription_context(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $qr_today_queued$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_current_id uuid;
  v_next_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'trainer'::public.app_role)
    OR public.has_role(auth.uid(), 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY';
  END IF;

  SELECT s.id
    INTO v_current_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND s.start_from_date <= v_today
    AND s.expires_at >= v_today
    AND s.lessons_used < s.lessons_total
  ORDER BY s.start_from_date, s.purchase_date DESC, s.id
  LIMIT 1;

  SELECT s.id
    INTO v_next_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.lessons_used < s.lessons_total
    AND (
      s.start_pending = true
      OR (
        s.start_pending = false
        AND s.start_from_date IS NOT NULL
        AND s.start_from_date > v_today
      )
    )
  ORDER BY
    CASE WHEN s.start_pending THEN 0 ELSE 1 END,
    s.start_from_date,
    s.purchase_date,
    s.id
  LIMIT 1;

  RETURN jsonb_build_object(
    'today', v_today,
    'current_subscription_id', v_current_id,
    'next_subscription_id', v_next_id,
    'today_bookings',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'slot_time', b.slot_time,
            'subscription_id', b.subscription_id,
            'uses_current_subscription', b.subscription_id = v_current_id,
            'uses_next_subscription', b.subscription_id = v_next_id
          )
          ORDER BY b.slot_time
        )
        FROM public.bookings b
        WHERE b.user_id = _user_id
          AND b.slot_date = v_today
          AND b.status IN ('active', 'completed')
      ), '[]'::jsonb)
  );
END;
$qr_today_queued$;

REVOKE ALL
ON FUNCTION public.qr_today_subscription_context(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.qr_today_subscription_context(uuid)
TO authenticated;


-- ---------------------------------------------------------------------------
-- 9. Regression snapshot recognizes queued subscriptions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.subscription_rules_regression_snapshot(
  _user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $snapshot_queued$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_is_half_admin boolean := false;
  v_grace_count integer := 0;
  v_paused_count integer := 0;
  v_future_count integer := 0;
  v_current_subscription uuid;
  v_next_subscription uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin');

  IF _user_id IS NULL THEN
    _user_id := v_actor;
  END IF;

  IF NOT v_is_admin AND _user_id <> v_actor THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  v_is_exempt := public.is_subscription_rule_exempt(_user_id);
  v_is_half_admin := public.has_role(_user_id, 'half_admin');

  SELECT COUNT(*)::integer
    INTO v_grace_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND b.status IN ('active', 'pending_cancel')
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS NOT FALSE
    AND b.is_paused_for_subscription = false
    AND b.is_grace_booking = true
    AND NOT public.booking_is_permanent(b.id);

  SELECT COUNT(*)::integer
    INTO v_paused_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND b.is_paused_for_subscription = true;

  SELECT COUNT(*)::integer
    INTO v_future_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription = false;

  SELECT s.id
    INTO v_current_subscription
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND s.lessons_used < s.lessons_total
    AND s.start_from_date <= (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  ORDER BY s.start_from_date, s.purchase_date, s.id
  LIMIT 1;

  SELECT s.id
    INTO v_next_subscription
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.lessons_used < s.lessons_total
    AND (
      s.start_pending = true
      OR (
        s.start_pending = false
        AND s.start_from_date IS NOT NULL
        AND s.start_from_date > (now() AT TIME ZONE 'Europe/Vilnius')::date
      )
    )
  ORDER BY
    CASE WHEN s.start_pending THEN 0 ELSE 1 END,
    s.start_from_date,
    s.purchase_date,
    s.id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', _user_id,
    'admin_actor', v_is_admin,
    'target_is_admin', public.has_role(_user_id, 'admin'),
    'target_is_half_admin', v_is_half_admin,
    'subscription_exempt', v_is_exempt,
    'enforcement_start', '2026-10-18',
    'grace_count', v_grace_count,
    'paused_count', v_paused_count,
    'future_visible_count', v_future_count,
    'current_subscription_id', v_current_subscription,
    'next_subscription_id', v_next_subscription
  );
END;
$snapshot_queued$;


-- ---------------------------------------------------------------------------
-- 10. Security: pending activation/mutation stays service-side
-- ---------------------------------------------------------------------------

REVOKE ALL
ON FUNCTION public.activate_pending_subscription_for_user(uuid,uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.activate_pending_subscription_for_user(uuid,uuid)
TO service_role;

REVOKE ALL
ON FUNCTION public.process_completed_booking_subscription_activation()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.process_completed_booking_subscription_activation()
TO service_role;
