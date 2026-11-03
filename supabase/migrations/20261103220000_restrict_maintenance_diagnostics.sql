-- Additional audit findings: two internal diagnostic/repair RPCs are unsafe for clients.
-- They are not invoked by the frontend; keep service-role access for maintenance.
BEGIN;
REVOKE ALL ON FUNCTION public.repair_missing_permanent_bookings(date,date)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_missing_permanent_bookings(date,date) TO service_role;

REVOKE ALL ON FUNCTION public.subscription_rules_diagnostics(uuid,date,time without time zone)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_rules_diagnostics(uuid,date,time without time zone) TO service_role;
COMMIT;