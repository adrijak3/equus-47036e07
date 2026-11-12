-- Live change deployed 2026-11-12: process-lessons is cron-only.
-- Uses Vault-held secret; no credential value is stored in Git.
CREATE OR REPLACE FUNCTION public.equus_process_cron_tick()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cron_secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;
  IF NULLIF(cron_secret, '') IS NULL THEN
    RAISE LOG 'Equus process-lessons cron secret missing';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/process-lessons',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-equus-cron-secret', cron_secret),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.equus_process_cron_tick() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('process-lessons-hourly', '0 * * * *', 'SELECT public.equus_process_cron_tick();');
