-- Run the subscription email queue worker every minute.
-- The worker itself validates EQUUS_CRON_SECRET.
-- The same Vault secret already used by the push cron is reused here.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE OR REPLACE FUNCTION public.equus_email_cron_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  cron_secret text;
BEGIN
  SELECT decrypted_secret
    INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE WARNING 'equus_push_cron_secret is missing; subscription email worker was not invoked';
    RETURN;
  END IF;

  -- Queue subscription-expiry reminders once per day (event keys prevent duplicates).
  PERFORM public.queue_subscription_expiry_emails();

  PERFORM net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/send-subscription-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-equus-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')::jsonb
  );
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('equus-subscription-email-every-minute');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

SELECT cron.schedule(
  'equus-subscription-email-every-minute',
  '* * * * *',
  $$SELECT public.equus_email_cron_tick();$$
);
