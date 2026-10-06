BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New-user-only onboarding
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_required boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $handle_new_user_v2$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    experience_text,
    phone_is_parent,
    onboarding_required
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'Equus klientas'
    ),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'experience_text',
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'phone_is_parent', '')::boolean,
      false
    ),
    true
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE
      WHEN NEW.email = 'adrija.kalikaite3@gmail.com' THEN 'admin'::public.app_role
      WHEN NEW.email = 'jojimomokykla@gmail.com' THEN 'trainer'::public.app_role
      ELSE 'user'::public.app_role
    END
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$handle_new_user_v2$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Existing profiles intentionally keep onboarding_required=false.
-- Only auth users created after this migration get onboarding_required=true.

-- ---------------------------------------------------------------------------
-- 2. "One lesson left" email: never derive the last training from MAX(all
--    attached bookings). Only active, valid-period future bookings count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.queue_subscription_expiry_emails()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $queue_subscription_expiry_v2$
DECLARE
  queued_count integer := 0;
  r record;
  v_email text;
  v_remaining integer;
  v_last_booking_id uuid;
  v_last_training_date date;
  v_last_training_time time;
  v_event_key text;
BEGIN
  FOR r IN
    SELECT
      s.id,
      s.user_id,
      s.lessons_total,
      s.lessons_used,
      s.start_from_date,
      s.expires_at,
      s.start_pending
    FROM public.subscriptions s
    WHERE COALESCE(s.paid, false) = true
      AND s.cancelled_at IS NULL
      AND s.user_id IS NOT NULL
      AND s.start_pending = false
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND COALESCE(s.lessons_total, 0) > 0
      AND COALESCE(s.lessons_used, 0) < s.lessons_total
      AND NOT public.has_role(s.user_id, 'admin'::public.app_role)
  LOOP
    v_remaining := GREATEST(
      0,
      r.lessons_total - r.lessons_used
    );

    -- The reminder is specifically the "one lesson left" state.
    IF v_remaining <> 1 THEN
      CONTINUE;
    END IF;

    -- When one lesson remains, the earliest valid future attached booking is
    -- the one that would consume that final lesson. Never use MAX(slot_date).
    SELECT
      b.id,
      b.slot_date,
      b.slot_time
    INTO
      v_last_booking_id,
      v_last_training_date,
      v_last_training_time
    FROM public.bookings b
    WHERE b.subscription_id = r.id
      AND b.status IN ('active', 'pending_cancel')
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription IS NOT TRUE
      AND b.slot_date BETWEEN r.start_from_date AND r.expires_at
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
          (SELECT s2.package_type FROM public.subscriptions s2 WHERE s2.id = r.id),
          'group'
        )
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    SELECT u.email
      INTO v_email
    FROM auth.users u
    WHERE u.id = r.user_id
      AND u.email IS NOT NULL;

    IF v_email IS NULL THEN
      CONTINUE;
    END IF;

    v_event_key :=
      'subscription_expiring:' || r.id::text || ':remaining1:' ||
      COALESCE(
        v_last_booking_id::text,
        'no-booking:' || r.expires_at::text
      );

    INSERT INTO public.email_events (
      event_key,
      event_type,
      user_id,
      email,
      subscription_id,
      booking_id,
      payload,
      status
    )
    VALUES (
      v_event_key,
      'subscription_expiring',
      r.user_id,
      v_email,
      r.id,
      v_last_booking_id,
      jsonb_build_object(
        'last_training_date', v_last_training_date,
        'last_training_time', v_last_training_time,
        'expires_at', r.expires_at,
        'lessons_total', r.lessons_total,
        'lessons_used', r.lessons_used,
        'remaining', 1
      ),
      'pending'
    )
    ON CONFLICT (event_key) DO NOTHING;

    IF FOUND THEN
      queued_count := queued_count + 1;
    END IF;
  END LOOP;

  RETURN queued_count;
END;
$queue_subscription_expiry_v2$;

REVOKE EXECUTE ON FUNCTION public.queue_subscription_expiry_emails()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.queue_subscription_expiry_emails()
TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Restore ordinary paused reservations after a valid subscription purchase.
--    Permanent bookings are only unpaused here as a safety repair and are
--    never attached to/charged against the subscription.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restore_paused_bookings_for_subscription(
  _subscription_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $restore_subscription_v2$
DECLARE
  v_user_id uuid;
  v_lessons_total smallint;
  v_start_date date;
  v_expires_at date;
  v_package_type text;
  v_covered_riders smallint;
  v_committed smallint := 0;
  v_restored integer := 0;
  v_capacity integer;
  v_occupied integer;
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
    ),
    COALESCE(s.covered_riders, 1)
  INTO
    v_user_id,
    v_lessons_total,
    v_start_date,
    v_expires_at,
    v_package_type,
    v_covered_riders
  FROM public.subscriptions s
  WHERE s.id = _subscription_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
  FOR UPDATE;

  IF NOT FOUND OR v_user_id IS NULL OR v_expires_at IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  SELECT public.subscription_committed_lessons(_subscription_id)
    INTO v_committed;

  -- Safety-repair any legacy paused permanent occurrence. It does not consume
  -- a subscription; permanent recurring arrangements remain separate.
  PERFORM set_config('equus.allow_subscription_pause_update', 'true', true);

  UPDATE public.bookings b
  SET
    is_paused_for_subscription = false,
    is_grace_booking = false,
    updated_at = now()
  WHERE b.user_id = v_user_id
    AND b.status = 'active'
    AND b.is_paused_for_subscription = true
    AND public.booking_is_permanent(b.id)
    AND b.slot_date BETWEEN v_start_date AND v_expires_at;

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  -- Restore ordinary paused reservations in chronological order. They only
  -- become active/charged if the slot has capacity and the subscription still
  -- has committed lesson room.
  FOR r IN
    SELECT
      b.id,
      b.slot_date,
      b.slot_time,
      b.family_rider_id
    FROM public.bookings b
    WHERE b.user_id = v_user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = true
      AND NOT public.booking_is_permanent(b.id)
      AND b.slot_date BETWEEN v_start_date AND v_expires_at
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    EXIT WHEN v_committed >= v_lessons_total;

    -- A one-rider subscription covers the primary booking, not the child row.
    IF r.family_rider_id IS NOT NULL AND v_covered_riders <> 2 THEN
      CONTINUE;
    END IF;

    IF NOT public.booking_matches_subscription_package(
      r.id,
      v_package_type
    ) THEN
      CONTINUE;
    END IF;

    v_capacity := public.equus_effective_slot_capacity(
      r.slot_date,
      r.slot_time
    );

    IF v_capacity <= 0 THEN
      CONTINUE;
    END IF;

    SELECT count(*)::integer
      INTO v_occupied
    FROM public.bookings occupied
    WHERE occupied.slot_date = r.slot_date
      AND occupied.slot_time = r.slot_time
      AND occupied.status IN ('active', 'pending_cancel')
      AND occupied.is_paused_for_subscription IS NOT TRUE
      AND occupied.id <> r.id;

    IF v_occupied >= v_capacity THEN
      CONTINUE;
    END IF;

    PERFORM set_config('equus.allow_subscription_pause_update', 'true', true);

    UPDATE public.bookings
    SET
      is_paused_for_subscription = false,
      is_grace_booking = false,
      subscription_id = _subscription_id,
      counts_in_subscription = true,
      updated_at = now()
    WHERE id = r.id
      AND is_paused_for_subscription = true
      AND subscription_id IS NULL;

    IF FOUND THEN
      PERFORM public.ensure_subscription_allocation(r.id);
      v_committed := public.subscription_committed_lessons(_subscription_id);
      v_restored := v_restored + 1;
    END IF;
  END LOOP;

  RETURN v_restored;
END;
$restore_subscription_v2$;

REVOKE ALL
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.restore_paused_bookings_for_subscription(uuid)
TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Permanent recurring materialization must not pause a permanent booking
--    merely because the rider has no subscription.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $materialize_permanent_v2$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
  v_capacity integer;
  v_occupied integer;
  v_pause boolean;
BEGIN
  PERFORM set_config('equus.allow_permanent_materialization', 'true', true);

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

        -- Capacity can still stop an occurrence, but subscription state cannot.
        v_pause := v_occupied >= v_capacity;

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
$materialize_permanent_v2$;

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date,date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date,date)
TO service_role;

COMMIT;
