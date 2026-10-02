-- Equus Phases 6-11 hardening:
-- grace UX/state, permanent-recurring safety, package-aware allocation,
-- deadline safety, QR/subscription regression diagnostics, and test helpers.
--
-- Admin bypass remains absolute.
-- Subscription-rule exemptions bypass subscription requirements only;
-- weekly registration rules still apply.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_grace_booking boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bookings_grace_future_idx
  ON public.bookings(user_id, slot_date, slot_time)
  WHERE is_grace_booking = true
    AND subscription_id IS NULL
    AND status IN ('active', 'pending_cancel');

-- Phase 6: the BEFORE INSERT trigger is the authoritative place that marks
-- the one allowed no-subscription booking as a grace booking. This prevents
-- frontend clients from forgetting to persist the state.
CREATE OR REPLACE FUNCTION public.enforce_booking_eligibility_phase2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_booking_guard$
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
$equus_booking_guard$;

-- Phase 6: package-aware eligibility. A subscription must match the actual
-- slot package, so a po2 package cannot silently cover a group slot.
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

-- Phase 6: update eligibility so permanent bookings do not consume the
-- one-grace allowance and the package-aware subscription helper is used.
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

-- Phase 7/10: the accounting engine must choose a subscription compatible
-- with the booking's actual package, not simply the oldest subscription.
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
  v_allocation_number smallint;
  v_existing_allocation public.subscription_allocations%ROWTYPE;
  v_start_date date;
  v_package_type text;
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

  SELECT CASE
    WHEN COALESCE(
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
    ) = 2
    THEN 'po2'
    ELSE 'group'
  END
  INTO v_package_type;

  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_booking.user_id
    AND COALESCE(s.paid, false) = true
    AND s.cancelled_at IS NULL
    AND s.lessons_used < s.lessons_total
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
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.allocate_booking_to_subscription(uuid)
TO service_role;

-- Phase 7: permanent recurring bookings are never paused by the
-- subscription deadline engine. Their permanent_slots arrangement remains.
CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_pause$
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
$equus_pause$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;

-- Phase 8/9: warnings must never be generated for permanent bookings.
CREATE OR REPLACE FUNCTION public.queue_subscription_requirement_warning(
  _booking_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_warning$
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

  IF public.booking_subscription_is_usable_for_slot(
    v_booking.user_id,
    v_booking.slot_date,
    v_booking.slot_time
  ) THEN
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
      AND NOT public.booking_is_permanent(b.id)
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
      'Jūsų artimiausia treniruotė yra %s %s. Abonementą reikia įsigyti iki %s 20:00 val. Jei abonementas nebus įsigytas, vėlesnės rezervacijos bus laikinai sustabdytos.',
      to_char(v_booking.slot_date, 'DD.MM'),
      to_char(v_booking.slot_time, 'HH24:MI'),
      to_char(v_booking.slot_date - 2, 'DD.MM')
    ),
    format(
      'Your next training is on %s at %s. A subscription is required by %s at 20:00. Later reservations will be temporarily paused if no subscription is purchased.',
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
$equus_warning$;

REVOKE ALL
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.queue_subscription_requirement_warning(uuid)
TO service_role;

-- Phase 8: deadline scan ignores permanent recurring arrangements.
CREATE OR REPLACE FUNCTION public.enforce_subscription_requirement_deadlines()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_deadline$
DECLARE
  local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  paused_count integer := 0;
  r record;
  v_booking_id uuid;
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
      AND NOT public.booking_is_permanent(b.id)
      AND NOT public.has_role(b.user_id, 'admin')
      AND NOT public.is_subscription_rule_exempt(b.user_id)
  LOOP
    SELECT b.id, ((b.slot_date - 2) + time '20:00')
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

    IF v_booking_id IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM public.queue_subscription_requirement_warning(v_booking_id);

    IF local_now >= v_deadline THEN
      IF NOT public.booking_subscription_is_usable_for_slot(
        r.user_id,
        (
          SELECT b2.slot_date FROM public.bookings b2 WHERE b2.id = v_booking_id
        ),
        (
          SELECT b2.slot_time FROM public.bookings b2 WHERE b2.id = v_booking_id
        )
      ) THEN
        paused_count := paused_count + public.pause_uncovered_future_bookings(r.user_id);
      END IF;
    END IF;
  END LOOP;

  RETURN paused_count;
END;
$equus_deadline$;

REVOKE ALL
ON FUNCTION public.enforce_subscription_requirement_deadlines()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.enforce_subscription_requirement_deadlines()
TO service_role;

-- Phase 10: a read-only, self-service diagnostics endpoint for the QR/subscription
-- UI. It never changes data. Admin may inspect another user; normal users only self.
CREATE OR REPLACE FUNCTION public.subscription_rules_regression_snapshot(
  _user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_snapshot$
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
    AND s.lessons_used < s.lessons_total
    AND COALESCE(s.start_from_date, s.purchase_date) <= (now() AT TIME ZONE 'Europe/Vilnius')::date
    AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date, s.id
  LIMIT 1;

  SELECT s.id
    INTO v_next_subscription
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND (
      COALESCE(s.start_from_date, s.purchase_date) > (now() AT TIME ZONE 'Europe/Vilnius')::date
      OR (
        s.lessons_used >= s.lessons_total
        AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      )
    )
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date, s.id
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
$equus_snapshot$;

REVOKE ALL
ON FUNCTION public.subscription_rules_regression_snapshot(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.subscription_rules_regression_snapshot(uuid)
TO authenticated, service_role;

-- Phase 11: useful DB-level regression assertions that do not create test
-- bookings or mutate customer data.
CREATE OR REPLACE FUNCTION public.subscription_rules_schema_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_schema$
DECLARE
  v_trigger_count integer;
  v_function_count integer;
  v_columns_ok boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT COUNT(*)
    INTO v_trigger_count
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.bookings'::regclass
    AND NOT t.tgisinternal
    AND t.tgname IN (
      'trg_enforce_booking_eligibility_phase2',
      'trg_notify_subscription_requirement_booking',
      'trg_protect_subscription_pause_state',
      'trg_sync_subscription_usage_from_booking'
    );

  SELECT COUNT(*)
    INTO v_function_count
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'check_booking_eligibility',
      'booking_subscription_is_usable_for_slot',
      'allocate_booking_to_subscription',
      'pause_uncovered_future_bookings',
      'queue_subscription_requirement_warning',
      'enforce_subscription_requirement_deadlines',
      'restore_paused_bookings_for_subscription',
      'subscription_rules_regression_snapshot'
    );

  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = 'is_grace_booking'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = 'is_paused_for_subscription'
    )
  INTO v_columns_ok;

  RETURN jsonb_build_object(
    'ok', v_trigger_count = 4 AND v_function_count = 8 AND v_columns_ok,
    'booking_triggers', v_trigger_count,
    'required_functions', v_function_count,
    'required_columns', v_columns_ok
  );
END;
$equus_schema$;

REVOKE ALL
ON FUNCTION public.subscription_rules_schema_check()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.subscription_rules_schema_check()
TO authenticated;
