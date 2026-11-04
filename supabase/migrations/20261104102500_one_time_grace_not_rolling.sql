-- Non-exempt riders get one grace lesson in total, not one repeating
-- future grace reservation. Historic completed grace lessons count as used.
-- Existing bookings, exemptions, and recurring materialization remain unchanged.
CREATE OR REPLACE FUNCTION public.check_booking_eligibility(_user_id uuid, _slot_date date, _slot_time time without time zone, _allow_admin_bypass boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_local_now timestamp := now() AT TIME ZONE 'Europe/Vilnius';
  v_first_visible_monday date;
  v_last_visible_sunday date;
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

  -- Two released calendar weeks (Sunday 01:00 opens the next one).
  -- Admins were already handled above; permanent auto-materialization
  -- bypasses eligibility via its dedicated trigger setting.
  v_first_visible_monday := date_trunc('week', v_local_now)::date;
  v_last_visible_sunday := v_first_visible_monday + 13;
  IF extract(isodow FROM v_local_now)::integer = 7
     AND v_local_now::time >= time '01:00' THEN
    -- New week opens at 01:00 on Sunday without hiding today's lessons.
    v_last_visible_sunday := v_first_visible_monday + 20;
  END IF;
  IF _slot_date < v_first_visible_monday OR _slot_date > v_last_visible_sunday THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BOOKING_WINDOW_CLOSED',
      'message', 'Ši savaitė dar neatidaryta. Galite registruotis tik į dvi atidarytas savaites. Nauja savaitė atsidaro sekmadienį 01:00.'
    );
  END IF;

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_NOT_AVAILABLE', 'message', 'Šio laiko grafike nėra.');
  END IF;

  SELECT count(*)::integer INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;

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

  IF v_enforcement_active AND NOT v_is_exempt THEN
    v_subscription_usable := public.booking_subscription_is_usable_for_slot(_user_id, _slot_date, _slot_time);

    v_pending_usable := public.pending_subscription_can_cover_slot(_user_id, _slot_date, _slot_time);

    IF NOT v_subscription_usable AND NOT v_pending_usable THEN
      -- A grace lesson is a one-time allowance, not a rolling free
      -- future booking that reappears after a lesson is completed.
      -- Existing active unpaid bookings also use the allowance.
      -- Auto-created permanent occurrences are grandfathered and
      -- do not consume the manual grace allowance.
      SELECT COUNT(DISTINCT COALESCE(b.family_group_id, b.id))::integer
        INTO v_grace_count
      FROM public.bookings b
      WHERE b.user_id = _user_id
        AND NOT public.booking_is_permanent(b.id)
        AND (
          (b.is_grace_booking = true
           AND b.status IN ('active','pending_cancel','completed'))
          OR
          (b.slot_date >= v_local_date
           AND b.status IN ('active','pending_cancel')
           AND b.subscription_id IS NULL
           AND b.counts_in_subscription IS NOT FALSE
           AND b.is_paused_for_subscription = false)
        );

      IF v_grace_count >= 1 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'GRACE_BOOKING_ALREADY_USED',
          'message', 'Vieną treniruotę be abonemento jau išnaudojote. Norint registruotis į daugiau treniruočių, reikia abonemento.',
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
      v_enforcement_active AND NOT v_is_exempt,
    'subscription_usable', v_subscription_usable,
    'subscription_pending_start', v_pending_usable,
    'grace_booking', false,
    'duplicate_protected', true
  );
END;
$function$
;
