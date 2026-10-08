-- Equus: surgical fix for permanent recurring materialization vs subscription pause boundary.
--
-- Permanent recurring bookings are subscription-independent. They must never
-- be inserted with is_paused_for_subscription = true.
-- If the slot is full, simply do not materialize that occurrence.
-- All existing vacation, exception, zero-capacity, duplicate and 3-hour rules
-- remain unchanged.

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $materialize_permanent_boundary_fix$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
  v_capacity integer;
  v_occupied integer;
BEGIN
  PERFORM set_config('equus.allow_permanent_materialization', 'true', true);

  IF _end < _start THEN
    RETURN 0;
  END IF;

  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;

    WHILE d <= _end LOOP
      IF EXTRACT(ISODOW FROM d)::integer = ps.day_of_week
        AND NOT EXISTS (
          SELECT 1
          FROM public.slot_overrides so
          WHERE so.slot_date = d
            AND so.slot_time = ps.slot_time
            AND so.max_capacity = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.permanent_booking_exceptions pbe
          WHERE pbe.user_id = ps.user_id
            AND pbe.slot_date = d
            AND pbe.slot_time = ps.slot_time
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.vacations v
          WHERE v.user_id = ps.user_id
            AND d BETWEEN v.starts_on AND v.ends_on
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.user_id = ps.user_id
            AND b.slot_date = d
            AND b.slot_time = ps.slot_time
            AND b.status IN ('active', 'pending_cancel')
        )
        AND (
          d > (now() AT TIME ZONE 'Europe/Vilnius')::date
          OR make_timestamptz(
            EXTRACT(YEAR FROM d)::integer,
            EXTRACT(MONTH FROM d)::integer,
            EXTRACT(DAY FROM d)::integer,
            EXTRACT(HOUR FROM ps.slot_time)::integer,
            EXTRACT(MINUTE FROM ps.slot_time)::integer,
            EXTRACT(SECOND FROM ps.slot_time),
            'Europe/Vilnius'
          ) >= now() + interval '3 hours'
        )
      THEN
        v_capacity := public.equus_effective_slot_capacity(d, ps.slot_time);

        SELECT count(*)::integer
          INTO v_occupied
        FROM public.bookings occupied
        WHERE occupied.slot_date = d
          AND occupied.slot_time = ps.slot_time
          AND occupied.status IN ('active', 'pending_cancel')
          AND occupied.is_paused_for_subscription IS NOT TRUE;

        -- A permanent booking is never paused for subscription reasons.
        -- If there is no capacity, leave this occurrence unmaterialized.
        IF v_occupied < v_capacity THEN
          BEGIN
            INSERT INTO public.bookings (
              user_id,
              slot_date,
              slot_time,
              status,
              counts_in_subscription,
              is_paused_for_subscription,
              is_grace_booking
            )
            VALUES (
              ps.user_id,
              d,
              ps.slot_time,
              'active',
              true,
              false,
              false
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
$materialize_permanent_boundary_fix$;

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date,date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date,date)
TO service_role;
