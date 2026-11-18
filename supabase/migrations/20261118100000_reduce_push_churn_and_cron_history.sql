-- Reduce Equus Free-plan usage without changing booking or email behavior.
-- Only enqueue a browser push when its user has an active push subscription.
-- In-app bell notifications are managed separately and remain unaffected.
CREATE OR REPLACE FUNCTION public.queue_push_notification(
  _user_id uuid,
  _kind text,
  _title_lt text,
  _title_en text,
  _body_lt text,
  _body_en text,
  _url text DEFAULT '/grafikas'::text,
  _dedupe_key text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Users without an enabled browser/device cannot receive push. Avoid
  -- creating an undeliverable job (and the inevitable failed-job log).
  IF NOT EXISTS (
    SELECT 1
    FROM public.push_subscriptions ps
    WHERE ps.user_id = _user_id
      AND ps.active IS TRUE
      AND ps.invalid_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notification_queue (
    user_id, kind, title_lt, title_en, body_lt, body_en, url, dedupe_key
  )
  VALUES (
    _user_id, _kind, _title_lt, _title_en, _body_lt, _body_en,
    COALESCE(_url, '/grafikas'), _dedupe_key
  )
  ON CONFLICT (dedupe_key)
  WHERE (dedupe_key IS NOT NULL)
  DO NOTHING
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$function$;

-- Keep two weeks of successful cron history for auditing, indefinitely
-- retain failure rows, and keep only one month of undeliverable push records.
-- Never remove sent push records, actual in-app notices, emails, or bookings.
CREATE OR REPLACE FUNCTION public.equus_prune_worker_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  DELETE FROM cron.job_run_details
  WHERE status = 'succeeded'
    AND end_time < now() - interval '14 days';

  DELETE FROM public.notification_queue
  WHERE failed_at < now() - interval '30 days'
    AND last_error = 'NO_ACTIVE_SUBSCRIPTIONS';
END;
$function$;

REVOKE ALL ON FUNCTION public.equus_prune_worker_history() FROM PUBLIC, anon, authenticated;
-- One additional lightweight daily run; no new Edge Function calls.
SELECT cron.schedule(
  'equus-prune-worker-history',
  '10 4 * * *',
  'SELECT public.equus_prune_worker_history();'
);
