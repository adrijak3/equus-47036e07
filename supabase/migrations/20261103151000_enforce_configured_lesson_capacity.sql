-- Equus: enforce the configured capacity for all booking writers.
-- Fix: no staff bypass, no highest-capacity fallback from a different row,
-- and serialize competing inserts/updates for the same lesson time.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_booking_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_capacity$
DECLARE
  cap integer;
  taken integer;
  dow integer := EXTRACT(ISODOW FROM NEW.slot_date)::integer;
BEGIN
  -- Nonactive / subscription-paused occurrences do not take a seat.
  IF NEW.status <> 'active' OR NEW.is_paused_for_subscription IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Editing an existing active booking without moving/re-activating it
  -- must not fail just because an admin later reduced the slot capacity.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'active'
       AND OLD.is_paused_for_subscription IS NOT TRUE
       AND OLD.slot_date = NEW.slot_date
       AND OLD.slot_time = NEW.slot_time
       AND OLD.trainer_name IS NOT DISTINCT FROM NEW.trainer_name THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serializes concurrent bookings by date + time, including different
  -- authenticated users and SECURITY DEFINER RPC callers.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-slot:' || NEW.slot_date::text || ':' || NEW.slot_time::text, 0)
  );

  -- Date-scoped admin override takes precedence over recurring defaults.
  SELECT o.max_capacity INTO cap
    FROM public.slot_overrides o
   WHERE o.slot_date = NEW.slot_date
     AND o.slot_time = NEW.slot_time
   LIMIT 1;

  IF cap IS NULL THEN
    SELECT ts.max_capacity INTO cap
      FROM public.time_slots ts
     WHERE ts.active = true
       AND ts.slot_time = NEW.slot_time
       AND (ts.one_off_date = NEW.slot_date
            OR (ts.one_off_date IS NULL AND ts.day_of_week = dow))
       AND (NEW.trainer_name IS NULL
            OR ts.trainer_name IS NOT DISTINCT FROM NEW.trainer_name)
     ORDER BY
       (ts.one_off_date = NEW.slot_date) DESC,
       (ts.trainer_name IS NOT DISTINCT FROM NEW.trainer_name) DESC,
       ts.max_capacity ASC,
       ts.id
     LIMIT 1;
  END IF;

  IF cap IS NULL OR cap <= 0 THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer INTO taken
    FROM public.bookings b
   WHERE b.slot_date = NEW.slot_date
     AND b.slot_time = NEW.slot_time
     AND b.status = 'active'
     AND b.is_paused_for_subscription IS NOT TRUE
     AND (NEW.trainer_name IS NULL
          OR b.trainer_name IS NULL
          OR b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name)
     AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

  IF taken >= cap THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$equus_capacity$;

COMMIT;
