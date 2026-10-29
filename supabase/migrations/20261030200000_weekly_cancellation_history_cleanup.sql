-- Keep only cancellation history from the current Vilnius calendar week.
-- Run every Monday after the week has rolled over.
CREATE OR REPLACE FUNCTION public.cleanup_old_cancellations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  week_start timestamptz :=
    date_trunc('week', now() AT TIME ZONE 'Europe/Vilnius')
      AT TIME ZONE 'Europe/Vilnius';
  removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.booking_cancellations
     WHERE created_at < week_start
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;

  RETURN removed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_old_cancellations() TO service_role;

-- Replace any existing job with the same name so the schedule is deterministic.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'equus-weekly-cancellation-history-cleanup') THEN
    PERFORM cron.unschedule('equus-weekly-cancellation-history-cleanup');
  END IF;
END;
$$;

SELECT cron.schedule(
  'equus-weekly-cancellation-history-cleanup',
  '15 0 * * 1',
  $$SELECT public.cleanup_old_cancellations();$$
);
