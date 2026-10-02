-- Equus Phases 6-11 hardening and integration.
-- This is a NEW migration because Phase 5 is already applied.
-- Includes grace-booking concurrency protection, permanent-booking pause
-- exclusions, deadline hardening, diagnostics, and related server guards.

-- Phase 6-11 hardening:
-- serialize eligibility checks per rider so two simultaneous booking attempts
-- cannot both consume the single grace slot.
CREATE OR REPLACE FUNCTION public.check_booking_eligibility(
  _user_id uuid,
  _slot_date date,
  _slot_time time without time zone,
  _allow_admin_bypass boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $phase6$
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
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED',
      'message', 'Prisijunkite, kad galėtumėte registruotis.');
  END IF;

  IF _slot_date IS NULL OR _slot_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SLOT',
      'message', 'Neteisingas treniruotės laikas.');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_user_id::text, 0)
  );

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

  v_enforcement_active :=
    v_local_date >= DATE '2026-10-18'
    AND _slot_date >= v_local_date;

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
        AND b.is_paused_for_subscription = false
        AND b.is_grace_booking = true;

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
$phase6$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
TO authenticated, service_role;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_grace_booking boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bookings_grace_idx
  ON public.bookings(user_id, slot_date, slot_time)
  WHERE is_grace_booking = true;

CREATE OR REPLACE FUNCTION public.enforce_booking_eligibility_phase2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase6$
DECLARE
  v_result jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_result := public.check_booking_eligibility(
    NEW.user_id,
    NEW.slot_date,
    NEW.slot_time,
    true
  );

  IF COALESCE((v_result ->> 'ok')::boolean, false) = false THEN
    RAISE EXCEPTION '%', COALESCE(v_result ->> 'message', 'Registracija negalima.');
  END IF;

  NEW.is_grace_booking :=
    COALESCE((v_result ->> 'grace_booking')::boolean, false);

  RETURN NEW;
END;
$phase6$;

DROP TRIGGER IF EXISTS trg_enforce_booking_eligibility_phase2
ON public.bookings;

CREATE TRIGGER trg_enforce_booking_eligibility_phase2
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_eligibility_phase2();

-- Permanent recurring bookings are never paused by the subscription system.
CREATE OR REPLACE FUNCTION public.booking_is_permanent(
  _booking_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $phase6$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.permanent_slots ps
      ON ps.user_id = b.user_id
     AND ps.day_of_week = EXTRACT(ISODOW FROM b.slot_date)::integer
     AND ps.slot_time = b.slot_time
    WHERE b.id = _booking_id
  );
$phase6$;

REVOKE ALL
ON FUNCTION public.booking_is_permanent(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.booking_is_permanent(uuid)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase6$
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
    AND NOT public.booking_is_permanent(b.id)
  ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LIMIT 1;

  PERFORM set_config('equus.allow_subscription_pause_update', 'true', true);

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
      AND NOT public.booking_is_permanent(b.id)
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET is_paused_for_subscription = true
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  RETURN v_paused;
END;
$phase6$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.queue_subscription_requirement_warning(
  _booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase6$
DECLARE
  v_booking public.bookings%ROWTYPE;
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
     OR public.booking_is_permanent(v_booking.id)
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
      AND b.id <> v_booking.id
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

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_booking.user_id;
  SELECT p.full_name INTO v_name FROM public.profiles p WHERE p.id = v_booking.user_id;

  IF v_email IS NOT NULL THEN
    INSERT INTO public.email_events(
      event_key, event_type, user_id, email, booking_id, payload, status
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
$phase6$;

REVOKE ALL
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_subscription_requirement_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $phase6$
DECLARE
  local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  paused_count integer := 0;
  r record;
  v_deadline timestamp;
  v_booking_id uuid;
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
      AND NOT public.booking_is_permanent(b.id)
  LOOP
    SELECT
      b.id,
      (b.slot_date - 2) + time '20:00'
    INTO v_booking_id, v_deadline
    FROM public.bookings b
    WHERE b.user_id = r.user_id
      AND b.slot_date >= DATE '2026-10-18'
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND NOT public.booking_is_permanent(b.id)
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
    LIMIT 1;

    PERFORM public.queue_subscription_requirement_warning(v_booking_id);

    IF v_deadline IS NOT NULL
       AND local_now >= v_deadline
       AND NOT public.booking_subscription_is_usable(
         r.user_id,
         (SELECT b2.slot_date FROM public.bookings b2 WHERE b2.id = v_booking_id)
       )
    THEN
      paused_count := paused_count + public.pause_uncovered_future_bookings(r.user_id);
    END IF;
  END LOOP;

  RETURN paused_count;
END;
$phase6$;

REVOKE ALL
ON FUNCTION public.enforce_subscription_requirement_deadlines()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enforce_subscription_requirement_deadlines()
TO service_role;

-- A diagnostic RPC used by the admin/test process. It is read-only and
-- deliberately does not create, update, pause, or allocate anything.
CREATE OR REPLACE FUNCTION public.subscription_rules_diagnostics(
  _user_id uuid,
  _slot_date date,
  _slot_time time without time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $phase6$
DECLARE
  v_eligibility jsonb;
  v_sub jsonb;
  v_grace jsonb;
BEGIN
  v_eligibility := public.check_booking_eligibility(
    _user_id, _slot_date, _slot_time, true
  );

  SELECT to_jsonb(s)
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.lessons_used < s.lessons_total
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date
  LIMIT 1;

  SELECT jsonb_build_object(
    'count', COUNT(*),
    'booking_ids', COALESCE(jsonb_agg(b.id ORDER BY b.slot_date, b.slot_time), '[]'::jsonb)
  )
  INTO v_grace
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.is_grace_booking = true
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription = false;

  RETURN jsonb_build_object(
    'eligibility', v_eligibility,
    'usable_subscription', COALESCE(v_sub, 'null'::jsonb),
    'grace', v_grace,
    'enforcement_start', '2026-10-18'
  );
END;
$phase6$;

REVOKE ALL
ON FUNCTION public.subscription_rules_diagnostics(uuid,date,time without time zone)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.subscription_rules_diagnostics(uuid,date,time without time zone)
TO authenticated, service_role;


-- Phase 10: QR-specific context for today's lesson versus a queued/new subscription.
CREATE OR REPLACE FUNCTION public.qr_today_subscription_context(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $phase10$
DECLARE
  v_current_id uuid;
  v_next_id uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_today_bookings jsonb;
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
    AND COALESCE(s.start_from_date, s.purchase_date) <= v_today
    AND s.expires_at >= v_today
    AND s.lessons_used < s.lessons_total
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date DESC
  LIMIT 1;

  SELECT s.id
    INTO v_next_id
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND COALESCE(s.start_from_date, s.purchase_date) > v_today
    AND s.lessons_used < s.lessons_total
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'slot_time', b.slot_time,
        'subscription_id', b.subscription_id,
        'uses_current_subscription', b.subscription_id = v_current_id,
        'uses_next_subscription', b.subscription_id = v_next_id
      )
      ORDER BY b.slot_time
    ),
    '[]'::jsonb
  )
  INTO v_today_bookings
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = v_today
    AND b.status IN ('active', 'completed');

  RETURN jsonb_build_object(
    'today', v_today,
    'current_subscription_id', v_current_id,
    'next_subscription_id', v_next_id,
    'today_bookings', v_today_bookings,
    'today_uses_current_subscription',
      EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.user_id = _user_id
          AND b.slot_date = v_today
          AND b.subscription_id = v_current_id
          AND b.status IN ('active', 'completed')
      ),
    'today_uses_next_subscription',
      EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.user_id = _user_id
          AND b.slot_date = v_today
          AND b.subscription_id = v_next_id
          AND b.status IN ('active', 'completed')
      )
  );
END;
$phase10$;

REVOKE ALL
ON FUNCTION public.qr_today_subscription_context(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.qr_today_subscription_context(uuid)
TO authenticated;
