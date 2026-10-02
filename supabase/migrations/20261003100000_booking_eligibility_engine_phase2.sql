-- Equus Phase 2: central booking eligibility foundation.
--
-- This migration does NOT activate the October 18 subscription requirement
-- and does NOT yet change the weekly registration window. It establishes one
-- server-side function that later booking flows can call consistently.
--
-- Rules represented here:
--   * Admin bypasses all new eligibility restrictions.
--   * Half-admin does not receive an admin bypass.
--   * Subscription-rule exemptions bypass ONLY subscription requirement.
--   * Weekly registration restriction is intentionally not active yet; Phase 3
--     will add it once Laura's slots are identified precisely.
--   * Exact duplicate active/pending booking protection remains in place.

CREATE OR REPLACE FUNCTION public.is_subscription_rule_exempt(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscription_rule_exemptions e
    WHERE e.user_id = _user_id
  );
$function$;

REVOKE ALL ON FUNCTION public.is_subscription_rule_exempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_subscription_rule_exempt(uuid) TO authenticated, service_role;

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

  RETURN jsonb_build_object(
    'ok', true,
    'bypass', false,
    'subscription_exempt', v_is_exempt,
    'weekly_registration_restricted', false,
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

-- Add a BEFORE INSERT guard for direct booking inserts. This deliberately
-- checks only the stable foundation in Phase 2: authentication, admin bypass,
-- and exact duplicate protection. Subscription/weekly rules are activated in
-- later migrations so existing behavior is not accidentally changed here.
CREATE OR REPLACE FUNCTION public.enforce_booking_eligibility_phase2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_booking_eligibility_phase2
ON public.bookings;

CREATE TRIGGER trg_enforce_booking_eligibility_phase2
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_booking_eligibility_phase2();
