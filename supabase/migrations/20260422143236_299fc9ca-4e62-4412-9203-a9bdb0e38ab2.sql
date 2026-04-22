-- Add makeup deadline column to cancellation_requests for the "yellow" middle option:
-- if admin grants a makeup, the user has until makeup_deadline (end of week of cancellation)
-- to use the lesson; otherwise it counts against subscription.
ALTER TABLE public.cancellation_requests
  ADD COLUMN IF NOT EXISTS makeup_deadline date;

-- Function: expire any past-deadline makeups by marking their booking counts_in_subscription = true
CREATE OR REPLACE FUNCTION public.expire_makeup_cancellations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired integer := 0;
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  WITH expired_reqs AS (
    UPDATE public.cancellation_requests cr
       SET admin_decision_counts = true
     WHERE cr.status = 'approved'
       AND cr.admin_decision_counts = false
       AND cr.makeup_deadline IS NOT NULL
       AND cr.makeup_deadline < vilnius_today
    RETURNING cr.booking_id
  )
  UPDATE public.bookings b
     SET counts_in_subscription = true
   WHERE b.id IN (SELECT booking_id FROM expired_reqs);
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$;