-- Recreate the trigger function so it passes proper DATE values (not timestamps)
-- and uses Europe/Vilnius local time when deciding "today".
CREATE OR REPLACE FUNCTION public.on_permanent_slot_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  PERFORM public.materialize_permanent_bookings(
    vilnius_today,
    (vilnius_today + INTERVAL '12 weeks')::date
  );
  RETURN NEW;
END;
$$;