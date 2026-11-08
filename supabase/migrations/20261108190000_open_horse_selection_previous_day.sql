-- Riders may select or change a horse beginning 20:00 Europe/Vilnius
-- on the previous day, until 21:00 on their actual training day.
CREATE OR REPLACE FUNCTION public.select_horse_for_booking(_booking_id uuid, _horse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();

  booking_row public.bookings%ROWTYPE;
  horse_row public.horses%ROWTYPE;

  vilnius_now timestamp;
  booking_date date;
  existing_assignment_id uuid;
BEGIN

  -- ----------------------------------------------------------
  -- Must be logged in
  -- ----------------------------------------------------------
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;


  -- ----------------------------------------------------------
  -- Get booking
  -- ----------------------------------------------------------
  SELECT *
    INTO booking_row
  FROM public.bookings
  WHERE id = _booking_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;


  -- ----------------------------------------------------------
  -- Booking must belong to the current user
  -- ----------------------------------------------------------
  IF booking_row.user_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'NOT_YOUR_BOOKING';
  END IF;


  -- ----------------------------------------------------------
  -- Booking must still be active
  -- ----------------------------------------------------------
  IF booking_row.status <> 'active' THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE';
  END IF;


  -- ----------------------------------------------------------
  -- Use Vilnius time
  -- ----------------------------------------------------------
  vilnius_now := now() AT TIME ZONE 'Europe/Vilnius';
  booking_date := booking_row.slot_date;


  -- ----------------------------------------------------------
  -- Horse choice opens at 20:00 the evening BEFORE the lesson.
  -- It remains available until 21:00 on the lesson day (Vilnius time).
  IF vilnius_now < (booking_date - 1) + TIME '20:00' THEN
    RAISE EXCEPTION 'HORSE_SELECTION_NOT_OPEN';
  END IF;

  IF vilnius_now >= booking_date + TIME '21:00' THEN
    RAISE EXCEPTION 'HORSE_SELECTION_CLOSED';
  END IF;


  -- ----------------------------------------------------------
  -- Horse must exist and be active
  -- ----------------------------------------------------------
  SELECT *
    INTO horse_row
  FROM public.horses
  WHERE id = _horse_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HORSE_NOT_AVAILABLE';
  END IF;


  -- ----------------------------------------------------------
  -- Find current assignment, if user already selected a horse
  -- ----------------------------------------------------------
  SELECT id
    INTO existing_assignment_id
  FROM public.horse_assignments
  WHERE booking_id = _booking_id
  LIMIT 1;


  -- ----------------------------------------------------------
  -- If they already have a horse, UPDATE it.
  -- Otherwise INSERT it.
  --
  -- The daily-limit trigger protects the horse count.
  -- ----------------------------------------------------------
  IF existing_assignment_id IS NOT NULL THEN

    UPDATE public.horse_assignments
       SET horse_id = _horse_id,
           user_id = caller
     WHERE id = existing_assignment_id;

  ELSE

    INSERT INTO public.horse_assignments (
      booking_id,
      user_id,
      guest_name,
      slot_date,
      slot_time,
      horse_id,
      assigned_by
    )
    VALUES (
      _booking_id,
      caller,
      NULL,
      booking_row.slot_date,
      booking_row.slot_time,
      _horse_id,
      caller
    );

  END IF;


  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'horse_id', _horse_id
  );

END;
$function$
;
