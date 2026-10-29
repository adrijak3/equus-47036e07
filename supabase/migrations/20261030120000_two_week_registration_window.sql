-- Open Laura's weekly recurring registration window for two full weeks from Sunday 01:00 (Vilnius time).
-- Existing admin bypasses, duplicate checks and subscription eligibility remain unchanged.
CREATE OR REPLACE FUNCTION public.weekly_registration_window_is_open(
  _slot_date date,
  _now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  local_now timestamp;
  current_week_start date;
  target_week_start date;
  max_open_week_start date;
BEGIN
  local_now := _now AT TIME ZONE 'Europe/Vilnius';
  current_week_start := (local_now::date - (EXTRACT(ISODOW FROM local_now)::integer - 1));
  target_week_start := (_slot_date - (EXTRACT(ISODOW FROM _slot_date)::integer - 1));

  -- Sunday from 01:00 opens the next two Monday-Sunday weeks.
  IF EXTRACT(ISODOW FROM local_now)::integer = 7
     AND local_now::time >= '01:00:00'::time
  THEN
    max_open_week_start := current_week_start + 14;
  ELSE
    max_open_week_start := current_week_start + 7;
  END IF;

  RETURN target_week_start <= max_open_week_start;
END;
$function$;

REVOKE ALL
ON FUNCTION public.weekly_registration_window_is_open(date,timestamptz)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.weekly_registration_window_is_open(date,timestamptz)
TO authenticated, service_role;
