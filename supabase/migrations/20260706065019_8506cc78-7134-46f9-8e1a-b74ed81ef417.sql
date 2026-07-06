CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(_start date, _end date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
  ps RECORD;
  d date;
  exists_booking boolean;
BEGIN
  FOR ps IN SELECT user_id, day_of_week, slot_time FROM public.permanent_slots LOOP
    d := _start;
    WHILE d <= _end LOOP
      IF (CASE WHEN EXTRACT(DOW FROM d)::int = 0 THEN 7 ELSE EXTRACT(DOW FROM d)::int END) = ps.day_of_week THEN
        SELECT EXISTS (
          SELECT 1 FROM public.bookings
          WHERE user_id = ps.user_id
            AND slot_date = d
            AND slot_time = ps.slot_time
        ) INTO exists_booking;

        IF NOT exists_booking THEN
          BEGIN
            INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
            VALUES (ps.user_id, d, ps.slot_time, 'active');
            inserted_count := inserted_count + 1;
          EXCEPTION WHEN unique_violation THEN
            NULL;
          END;
        END IF;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_permanent_slot(_user_id uuid, _day_of_week integer, _slot_time time without time zone, _from_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  deleted_slots int := 0;
  cancelled_bookings int := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF caller <> _user_id
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _day_of_week < 1 OR _day_of_week > 7 THEN
    RAISE EXCEPTION 'INVALID_DAY_OF_WEEK';
  END IF;

  WITH d AS (
    DELETE FROM public.permanent_slots
     WHERE user_id = _user_id
       AND day_of_week = _day_of_week
       AND slot_time = _slot_time
    RETURNING 1
  )
  SELECT count(*) INTO deleted_slots FROM d;

  WITH u AS (
    UPDATE public.bookings
       SET status = 'cancelled'
     WHERE user_id = _user_id
       AND slot_time = _slot_time
       AND slot_date >= _from_date
       AND status = 'active'
       AND (CASE WHEN EXTRACT(DOW FROM slot_date)::int = 0 THEN 7 ELSE EXTRACT(DOW FROM slot_date)::int END) = _day_of_week
    RETURNING 1
  )
  SELECT count(*) INTO cancelled_bookings FROM u;

  RETURN jsonb_build_object(
    'deleted_slots', deleted_slots,
    'cancelled_bookings', cancelled_bookings
  );
END;
$function$;