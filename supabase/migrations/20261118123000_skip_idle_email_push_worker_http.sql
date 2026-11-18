-- Reduce Supabase Logs Ingestion by skipping empty Edge Function calls.
-- Keep the same 5-minute schedules and the same event/notification generation.
-- This is not a deletion of audit, booking or email data.

-- Legacy callers of queue_equus_notification previously wrote to the push
-- queue without checking whether a user opted in on an active device.
CREATE OR REPLACE FUNCTION public.queue_equus_notification(
  _user_id uuid, _kind text, _title_lt text, _title_en text,
  _body_lt text, _body_en text, _url text DEFAULT '/grafikas',
  _dedupe_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT public.queue_push_notification(
    _user_id, _kind, _title_lt, _title_en,
    _body_lt, _body_en, _url, _dedupe_key
  );
$$;

-- Continue preparing due email events at every existing tick. Only invoke
-- the HTTP worker if there is sendable mail or a stale processing record
-- requiring recovery. Failed/completed records never trigger empty runs.
CREATE OR REPLACE FUNCTION public.equus_email_cron_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$
DECLARE
  cron_secret text;
BEGIN
  PERFORM public.queue_subscription_expiry_emails();
  PERFORM public.enforce_subscription_requirement_deadlines();

  IF NOT EXISTS (
    SELECT 1 FROM public.email_events e
    WHERE e.status = 'pending'
      AND e.attempts < 10
      AND NULLIF(btrim(e.email), '') IS NOT NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.email_events e
    WHERE e.status = 'processing'
      AND e.processing_started_at < now() - interval '15 minutes'
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;
  IF NULLIF(cron_secret, '') IS NULL THEN
    RAISE WARNING 'equus_push_cron_secret missing: pending email event(s) not processed';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/send-subscription-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-equus-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$$;

-- Prepare reminders and expiring-subscription in-app notices in the database.
-- This preserves timing and makes bell notifications independent of whether
-- any push device exists. The HTTP worker runs only when jobs need delivery.
CREATE OR REPLACE FUNCTION public.equus_push_cron_tick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cron_secret text;
  request_id bigint;
BEGIN
  PERFORM public.queue_training_reminders();
  PERFORM public.equus_queue_subscription_expiry_notices();

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_queue q
    WHERE q.sent_at IS NULL AND q.failed_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;
  IF NULLIF(cron_secret, '') IS NULL THEN
    RAISE WARNING 'Equus push cron secret missing: queued notifications not sent';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-equus-push-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  ) INTO request_id;
  RETURN request_id;
END;
$$;
