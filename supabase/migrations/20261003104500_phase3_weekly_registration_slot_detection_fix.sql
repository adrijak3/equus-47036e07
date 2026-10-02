-- Phase 3 follow-up:
-- The live recurring Laura schedule does not store trainer_name on time_slots.
-- The active recurring Monday-Friday schedule itself is the Laura schedule.
-- Keep the rule limited to recurring Mon-Fri slots; one-off slots remain excluded.

CREATE OR REPLACE FUNCTION public.is_laura_weekly_registration_slot(
  _slot_date date,
  _slot_time time without time zone
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.time_slots ts
    WHERE ts.active = true
      AND ts.one_off_date IS NULL
      AND ts.day_of_week BETWEEN 1 AND 5
      AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
      AND ts.slot_time = _slot_time
  );
$function$;

REVOKE ALL
ON FUNCTION public.is_laura_weekly_registration_slot(date,time without time zone)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.is_laura_weekly_registration_slot(date,time without time zone)
TO authenticated, service_role;
