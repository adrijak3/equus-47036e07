-- Only Miglė Jankauskaitė can choose horses one additional week early.
-- All other riders, booking ownership, dates, active horse requirements,
-- and assignment integrity checks remain unchanged.
CREATE OR REPLACE FUNCTION public.select_horse_for_booking(_booking_id uuid, _horse_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  booking_row public.bookings%ROWTYPE;
  horse_row public.horses%ROWTYPE;
  vilnius_now timestamp;
  booking_date date;
  existing_assignment_id uuid;
  early_selection_days integer := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO booking_row FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF booking_row.user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'NOT_YOUR_BOOKING';
  END IF;
  IF booking_row.status <> 'active' THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE';
  END IF;

  vilnius_now := now() AT TIME ZONE 'Europe/Vilnius';
  booking_date := booking_row.slot_date;

  IF caller = '016c84e1-b5d7-430f-ab95-d9acff55a570'::uuid THEN
    early_selection_days := 7;
  END IF;

  -- Usual opening: Sunday 00:00 before the booked Monday-Sunday week.
  -- Miglė: Sunday 00:00 one week earlier. Never permit past lesson start.
  IF vilnius_now < (
    booking_date - (EXTRACT(ISODOW FROM booking_date)::integer - 1) - 1 - early_selection_days
  )::timestamp THEN
    RAISE EXCEPTION 'HORSE_SELECTION_NOT_OPEN';
  END IF;
  IF vilnius_now >= booking_date + booking_row.slot_time THEN
    RAISE EXCEPTION 'HORSE_SELECTION_CLOSED';
  END IF;

  SELECT * INTO horse_row
  FROM public.horses WHERE id = _horse_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'HORSE_NOT_AVAILABLE'; END IF;

  SELECT id INTO existing_assignment_id
  FROM public.horse_assignments
  WHERE booking_id = _booking_id LIMIT 1;

  IF existing_assignment_id IS NOT NULL THEN
    UPDATE public.horse_assignments
       SET horse_id = _horse_id, user_id = caller
     WHERE id = existing_assignment_id;
  ELSE
    INSERT INTO public.horse_assignments (
      booking_id, user_id, guest_name, slot_date, slot_time, horse_id, assigned_by
    )
    VALUES (
      _booking_id, caller, NULL, booking_row.slot_date, booking_row.slot_time,
      _horse_id, caller
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'booking_id', _booking_id, 'horse_id', _horse_id
  );
END;
$function$;
