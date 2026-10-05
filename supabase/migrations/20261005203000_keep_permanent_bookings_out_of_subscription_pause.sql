-- Equus: permanent recurring bookings are never paused by subscription enforcement.
-- They are handled by permanent_slots/materialization/vacation logic instead.

CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $pause_uncovered_permanent_safe$
DECLARE
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_enforcement_start constant date := DATE '2026-10-18';
  v_keep_id uuid;
  v_paused integer := 0;
  r record;
BEGIN
  IF _user_id IS NULL
     OR v_local_date < v_enforcement_start
     OR public.has_role(_user_id, 'admin')
     OR public.is_subscription_rule_exempt(_user_id)
  THEN
    RETURN 0;
  END IF;

  -- Keep the earliest ordinary future reservation as the one allowed
  -- grace/advance booking. Permanent bookings are intentionally excluded.
  SELECT b.id
    INTO v_keep_id
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= GREATEST(v_local_date, v_enforcement_start)
    AND b.status = 'active'
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS NOT FALSE
    AND b.is_paused_for_subscription IS FALSE
    AND NOT public.booking_is_permanent(b.id)
  ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LIMIT 1;

  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= GREATEST(v_local_date, v_enforcement_start)
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription IS FALSE
      AND b.id IS DISTINCT FROM v_keep_id
      AND NOT public.booking_is_permanent(b.id)
  LOOP
    SELECT set_config('equus.allow_subscription_pause_update', 'true', true);

    UPDATE public.bookings
    SET
      is_paused_for_subscription = true,
      is_grace_booking = false,
      updated_at = now()
    WHERE id = r.id;

    IF FOUND THEN
      v_paused := v_paused + 1;
    END IF;
  END LOOP;

  RETURN v_paused;
END;
$pause_uncovered_permanent_safe$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;
