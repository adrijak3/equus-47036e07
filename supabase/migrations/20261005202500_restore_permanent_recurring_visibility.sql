-- Equus: permanent recurring bookings must stay independent from subscription enforcement.
-- Subscription pause/grace logic applies only to ordinary bookings.
-- Permanent slots are materialized as real active bookings and are never
-- created paused by the subscription engine.

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $materialize_permanent_final$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
BEGIN
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

      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$materialize_permanent_final$;

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date,date)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date,date)
TO service_role;

-- Repair already-materialized permanent bookings that were incorrectly paused
-- by the subscription-aware materializer. Do not touch ordinary bookings.
SELECT set_config('equus.allow_subscription_pause_update', 'true', true);

UPDATE public.bookings b
SET
  is_paused_for_subscription = false,
  is_grace_booking = false,
  updated_at = now()
WHERE b.status IN ('active', 'pending_cancel')
  AND b.is_paused_for_subscription IS TRUE
  AND public.booking_is_permanent(b.id);

-- Rebuild missing future permanent occurrences. This respects vacations,
-- one-off exceptions, zero-capacity overrides and the 3-hour cutoff.
SELECT public.materialize_permanent_bookings(
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 1),
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 120)
);
