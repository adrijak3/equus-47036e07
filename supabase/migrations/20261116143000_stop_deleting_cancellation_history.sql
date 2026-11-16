-- Preserve cancellation audit history. Do not prune every Monday.
DO $do$ BEGIN
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='equus-weekly-cancellation-history-cleanup')
THEN PERFORM cron.unschedule('equus-weekly-cancellation-history-cleanup'); END IF;
END $do$;
CREATE OR REPLACE FUNCTION public.cleanup_old_cancellations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$ BEGIN RETURN 0; END; $fn$;
REVOKE ALL ON FUNCTION public.cleanup_old_cancellations() FROM public,anon,authenticated;
