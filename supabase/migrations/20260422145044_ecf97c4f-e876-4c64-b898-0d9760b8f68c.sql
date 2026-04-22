-- Cleanup function: delete bookings whose date is older than the cutoff
-- (last day of previous month + 7 days, in Vilnius TZ)
CREATE OR REPLACE FUNCTION public.cleanup_old_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  -- Last day of previous month + 7 days = first of current month - 1 + 7
  cutoff date := (date_trunc('month', vilnius_today)::date - 1) + 7;
  removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.bookings
     WHERE slot_date < cutoff
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;