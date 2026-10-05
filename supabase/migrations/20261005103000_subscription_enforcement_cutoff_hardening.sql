-- Equus: hard stop for subscription-driven pausing before 2026-10-18.
--
-- Keep the existing subscription/recurring-booking rules intact. This is only
-- a boundary hardening migration:
--   * before 2026-10-18, this function cannot pause anything;
--   * on/after 2026-10-18, only bookings dated on/after 2026-10-18 are
--     eligible for subscription-driven pausing;
--   * permanent bookings keep their existing canonical recurring behavior;
--   * no booking status is changed here (pause != cancellation).
--
-- CREATE OR REPLACE is used so existing triggers/functions continue to refer
-- to the same function object.

CREATE OR REPLACE FUNCTION public.pause_uncovered_future_bookings(
  _user_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $subscription_pause_cutoff$
DECLARE
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_enforcement_start constant date := DATE '2026-10-18';
  v_keep_id uuid;
  v_paused integer := 0;
  r record;
BEGIN
  IF _user_id IS NULL
     OR public.has_role(_user_id, 'admin')
     OR public.is_subscription_rule_exempt(_user_id)
  THEN
    RETURN 0;
  END IF;

  -- Absolute boundary: subscription enforcement does not exist before
  -- 2026-10-18, even if this helper is called directly by service_role.
  IF v_local_date < v_enforcement_start THEN
    RETURN 0;
  END IF;

  SELECT b.id
    INTO v_keep_id
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date >= v_enforcement_start
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

  -- Permanent recurring reservations keep their existing canonical behavior:
  -- after the enforcement start they may be represented as paused when the
  -- recurring materializer determines that no usable subscription exists.
  -- They are never cancelled by this function.
  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= v_enforcement_start
      AND b.slot_date >= v_local_date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND public.booking_is_permanent(b.id)
  LOOP
    UPDATE public.bookings
    SET
      is_paused_for_subscription = true,
      is_grace_booking = false
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  -- Ordinary future reservations keep exactly one grace booking.
  FOR r IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date >= v_enforcement_start
      AND b.slot_date >= v_local_date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND NOT public.booking_is_permanent(b.id)
      AND b.id IS DISTINCT FROM v_keep_id
    ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
  LOOP
    UPDATE public.bookings
    SET
      is_paused_for_subscription = true,
      is_grace_booking = false
    WHERE id = r.id;

    v_paused := v_paused + 1;
  END LOOP;

  IF v_keep_id IS NOT NULL THEN
    UPDATE public.bookings
    SET is_grace_booking = true
    WHERE id = v_keep_id;
  END IF;

  RETURN v_paused;
END;
$subscription_pause_cutoff$;

REVOKE ALL
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.pause_uncovered_future_bookings(uuid)
TO service_role;
