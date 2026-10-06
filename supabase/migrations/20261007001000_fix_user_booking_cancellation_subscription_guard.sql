-- Equus: allow subscription reconciliation triggered by a legitimate
-- user/admin/trainer booking cancellation.
--
-- The subscription financial guard must remain closed to direct client writes,
-- but cancelling a booking can legitimately cause subscription usage/allocation
-- bookkeeping. Mark that cancellation transaction before its AFTER triggers run.

CREATE OR REPLACE FUNCTION public.mark_booking_cancellation_financial_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_cancel_context$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND (
       NEW.user_id = v_actor
       OR public.has_role(v_actor, 'admin')
       OR public.has_role(v_actor, 'trainer')
     )
  THEN
    PERFORM set_config(
      'equus.allow_subscription_financial_update',
      'true',
      true
    );
  END IF;

  RETURN NEW;
END;
$equus_cancel_context$;

DROP TRIGGER IF EXISTS trg_mark_booking_cancellation_financial_context
ON public.bookings;

CREATE TRIGGER trg_mark_booking_cancellation_financial_context
BEFORE UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.mark_booking_cancellation_financial_context();

REVOKE ALL
ON FUNCTION public.mark_booking_cancellation_financial_context()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.mark_booking_cancellation_financial_context()
TO authenticated, service_role;
