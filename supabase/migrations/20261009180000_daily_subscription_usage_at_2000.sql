-- Equus: update subscription lesson usage at 20:00 Europe/Vilnius, only for riders
-- whose counted training was completed on that local calendar day.
--
-- The old hourly process-lessons job plus the rider account page could mark a
-- past booking completed at arbitrary times. Keep the booking/accounting engine,
-- but defer today's lessons_used count until 20:00 local time. Previous dates
-- remain reconcilable so delayed jobs can safely catch up.
--
-- Admin adjustment/purchase RPCs remain unchanged and retain their full bypass.

CREATE OR REPLACE FUNCTION public.reconcile_subscription_usage(
  _subscription_id uuid
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reconcile_subscription_usage_2000$
DECLARE
  v_used smallint := 0;
  v_total smallint;
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lessons_total
    INTO v_total
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::smallint
    INTO v_used
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.slot_date BETWEEN
      COALESCE(s.start_from_date, s.purchase_date)
      AND s.expires_at
    -- Same-day completion events cannot change lessons_used on their own.
    -- Only the dedicated 20:00 batch sets this transaction-local flag.
    AND (
      b.slot_date < v_local_date
      OR (
        b.slot_date = v_local_date
        AND current_setting('equus.allow_daily_subscription_usage_update', true) = 'true'
      )
    )
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    );

  -- This is the trusted internal accounting writer. Authorize only its own
  -- lessons_used UPDATE, then restore the surrounding transaction's marker.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET lessons_used = LEAST(v_total, v_used)
  WHERE id = _subscription_id;

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config(
      'equus.allow_subscription_financial_update',
      'true',
      true
    );
  ELSE
    PERFORM set_config(
      'equus.allow_subscription_financial_update',
      'false',
      true
    );
  END IF;

  RETURN LEAST(v_total, v_used);
END;
$reconcile_subscription_usage_2000$;

REVOKE ALL
ON FUNCTION public.reconcile_subscription_usage(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reconcile_subscription_usage(uuid)
TO service_role;


-- The daily batch sets a transaction-local accounting flag, then reconciles
-- only subscriptions with a counted, completed booking on today's local date.
-- This keeps ordinary hourly booking triggers from consuming today's lessons
-- before the 20:00 batch.
CREATE OR REPLACE FUNCTION public.reconcile_daily_subscription_usage()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $daily_usage_2000$
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
     OR v_local_now::time >= TIME '20:01:00'
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
$daily_usage_2000$;

REVOKE ALL
ON FUNCTION public.reconcile_daily_subscription_usage()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reconcile_daily_subscription_usage()
TO service_role;


-- Keep the existing hourly worker hourly: it also expires make-up grants and
-- processes bookings. Only the worker's subscription-usage batch is gated to
-- 20:00 Europe/Vilnius inside the Edge Function, so DST changes are safe.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'process-lessons-hourly',
  'process-lessons-daily-20-vilnius'
);

SELECT cron.schedule(
  'process-lessons-hourly',
  '0 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/process-lessons',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $cron$
);
