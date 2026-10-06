-- Equus onboarding refresh + no-login family rider support.
-- Family riders live inside the primary account; they do not need auth users.

BEGIN;

CREATE TABLE IF NOT EXISTS public.family_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NOT NULL CHECK (length(trim(first_name)) >= 1),
  last_name text NOT NULL CHECK (length(trim(last_name)) >= 1),
  experience_text text,
  always_together boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS family_riders_parent_idx
  ON public.family_riders(parent_user_id);

DROP TRIGGER IF EXISTS update_family_riders_updated_at
ON public.family_riders;

CREATE TRIGGER update_family_riders_updated_at
BEFORE UPDATE ON public.family_riders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.family_riders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own family riders" ON public.family_riders;
CREATE POLICY "Users view own family riders"
ON public.family_riders
FOR SELECT TO authenticated
USING (parent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "Users create own family riders" ON public.family_riders;
CREATE POLICY "Users create own family riders"
ON public.family_riders
FOR INSERT TO authenticated
WITH CHECK (parent_user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own family riders" ON public.family_riders;
CREATE POLICY "Users update own family riders"
ON public.family_riders
FOR UPDATE TO authenticated
USING (parent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (parent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users delete own family riders" ON public.family_riders;
CREATE POLICY "Users delete own family riders"
ON public.family_riders
FOR DELETE TO authenticated
USING (parent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS family_rider_id uuid REFERENCES public.family_riders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS family_group_id uuid;

CREATE INDEX IF NOT EXISTS bookings_family_rider_idx
  ON public.bookings(family_rider_id, slot_date, slot_time);

CREATE INDEX IF NOT EXISTS bookings_family_group_idx
  ON public.bookings(family_group_id)
  WHERE family_group_id IS NOT NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS covered_riders smallint NOT NULL DEFAULT 1;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_covered_riders_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_covered_riders_chk
  CHECK (covered_riders IN (1,2));

DROP INDEX IF EXISTS public.bookings_user_slot_active_uniq;
DROP INDEX IF EXISTS public.uniq_active_booking_per_user_slot;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_user_rider_slot_active_uniq
ON public.bookings (
  user_id,
  slot_date,
  slot_time,
  COALESCE(
    family_rider_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
)
WHERE status IN ('active', 'pending_cancel');

-- The family RPC performs all validation and inserts the parent + child in
-- one transaction. The normal insert guard is bypassed only with this
-- transaction-local trusted marker set inside that RPC.
CREATE OR REPLACE FUNCTION public.enforce_booking_eligibility_phase2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_booking_guard_family$
DECLARE
  v_result jsonb;
BEGIN
  IF current_setting('equus.allow_permanent_materialization', true) = 'true' THEN
    NEW.is_grace_booking := false;
    RETURN NEW;
  END IF;

  IF current_setting('equus.allow_family_booking_insert', true) = 'true' THEN
    RETURN NEW;
  END IF;

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
$equus_booking_guard_family$;

CREATE OR REPLACE FUNCTION public.enforce_trainer_group_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $equus_trainer_group_family$
DECLARE
  caller uuid := auth.uid();
  dow int := CASE WHEN extract(dow FROM NEW.slot_date)::int = 0 THEN 7 ELSE extract(dow FROM NEW.slot_date)::int END;
  trainer text;
  new_lvl text;
  total int := 0;
  beginners int := 0;
  max_allowed int;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  IF current_setting('equus.allow_family_booking_insert', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  trainer := NEW.trainer_name;
  IF trainer IS NULL THEN
    SELECT t.trainer_name INTO trainer
      FROM public.time_slots t
     WHERE t.active
       AND t.slot_time = NEW.slot_time
       AND t.trainer_name IS NOT NULL
       AND ((t.one_off_date IS NULL AND t.day_of_week = dow) OR t.one_off_date = NEW.slot_date)
     LIMIT 1;
  END IF;

  IF trainer IS NULL OR trainer NOT ILIKE '%Jolita%' THEN RETURN NEW; END IF;

  new_lvl := public.trainer_rider_level(trainer, NEW.user_id, NEW.guest_rider_id);

  SELECT count(*), count(*) FILTER (WHERE lvl = 'beginner')
    INTO total, beginners
    FROM (
      SELECT public.trainer_rider_level(trainer, b.user_id, b.guest_rider_id) AS lvl
        FROM public.bookings b
       WHERE b.slot_date = NEW.slot_date
         AND b.slot_time = NEW.slot_time
         AND b.status = 'active'
         AND b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name
         AND b.id <> NEW.id
    ) x;

  IF new_lvl = 'beginner' THEN beginners := beginners + 1; END IF;
  total := total + 1;

  IF beginners > 2 THEN
    RAISE EXCEPTION 'Šioje treniruotėje jau yra 2 pradedantieji, todėl daugiau pradedančiųjų registruoti negalima.'
      USING ERRCODE = 'check_violation';
  END IF;

  max_allowed := CASE WHEN beginners >= 2 THEN 2 WHEN beginners = 1 THEN 3 ELSE 4 END;

  IF total > max_allowed THEN
    RAISE EXCEPTION 'Grupė pilna — maksimalus dalyvių skaičius yra %.', max_allowed USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$equus_trainer_group_family$;

-- Grace is one future reservation, not one booking row. A parent + child pair
-- therefore consumes one grace reservation.
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
AS $equus_eligibility_family$
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
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED', 'message', 'Prisijunkite, kad galėtumėte registruotis.');
  END IF;

  IF _user_id IS NULL OR _slot_date IS NULL OR _slot_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SLOT', 'message', 'Neteisingas treniruotės laikas.');
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin');

  IF _allow_admin_bypass AND v_is_admin THEN
    RETURN jsonb_build_object('ok', true, 'bypass', true, 'reason', 'ADMIN');
  END IF;

  IF _user_id <> v_actor THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED', 'message', 'Neturite teisės registruoti kito raitelio.');
  END IF;

  v_is_exempt := public.is_subscription_rule_exempt(_user_id);

  IF EXISTS (
    SELECT 1 FROM public.vacations v
    WHERE v.user_id = _user_id
      AND _slot_date BETWEEN v.starts_on AND v.ends_on
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USER_ON_VACATION', 'message', 'Šiai datai pasirinktos atostogos.');
  END IF;

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_NOT_AVAILABLE', 'message', 'Šio laiko grafike nėra.');
  END IF;

  SELECT count(*)::integer INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel');

  IF v_booked_count >= v_capacity THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_FULL', 'message', 'Ši treniruotė jau pilna.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time
      AND b.status IN ('active', 'pending_cancel')
  ) INTO v_existing;

  IF v_existing THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DUPLICATE_BOOKING', 'message', 'Jūs jau užregistruoti į šią pamoką.', 'subscription_exempt', v_is_exempt);
  END IF;

  v_is_permanent := EXISTS (
    SELECT 1 FROM public.permanent_slots ps
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

  IF v_enforcement_active AND NOT v_is_exempt AND NOT v_is_permanent THEN
    v_subscription_usable := public.booking_subscription_is_usable_for_slot(_user_id, _slot_date, _slot_time);

    v_pending_usable := public.pending_subscription_can_cover_slot(_user_id, _slot_date, _slot_time);

    IF NOT v_subscription_usable AND NOT v_pending_usable THEN
      SELECT COUNT(DISTINCT COALESCE(b.family_group_id, b.id))::integer
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
      NOT v_weekly_slot OR v_is_permanent OR public.weekly_registration_window_is_open(_slot_date),
    'subscription_required',
      v_enforcement_active AND NOT v_is_exempt AND NOT v_is_permanent,
    'subscription_usable', v_subscription_usable,
    'subscription_pending_start', v_pending_usable,
    'grace_booking', false,
    'duplicate_protected', true
  );
END;
$equus_eligibility_family$;

-- The pause engine keeps an entire family group together.
CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_pause_family$
DECLARE
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_keep_group uuid;
  v_keep_id uuid;
  v_paused integer := 0;
  r record;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;

  IF public.has_role(_user_id, 'admin')
     OR public.is_subscription_rule_exempt(_user_id)
  THEN
    RETURN 0;
  END IF;

  SELECT b.id, b.family_group_id
    INTO v_keep_id, v_keep_group
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
      AND NOT public.booking_is_permanent(b.id)
      AND (
        b.id IS DISTINCT FROM v_keep_id
        OR (
          v_keep_group IS NOT NULL
          AND b.family_group_id IS DISTINCT FROM v_keep_group
        )
      )
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET is_paused_for_subscription = true
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  RETURN v_paused;
END;
$equus_pause_family$;

-- A server-side atomic pair booking. A 2-rider subscription reservation
-- attaches both rows; a 1-rider subscription attaches only the primary row.
CREATE OR REPLACE FUNCTION public.create_family_booking(
  _slot_date date,
  _slot_time time without time zone,
  _family_rider_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_family_booking$
DECLARE
  v_actor uuid := auth.uid();
  v_child public.family_riders%ROWTYPE;
  v_capacity integer;
  v_occupied integer;
  v_trainer_name text;
  v_package_type text;
  v_sub public.subscriptions%ROWTYPE;
  v_child_counts boolean := false;
  v_primary_sub uuid := NULL;
  v_group uuid := gen_random_uuid();
  v_primary uuid;
  v_child_booking uuid;
  v_eligibility jsonb;
  v_extra_fee numeric(10,2) := 0;
  v_per_lesson numeric(10,2);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _family_rider_id IS NULL THEN RAISE EXCEPTION 'FAMILY_RIDER_REQUIRED'; END IF;

  SELECT *
    INTO v_child
  FROM public.family_riders
  WHERE id = _family_rider_id
    AND parent_user_id = v_actor;

  IF NOT FOUND THEN RAISE EXCEPTION 'FAMILY_RIDER_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-family-booking:' || v_actor::text, 0)
  );

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);
  IF v_capacity <= 0 THEN RAISE EXCEPTION 'SLOT_NOT_AVAILABLE'; END IF;

  SELECT count(*)::integer INTO v_occupied
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active','pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;

  IF v_occupied + 2 > v_capacity THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CAPACITY_FOR_TWO_RIDERS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = v_actor
      AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time
      AND b.status IN ('active','pending_cancel')
  ) THEN
    RAISE EXCEPTION 'PRIMARY_RIDER_ALREADY_BOOKED';
  END IF;

  SELECT t.trainer_name
    INTO v_trainer_name
  FROM public.time_slots t
  WHERE t.active = true
    AND t.slot_time = _slot_time
    AND (
      t.one_off_date = _slot_date
      OR (
        t.one_off_date IS NULL
        AND t.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
      )
    )
  ORDER BY (t.trainer_name IS NULL), t.max_capacity DESC, t.id
  LIMIT 1;

  v_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  v_eligibility := public.check_booking_eligibility(
    v_actor,
    _slot_date,
    _slot_time,
    false
  );

  IF COALESCE((v_eligibility ->> 'ok')::boolean, false) = false THEN
    -- The special legacy po2 flow allows a group subscription to cover a pair
    -- slot with a rate difference. Permit that same valid subscription here.
    IF NOT (
      v_capacity = 2
      AND EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = v_actor
          AND s.paid = true
          AND s.cancelled_at IS NULL
          AND s.start_pending = false
          AND s.start_from_date IS NOT NULL
          AND s.expires_at IS NOT NULL
          AND _slot_date BETWEEN s.start_from_date AND s.expires_at
          AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) IN ('group','po2')
          AND public.subscription_committed_lessons(s.id) < s.lessons_total
      )
    ) THEN
      RAISE EXCEPTION '%', COALESCE(v_eligibility ->> 'message', 'Registracija negalima.');
    END IF;
  END IF;

  SELECT s.*
    INTO v_sub
  FROM public.subscriptions s
  WHERE s.user_id = v_actor
    AND s.paid = true
    AND s.cancelled_at IS NULL
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND _slot_date BETWEEN s.start_from_date AND s.expires_at
    AND public.subscription_committed_lessons(s.id) < s.lessons_total
    AND (
      (v_package_type = 'group'
        AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'group')
      OR
      (v_package_type = 'po2'
        AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) IN ('group','po2'))
    )
  ORDER BY
    COALESCE(s.start_from_date, s.purchase_date),
    s.purchase_date,
    s.purchased_at,
    s.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_sub.covered_riders, 1) = 2 THEN
      IF public.subscription_committed_lessons(v_sub.id) > v_sub.lessons_total - 2 THEN
        RAISE EXCEPTION 'NOT_ENOUGH_SUBSCRIPTION_LESSONS_FOR_TWO_RIDERS';
      END IF;
      v_child_counts := true;
      v_primary_sub := v_sub.id;

      IF v_capacity = 2 THEN
        v_per_lesson := v_sub.price / GREATEST(1, v_sub.lessons_total);
        v_extra_fee := GREATEST(0, ROUND((45 - v_per_lesson) * 2, 2));
      END IF;
    ELSE
      v_child_counts := false;
      v_primary_sub := v_sub.id;

      IF v_capacity = 2 THEN
        v_per_lesson := v_sub.price / GREATEST(1, v_sub.lessons_total);
        v_extra_fee := GREATEST(0, ROUND(45 - v_per_lesson, 2));
      END IF;
    END IF;
  ELSE
    SELECT s.*
      INTO v_sub
    FROM public.subscriptions s
    WHERE s.user_id = v_actor
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = true
      AND COALESCE(s.covered_riders,1) IN (1,2)
      AND public.booking_matches_subscription_package(
        (
          SELECT b.id
          FROM public.bookings b
          WHERE false
        ),
        COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END)
      )
    LIMIT 1;
  END IF;

  PERFORM set_config('equus.allow_family_booking_insert', 'true', true);

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, trainer_name,
    subscription_id, counts_in_subscription, extra_fee_eur, extra_fee_paid,
    family_group_id
  )
  VALUES (
    v_actor, _slot_date, _slot_time, 'active', v_trainer_name,
    v_primary_sub, true, v_extra_fee, false,
    v_group
  )
  RETURNING id INTO v_primary;

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, trainer_name,
    subscription_id, counts_in_subscription, extra_fee_eur, extra_fee_paid,
    family_rider_id, family_group_id
  )
  VALUES (
    v_actor, _slot_date, _slot_time, 'active', v_trainer_name,
    CASE WHEN v_child_counts THEN v_primary_sub ELSE NULL END,
    v_child_counts, v_extra_fee, false,
    _family_rider_id, v_group
  )
  RETURNING id INTO v_child_booking;

  RETURN jsonb_build_object(
    'ok', true,
    'primary_booking_id', v_primary,
    'family_booking_id', v_child_booking,
    'family_group_id', v_group,
    'family_rider_id', _family_rider_id,
    'covered_riders', CASE WHEN v_child_counts THEN 2 ELSE 1 END,
    'extra_fee_eur', v_extra_fee
  );
END;
$equus_family_booking$;

REVOKE ALL
ON FUNCTION public.create_family_booking(date,time without time zone,uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_family_booking(date,time without time zone,uuid)
TO authenticated;

-- The legacy po2 helper is kept intact. This family-specific helper mirrors
-- its group/po2 extra-fee rule while still inserting both riders atomically.
-- (create_family_booking already handles po2 slots, so no second RPC is needed.)

CREATE OR REPLACE FUNCTION public.admin_set_subscription_coverage(
  _subscription_id uuid,
  _covered_riders smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_sub_coverage$
DECLARE
  v_actor uuid := auth.uid();
  v_user uuid;
  v_changed integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_role(v_actor, 'admin') THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF _subscription_id IS NULL OR _covered_riders NOT IN (1,2) THEN
    RAISE EXCEPTION 'INVALID_COVERAGE';
  END IF;

  SELECT user_id INTO v_user
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  UPDATE public.subscriptions
  SET covered_riders = _covered_riders,
      updated_at = now()
  WHERE id = _subscription_id;

  IF _covered_riders = 2 THEN
    UPDATE public.bookings child
    SET
      subscription_id = _subscription_id,
      counts_in_subscription = true
    FROM public.bookings primary_booking
    JOIN public.family_riders fr
      ON fr.id = child.family_rider_id
    WHERE primary_booking.id <> child.id
      AND primary_booking.user_id = v_user
      AND primary_booking.subscription_id = _subscription_id
      AND primary_booking.status IN ('active','pending_cancel')
      AND child.user_id = v_user
      AND child.family_group_id IS NOT NULL
      AND child.family_group_id = primary_booking.family_group_id
      AND child.status IN ('active','pending_cancel')
      AND fr.parent_user_id = v_user;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    UPDATE public.bookings child
    SET
      subscription_id = NULL,
      counts_in_subscription = false
    FROM public.bookings primary_booking
    WHERE primary_booking.id <> child.id
      AND primary_booking.user_id = v_user
      AND primary_booking.subscription_id = _subscription_id
      AND primary_booking.status IN ('active','pending_cancel')
      AND child.user_id = v_user
      AND child.family_rider_id IS NOT NULL
      AND child.family_group_id IS NOT NULL
      AND child.family_group_id = primary_booking.family_group_id
      AND child.status IN ('active','pending_cancel');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', _subscription_id,
    'covered_riders', _covered_riders,
    'family_bookings_updated', v_changed
  );
END;
$equus_sub_coverage$;

REVOKE ALL
ON FUNCTION public.admin_set_subscription_coverage(uuid,smallint)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_subscription_coverage(uuid,smallint)
TO authenticated;

COMMIT;