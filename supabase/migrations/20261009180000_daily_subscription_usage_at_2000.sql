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
  v_local_now timestamp without time zone :=
    (now() AT TIME ZONE 'Europe/Vilnius');
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
    -- Today's lessons must not change lessons_used before 20:00 Vilnius time.
    -- Completed lessons from previous dates remain valid catch-up history.
    AND (
      b.slot_date < v_local_date
      OR (
        b.slot_date = v_local_date
        AND v_local_now::time >= TIME '20:00:00'
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


-- pg_cron uses UTC by default on many hosted PostgreSQL projects. Keep its
-- hourly tick but invoke the Edge Function only when that tick corresponds to
-- 20:00 in Europe/Vilnius, which handles both winter and summer time correctly.
-- The Edge Function also checks local time so direct/client calls outside the
-- 20:00 hour are harmless no-ops.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'process-lessons-hourly',
  'process-lessons-daily-20-vilnius'
);

SELECT cron.schedule(
  'process-lessons-daily-20-vilnius',
  '0 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://tkksskpvpartlhpnctzu.supabase.co/functions/v1/process-lessons',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id
    WHERE EXTRACT(
      HOUR FROM (now() AT TIME ZONE 'Europe/Vilnius')
    )::integer = 20;
  $cron$
);
