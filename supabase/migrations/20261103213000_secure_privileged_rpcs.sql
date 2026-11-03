-- Equus security hardening: do not expose internal or admin RPCs to anon.
-- Keep deliberate anonymous public registration/review and read-only endpoints.
-- Triggers execute regardless of SQL EXECUTE privilege for API roles.
BEGIN;
DO $secure$
DECLARE f record;
BEGIN
 FOR f IN
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
    EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid=p.oid AND NOT t.tgisinternal) AS is_trigger
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
 LOOP
  -- Public API endpoints whose anonymous access is intentional.
  IF f.proname IN (
    'get_approved_reviews','get_public_registration_request',
    'get_public_registration_slots','has_role','owns_profile',
    'respond_to_public_registration','respond_to_public_registration_proposal',
    'slot_group_state','submit_public_registration','submit_public_registration_v2',
    'submit_public_review','trainer_rider_level'
  ) THEN CONTINUE; END IF;

  EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
    f.proname, f.args);

  IF f.is_trigger
     OR f.proname IN (
       'delete_user_data','cleanup_old_bookings','cleanup_old_cancellations',
       'cleanup_old_conversations','cleanup_old_day_notes',
       'cleanup_old_public_registrations','claim_notification_queue',
       'equus_email_cron_tick','equus_push_cron_tick',
       'queue_24h_training_reminders','queue_training_reminders',
       'expire_makeup_cancellations','dedupe_subscription_day_bookings',
       'queue_equus_notification','queue_push_notification'
     )
  THEN
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated',
      f.proname, f.args);
  END IF;
 END LOOP;
END
$secure$;

-- Admin-only Edge Functions use the service-role key, not the client JWT.
GRANT EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_queue(integer) TO service_role;
COMMIT;
