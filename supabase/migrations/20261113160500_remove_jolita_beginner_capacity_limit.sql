-- Jolita: rider skill classification no longer restricts group seats.
-- The authoritative enforce_booking_capacity() trigger continues to honor
-- the configured capacity (currently 4 for Jolita's active time slots),
-- subscription-paused exclusions, and concurrent booking locks.
CREATE OR REPLACE FUNCTION public.enforce_trainer_group_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
