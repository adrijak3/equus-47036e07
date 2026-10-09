-- Equus: allow the 20:00 usage batch to finish even if the hourly worker
-- needs more than one minute to process today's past bookings first.
-- The Edge Function only enters its daily batch when it starts at 20:00
-- Europe/Vilnius; this wider internal window avoids a late RPC failing merely
-- because the hourly processing loop took several minutes.

CREATE OR REPLACE FUNCTION public.reconcile_daily_subscription_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $daily_usage_2000_window$
DECLARE
  v_local_now timestamp without time zone :=
    (now() AT TIME ZONE 'Europe/Vilnius');
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_previous_daily_setting text := current_setting(
    'equus.allow_daily_subscription_usage_update',
    true
  );
  v_subscription_id uuid;
  v_reconciled integer := 0;
BEGIN
  IF v_local_now::time < TIME '20:00:00'
     OR v_local_now::time >= TIME '21:00:00'
  THEN
    RAISE EXCEPTION 'OUTSIDE_DAILY_SUBSCRIPTION_USAGE_WINDOW';
  END IF;

  PERFORM set_config(
    'equus.allow_daily_subscription_usage_update',
    'true',
    true
  );

  FOR v_subscription_id IN
    SELECT DISTINCT b.subscription_id
    FROM public.bookings b
    WHERE b.slot_date = v_today
      AND b.status = 'completed'
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription IS NOT TRUE
      AND b.subscription_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_subscription_usage(v_subscription_id);
    v_reconciled := v_reconciled + 1;
  END LOOP;

  IF v_previous_daily_setting = 'true' THEN
    PERFORM set_config(
      'equus.allow_daily_subscription_usage_update',
      'true',
      true
    );
  ELSE
    PERFORM set_config(
      'equus.allow_daily_subscription_usage_update',
      'false',
      true
    );
  END IF;

  RETURN v_reconciled;
END;
$daily_usage_2000_window$;

REVOKE ALL
ON FUNCTION public.reconcile_daily_subscription_usage()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reconcile_daily_subscription_usage()
TO service_role;
