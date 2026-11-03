-- Equus: weekday availability for horses; safely preserve existing assignments.
-- ISO weekdays: Monday=1 ... Sunday=7. Existing horses remain available daily.
BEGIN;

ALTER TABLE public.horses
  ADD COLUMN IF NOT EXISTS allowed_weekdays integer[] NOT NULL
  DEFAULT ARRAY[1,2,3,4,5,6,7]::integer[];

ALTER TABLE public.horses
  DROP CONSTRAINT IF EXISTS horses_allowed_weekdays_valid;
ALTER TABLE public.horses
  ADD CONSTRAINT horses_allowed_weekdays_valid
  CHECK (
    allowed_weekdays IS NOT NULL
    AND array_position(allowed_weekdays, NULL) IS NULL
    AND allowed_weekdays <@ ARRAY[1,2,3,4,5,6,7]::integer[]
    AND (SELECT COUNT(DISTINCT n) FROM unnest(allowed_weekdays) AS n) = cardinality(allowed_weekdays)
  );

CREATE OR REPLACE FUNCTION public.enforce_horse_weekday()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_horse_weekday$
DECLARE
  days integer[];
BEGIN
  SELECT h.allowed_weekdays INTO days
  FROM public.horses AS h
  WHERE h.id = NEW.horse_id;

  IF days IS NULL THEN
    RAISE EXCEPTION 'HORSE_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (EXTRACT(ISODOW FROM NEW.slot_date)::integer = ANY(days)) THEN
    RAISE EXCEPTION 'HORSE_DAY_UNAVAILABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$equus_horse_weekday$;

DROP TRIGGER IF EXISTS trg_enforce_horse_weekday ON public.horse_assignments;
CREATE TRIGGER trg_enforce_horse_weekday
BEFORE INSERT OR UPDATE OF horse_id, slot_date ON public.horse_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_horse_weekday();

REVOKE ALL ON FUNCTION public.enforce_horse_weekday() FROM PUBLIC, anon, authenticated;
COMMIT;
