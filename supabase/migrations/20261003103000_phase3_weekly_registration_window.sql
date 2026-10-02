-- Equus Phase 3: weekly registration window for Laura's Monday-Friday slots.
--
-- Europe/Vilnius:
--   * Sunday 01:00 opens the following Monday-Sunday week.
--   * During Monday-Saturday, users may register for the current Monday-Sunday week.
--   * Sunday before 01:00 is still the previous week's window.
--   * The rule applies only to recurring Laura slots on Monday-Friday.
--   * Subscription-rule exemptions DO NOT bypass this rule.
--   * Admin bypasses it.

CREATE OR REPLACE FUNCTION public.is_laura_weekly_registration_slot(
  _slot_date date,
  _slot_time time without time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.time_slots ts
    WHERE ts.active = true
      AND ts.one_off_date IS NULL
      AND ts.day_of_week BETWEEN 1 AND 5
      AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
      AND ts.slot_time = _slot_time
      AND ts.trainer_name IS NOT NULL
      AND lower(trim(ts.trainer_name)) = 'laura'
  );
$function$;

REVOKE ALL
ON FUNCTION public.is_laura_weekly_registration_slot(date,time without time zone)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_laura_weekly_registration_slot(date,time without time zone)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.weekly_registration_window_is_open(
  _slot_date date,
  _now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  local_now timestamp;
  current_week_start date;
  target_week_start date;
  max_open_week_start date;
BEGIN
  local_now := _now AT TIME ZONE 'Europe/Vilnius';

  current_week_start :=
    (local_now::date - (EXTRACT(ISODOW FROM local_now)::integer - 1));

  target_week_start :=
    (_slot_date - (EXTRACT(ISODOW FROM _slot_date)::integer - 1));

  -- Before Sunday 01:00, the following week is not open.
  -- From Sunday 01:00 onward, the following Monday-Sunday week opens.
  IF EXTRACT(ISODOW FROM local_now)::integer = 7
     AND local_now::time >= '01:00:00'::time
  THEN
    max_open_week_start := current_week_start + 7;
  ELSE
    max_open_week_start := current_week_start;
  END IF;

  RETURN target_week_start <= max_open_week_start;
END;
$function$;

REVOKE ALL
ON FUNCTION public.weekly_registration_window_is_open(date,timestamptz)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.weekly_registration_window_is_open(date,timestamptz)
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
AS $function$
DECLARE
  v_is_admin boolean := false;
  v_is_exempt boolean := false;
  v_existing boolean := false;
  v_weekly_slot boolean := false;
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

  v_weekly_slot := public.is_laura_weekly_registration_slot(
    _slot_date,
    _slot_time
  );

  IF v_weekly_slot
     AND NOT public.weekly_registration_window_is_open(_slot_date)
  THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'WEEKLY_REGISTRATION_NOT_OPEN',
      'message', 'Registracija į šią savaitę dar neatidaryta. Registracija atsidaro sekmadienį 01:00 val.',
      'subscription_exempt', v_is_exempt,
      'weekly_registration_restricted', true
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'bypass', false,
    'subscription_exempt', v_is_exempt,
    'weekly_registration_restricted', v_weekly_slot,
    'weekly_registration_window_open', NOT v_weekly_slot OR public.weekly_registration_window_is_open(_slot_date),
    'subscription_required', NOT v_is_exempt,
    'duplicate_protected', true
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.check_booking_eligibility(uuid,date,time without time zone,boolean)
TO authenticated, service_role;
