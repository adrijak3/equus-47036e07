-- Prevent recurring materialization when an admin suppresses one occurrence
-- with a zero-capacity date override (used for one-day time changes).
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
  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;

    WHILE d <= _end LOOP
      IF (
        CASE
          WHEN EXTRACT(DOW FROM d)::int = 0 THEN 7
          ELSE EXTRACT(DOW FROM d)::int
        END
      ) = ps.day_of_week
      AND NOT EXISTS (
        SELECT 1
        FROM public.slot_overrides
        WHERE slot_date = d
          AND slot_time = ps.slot_time
          AND max_capacity = 0
      ) THEN

        SELECT EXISTS (
          SELECT 1
          FROM public.bookings
          WHERE user_id = ps.user_id
            AND slot_date = d
            AND slot_time = ps.slot_time
        ) INTO exists_booking;

        IF NOT exists_booking THEN
          BEGIN
            INSERT INTO public.bookings (
              user_id,
              slot_date,
              slot_time,
              status
            )
            VALUES (
              ps.user_id,
              d,
              ps.slot_time,
              'active'
            );

            inserted_count := inserted_count + 1;
          EXCEPTION
            WHEN unique_violation THEN
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

REVOKE ALL ON FUNCTION public.materialize_permanent_bookings(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO service_role;
