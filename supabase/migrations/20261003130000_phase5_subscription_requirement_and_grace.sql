-- Equus Phase 5: subscription requirement, one grace booking, deadline pause/resume.
-- Enforcement starts for booking dates on 2026-10-18.
-- Admin bypasses everything. Subscription-rule exemptions bypass only the
-- subscription requirement. Weekly registration restrictions remain active.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_paused_for_subscription boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bookings_subscription_pause_idx
  ON public.bookings(user_id, slot_date, slot_time)
  WHERE is_paused_for_subscription = true;

CREATE OR REPLACE FUNCTION public.booking_subscription_is_usable(
  _user_id uuid,
  _slot_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $phase5$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND COALESCE(s.paid, false) = true
      AND s.cancelled_at IS NULL
      AND s.lessons_used < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
  );
$phase5$;

REVOKE ALL
ON FUNCTION public.booking_subscription_is_usable(uuid,date)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_subscription_is_usable(uuid,date)
TO authenticated, service_role;

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
AS $phase5$
DECLARE
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_existing boolean := false;
  v_weekly_slot boolean := false;
  v_is_permanent boolean := false;
  v_subscription_usable boolean := false;
  v_grace_count integer := 0;
  v_enforcement_active boolean := false;
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_AUTHENTICATED',
      'message', 'Prisijunkite, kad galėtumėte registruotis.'
    );
  END IF;

  IF _slot_date IS NULL OR _slot_time IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_SLOT',
      'message', 'Neteisingas treniruotės laikas.'
    );
  END IF;

  v_is_admin := public.has_role(_user_id, 'admin');

  IF _allow_admin_bypass AND v_is_admin THEN
    RETURN jsonb_build_object(
      'ok', true,
      'bypass', true,
      'reason', 'ADMIN'
    );
  END IF;

  v_is_exempt := public.is_subscription_rule_exempt(_user_id);

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
    v_subscription_usable := public.booking_subscription_is_usable(
      _user_id,
      _slot_date
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
        AND b.is_paused_for_subscription = false;

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
$phase5$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_subscription_pause_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.is_paused_for_subscription IS DISTINCT FROM OLD.is_paused_for_subscription
  THEN
    IF current_setting('equus.allow_subscription_pause_update', true) = 'true' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NOT NULL
       AND public.has_role(auth.uid(), 'admin')
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Subscription pause state can only be changed by the Equus subscription system or admin';
  END IF;

  RETURN NEW;
END;
$phase5$;

DROP TRIGGER IF EXISTS trg_protect_subscription_pause_state
ON public.bookings;

CREATE TRIGGER trg_protect_subscription_pause_state
BEFORE UPDATE OF is_paused_for_subscription
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.protect_subscription_pause_state();

CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_keep_id uuid;
  v_paused integer := 0;
  r record;
BEGIN
  IF _user_id IS NULL THEN
    RETURN 0;
  END IF;

  IF public.has_role(_user_id, 'admin')
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
  ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LIMIT 1;

  PERFORM set_config(
    'equus.allow_subscription_pause_update',
    'true',
    true
  );

  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= v_local_date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND b.id IS DISTINCT FROM v_keep_id
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET is_paused_for_subscription = true
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  RETURN v_paused;
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.booking_matches_subscription_package(
  _booking_id uuid,
  _package_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_date date;
  v_time time without time zone;
  v_capacity integer;
BEGIN
  SELECT slot_date, slot_time
    INTO v_date, v_time
  FROM public.bookings
  WHERE id = _booking_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = v_date
        AND so.slot_time = v_time
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.active = true
        AND ts.slot_time = v_time
        AND (
          ts.one_off_date = v_date
          OR (
            ts.one_off_date IS NULL
            AND ts.day_of_week = EXTRACT(ISODOW FROM v_date)::integer
          )
        )
      ORDER BY ts.max_capacity DESC
      LIMIT 1
    ),
    5
  )
  INTO v_capacity;

  RETURN CASE
    WHEN _package_type = 'po2' THEN v_capacity = 2
    WHEN _package_type = 'group' THEN v_capacity >= 3
    ELSE false
  END;
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
TO service_role;

CREATE OR REPLACE FUNCTION public.restore_paused_bookings_for_subscription(
  _subscription_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_user_id uuid;
  v_lessons_total smallint;
  v_lessons_used smallint;
  v_start_date date;
  v_expires_at date;
  v_package_type text;
  v_restored integer := 0;
  r record;
BEGIN
  SELECT
    s.user_id,
    s.lessons_total,
    s.lessons_used,
    COALESCE(s.start_from_date, s.purchase_date),
    s.expires_at,
    s.package_type
  INTO
    v_user_id,
    v_lessons_total,
    v_lessons_used,
    v_start_date,
    v_expires_at,
    v_package_type
  FROM public.subscriptions s
  WHERE s.id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND OR v_user_id IS NULL OR v_package_type IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  SELECT lessons_used
    INTO v_lessons_used
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = v_user_id
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = true
      AND b.slot_date >= v_start_date
      AND b.slot_date <= v_expires_at
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    EXIT WHEN v_lessons_used >= v_lessons_total;

    IF NOT public.booking_matches_subscription_package(r.id, v_package_type) THEN
      CONTINUE;
    END IF;

    PERFORM set_config(
      'equus.allow_subscription_pause_update',
      'true',
      true
    );

    UPDATE public.bookings
    SET is_paused_for_subscription = false
    WHERE id = r.id;

    PERFORM public.allocate_booking_to_subscription(r.id);

    v_restored := v_restored + 1;

    SELECT lessons_used
      INTO v_lessons_used
    FROM public.subscriptions
    WHERE id = _subscription_id
    FOR UPDATE;
  END LOOP;

  RETURN v_restored;
END;
$phase5$;

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
AS $phase5$
BEGIN
  IF NEW.paid = true
     AND NEW.cancelled_at IS NULL
  THEN
    PERFORM public.restore_paused_bookings_for_subscription(NEW.id);
  END IF;

  RETURN NEW;
END;
$phase5$;

DROP TRIGGER IF EXISTS trg_restore_paused_bookings_after_subscription_purchase
ON public.subscriptions;

CREATE TRIGGER trg_restore_paused_bookings_after_subscription_purchase
AFTER INSERT ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.restore_paused_bookings_after_subscription_purchase();

CREATE OR REPLACE FUNCTION public.queue_subscription_requirement_warning(
  _booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  v_deadline_local timestamp;
  v_deadline_tz timestamptz;
  v_email text;
  v_name text;
  v_notification_id uuid;
  v_event_id uuid;
BEGIN
  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR SHARE;

  IF NOT FOUND
     OR v_booking.user_id IS NULL
     OR v_booking.status <> 'active'
     OR v_booking.subscription_id IS NOT NULL
     OR v_booking.counts_in_subscription IS FALSE
     OR v_booking.is_paused_for_subscription
     OR v_booking.slot_date < DATE '2026-10-18'
  THEN
    RETURN NULL;
  END IF;

  IF public.has_role(v_booking.user_id, 'admin')
     OR public.is_subscription_rule_exempt(v_booking.user_id)
  THEN
    RETURN NULL;
  END IF;

  IF public.booking_subscription_is_usable(v_booking.user_id, v_booking.slot_date) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = v_booking.user_id
      AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND (
        b.slot_date < v_booking.slot_date
        OR (b.slot_date = v_booking.slot_date AND b.slot_time < v_booking.slot_time)
        OR (
          b.slot_date = v_booking.slot_date
          AND b.slot_time = v_booking.slot_time
          AND b.id < v_booking.id
        )
      )
  ) THEN
    RETURN NULL;
  END IF;

  v_deadline_local := (v_booking.slot_date - 2) + time '20:00';
  v_deadline_tz := v_deadline_local AT TIME ZONE 'Europe/Vilnius';

  SELECT u.email
    INTO v_email
  FROM auth.users u
  WHERE u.id = v_booking.user_id;

  SELECT p.full_name
    INTO v_name
  FROM public.profiles p
  WHERE p.id = v_booking.user_id;

  IF v_email IS NOT NULL THEN
    INSERT INTO public.email_events(
      event_key,
      event_type,
      user_id,
      email,
      booking_id,
      payload,
      status
    )
    VALUES(
      'subscription_requirement_warning:' || v_booking.id::text,
      'subscription_requirement_warning',
      v_booking.user_id,
      v_email,
      v_booking.id,
      jsonb_build_object(
        'booking_date', v_booking.slot_date,
        'booking_time', v_booking.slot_time,
        'deadline', v_deadline_tz,
        'client_name', COALESCE(v_name, '')
      ),
      'pending'
    )
    ON CONFLICT(event_key) DO NOTHING
    RETURNING id INTO v_event_id;
  END IF;

  SELECT public.queue_equus_notification(
    v_booking.user_id,
    'SUBSCRIPTION_REQUIRED',
    'Abonementas reikalingas būsimoms treniruotėms',
    'A subscription is required for future training',
    format(
      'Jūsų artimiausia treniruotė yra %s %s. Abonementą reikia įsigyti iki %s 20:00 val. Jei abonementas nebus įsigytas, vėlesnės nuolatinės rezervacijos bus laikinai sustabdytos.',
      to_char(v_booking.slot_date, 'DD.MM'),
      to_char(v_booking.slot_time, 'HH24:MI'),
      to_char(v_booking.slot_date - 2, 'DD.MM')
    ),
    format(
      'Your next training is on %s at %s. A subscription is required by %s at 20:00. Later recurring reservations will be temporarily paused if no subscription is purchased.',
      to_char(v_booking.slot_date, 'DD.MM'),
      to_char(v_booking.slot_time, 'HH24:MI'),
      to_char(v_booking.slot_date - 2, 'DD.MM')
    ),
    '/grafikas',
    'subscription-requirement:' || v_booking.id::text
  )
  INTO v_notification_id;

  RETURN COALESCE(v_event_id, v_notification_id);
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.notify_subscription_requirement_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
BEGIN
  PERFORM public.queue_subscription_requirement_warning(NEW.id);
  RETURN NEW;
END;
$phase5$;

DROP TRIGGER IF EXISTS trg_notify_subscription_requirement_booking
ON public.bookings;

CREATE TRIGGER trg_notify_subscription_requirement_booking
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.notify_subscription_requirement_booking();

CREATE OR REPLACE FUNCTION public.enforce_subscription_requirement_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  paused_count integer := 0;
  r record;
  v_deadline timestamp;
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
    SELECT (
      (b.slot_date - 2) + time '20:00'
    )
    INTO v_deadline
    FROM public.bookings b
    WHERE b.user_id = r.user_id
      AND b.slot_date >= DATE '2026-10-18'
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    PERFORM public.queue_subscription_requirement_warning(
      (
        SELECT b3.id
        FROM public.bookings b3
        WHERE b3.user_id = r.user_id
          AND b3.slot_date >= DATE '2026-10-18'
          AND b3.status = 'active'
          AND b3.subscription_id IS NULL
          AND b3.counts_in_subscription IS NOT FALSE
          AND b3.is_paused_for_subscription = false
        ORDER BY b3.slot_date, b3.slot_time, b3.created_at, b3.id
        LIMIT 1
      )
    );

    IF v_deadline IS NOT NULL
       AND local_now >= v_deadline
       AND NOT public.booking_subscription_is_usable(
         r.user_id,
         (
           SELECT b2.slot_date
           FROM public.bookings b2
           WHERE b2.user_id = r.user_id
             AND b2.slot_date >= DATE '2026-10-18'
             AND b2.status = 'active'
             AND b2.subscription_id IS NULL
             AND b2.counts_in_subscription IS NOT FALSE
             AND b2.is_paused_for_subscription = false
           ORDER BY b2.slot_date, b2.slot_time, b2.created_at, b2.id
           LIMIT 1
         )
       )
    THEN
      paused_count := paused_count + public.pause_uncovered_future_bookings(r.user_id);
    END IF;
  END LOOP;

  RETURN paused_count;
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.enforce_subscription_requirement_deadlines()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enforce_subscription_requirement_deadlines()
TO service_role;

-- Make the existing every-minute email cron also enforce the booking deadline
-- before the email worker runs. This keeps pause timing at minute-level without
-- creating a second scheduler.
CREATE OR REPLACE FUNCTION public.equus_email_cron_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $phase5$
DECLARE
  cron_secret text;
BEGIN
  PERFORM public.queue_subscription_expiry_emails();
  PERFORM public.enforce_subscription_requirement_deadlines();

  SELECT decrypted_secret
    INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE WARNING 'equus_push_cron_secret is missing; subscription email worker was not invoked';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/send-subscription-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-equus-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')::jsonb
  );
END;
$phase5$;


-- Phase 5 package compatibility: a subscription may only consume the
-- matching training type. Re-define the allocator after the package helper
-- exists so every allocation path uses the same compatibility rule.
CREATE OR REPLACE FUNCTION public.allocate_booking_to_subscription(
  _booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_sub public.subscriptions%ROWTYPE;
  v_allocation_number smallint;
  v_existing_allocation public.subscription_allocations%ROWTYPE;
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
     OR v_booking.is_paused_for_subscription
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NOT_COUNTED'
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
      VALUES(
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

  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_booking.user_id
    AND COALESCE(s.paid, false) = true
    AND s.cancelled_at IS NULL
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

  IF NOT (
    (v_sub.package_type IS NULL AND v_sub.lesson_type IS NULL)
    OR public.booking_matches_subscription_package(
      v_booking.id,
      COALESCE(
        v_sub.package_type,
        CASE
          WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2'
          ELSE 'group'
        END
      )
    )
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'allocated', false,
      'reason', 'NO_MATCHING_SUBSCRIPTION_PACKAGE',
      'subscription_id', v_sub.id,
      'subscription_package_type',
        COALESCE(
          v_sub.package_type,
          CASE
            WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2'
            ELSE 'group'
          END
        )
    );
  END IF;

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
  VALUES(
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
$phase5$;

REVOKE ALL
ON FUNCTION public.allocate_booking_to_subscription(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;


-- Half-admin is not allowed to bypass the grace-booking rule through the
-- optional allocation selector: its purchase always consumes the next
-- compatible future reservation when one exists.
CREATE OR REPLACE FUNCTION public.half_admin_purchase_subscription(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _allocation_mode text DEFAULT 'next',
  _payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase5$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'half_admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN public.admin_purchase_subscription(
    _user_id,
    _lessons_total,
    _package_type,
    _horse_type,
    'next',
    _payment_method
  );
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.half_admin_purchase_subscription(uuid,smallint,text,text,text,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.half_admin_purchase_subscription(uuid,smallint,text,text,text,text)
TO authenticated;


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
AS $phase5$
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
    ),
    5
  )
  INTO v_capacity;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND COALESCE(s.paid, false) = true
      AND s.cancelled_at IS NULL
      AND s.lessons_used < s.lessons_total
      AND COALESCE(s.start_from_date, s.purchase_date) <= _slot_date
      AND s.expires_at >= _slot_date
      AND (
        (s.package_type IS NULL AND s.lesson_type IS NULL)
        OR (
          v_capacity = 2
          AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'po2'
        )
        OR (
          v_capacity >= 3
          AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'group'
        )
      )
  );
END;
$phase5$;

REVOKE ALL
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time without time zone)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_subscription_is_usable_for_slot(uuid,date,time without time zone)
TO authenticated, service_role;

-- Re-apply the eligibility function using package-aware subscription coverage.
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
AS $phase5$
DECLARE
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_existing boolean := false;
  v_weekly_slot boolean := false;
  v_is_permanent boolean := false;
  v_subscription_usable boolean := false;
  v_grace_count integer := 0;
  v_enforcement_active boolean := false;
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED', 'message', 'Prisijunkite, kad galėtumėte registruotis.');
  END IF;

  IF _slot_date IS NULL OR _slot_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SLOT', 'message', 'Neteisingas treniruotės laikas.');
  END IF;

  v_is_admin := public.has_role(_user_id, 'admin');

  IF _allow_admin_bypass AND v_is_admin THEN
    RETURN jsonb_build_object('ok', true, 'bypass', true, 'reason', 'ADMIN');
  END IF;

  v_is_exempt := public.is_subscription_rule_exempt(_user_id);

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

  v_weekly_slot := public.is_laura_weekly_registration_slot(_slot_date, _slot_time);

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
        AND b.is_paused_for_subscription = false;

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
$phase5$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
TO authenticated, service_role;
