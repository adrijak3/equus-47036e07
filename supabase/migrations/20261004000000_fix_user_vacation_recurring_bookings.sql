-- Fix user Atostogos for permanent/recurring bookings.
-- Rules:
--   * adding a permanent slot starts materialization TOMORROW, never today
--   * creating Atostogos cancels already-materialized occurrences in the range
--   * every recurring occurrence inside Atostogos gets an exception
--   * materialization skips both exceptions and active vacations
--   * the permanent slot itself remains unchanged, so recurring lessons resume
--     after the vacation ends

CREATE OR REPLACE FUNCTION public.on_permanent_slot_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  tomorrow date := (now() AT TIME ZONE 'Europe/Vilnius')::date + 1;
BEGIN
  PERFORM public.materialize_permanent_bookings(
    tomorrow,
    tomorrow + 84
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_permanent_slot_insert ON public.permanent_slots;

CREATE TRIGGER trg_permanent_slot_insert
AFTER INSERT ON public.permanent_slots
FOR EACH ROW
EXECUTE FUNCTION public.on_permanent_slot_insert();


CREATE OR REPLACE FUNCTION public.add_vacation_and_cancel(
  _user_id uuid,
  _starts_on date,
  _ends_on date,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  caller uuid := auth.uid();
  vac_id uuid;
  cancelled_count integer := 0;
  exception_count integer := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'USER_REQUIRED';
  END IF;

  IF _ends_on < _starts_on THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  IF caller <> _user_id
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, _user_id)
  THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  INSERT INTO public.vacations (
    user_id,
    starts_on,
    ends_on,
    note
  )
  VALUES (
    _user_id,
    _starts_on,
    _ends_on,
    NULLIF(btrim(_note), '')
  )
  RETURNING id INTO vac_id;

  -- Block every recurring occurrence inside the vacation range.
  -- This is what prevents a later materializer run from recreating
  -- a cancelled recurring booking.
  INSERT INTO public.permanent_booking_exceptions (
    user_id,
    slot_date,
    slot_time
  )
  SELECT
    ps.user_id,
    d::date,
    ps.slot_time
  FROM public.permanent_slots ps
  CROSS JOIN LATERAL generate_series(
    _starts_on,
    _ends_on,
    interval '1 day'
  ) AS d
  WHERE ps.user_id = _user_id
    AND ps.day_of_week = EXTRACT(ISODOW FROM d)::integer
  ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;

  GET DIAGNOSTICS exception_count = ROW_COUNT;

  -- Cancel the actual bookings that have already been materialized
  -- for the user's recurring slots during the vacation.
  -- Only active/pending occurrences are affected; the permanent slot
  -- itself is NOT deleted.
  WITH cancelled AS (
    UPDATE public.bookings b
    SET
      status = 'cancelled',
      counts_in_subscription = false
    WHERE b.user_id = _user_id
      AND b.status IN ('active', 'pending_cancel')
      AND b.slot_date BETWEEN _starts_on AND _ends_on
      AND EXISTS (
        SELECT 1
        FROM public.permanent_slots ps
        WHERE ps.user_id = b.user_id
          AND ps.day_of_week = EXTRACT(ISODOW FROM b.slot_date)::integer
          AND ps.slot_time = b.slot_time
      )
    RETURNING b.id
  )
  SELECT count(*) INTO cancelled_count
  FROM cancelled;

  RETURN jsonb_build_object(
    'vacation_id', vac_id,
    'cancelled_bookings', cancelled_count,
    'recurring_exceptions', exception_count
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  inserted_count integer := 0;
  ps RECORD;
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
        -- Explicit one-off cancellation of this recurring occurrence.
        AND NOT EXISTS (
          SELECT 1
          FROM public.permanent_booking_exceptions pbe
          WHERE pbe.user_id = ps.user_id
            AND pbe.slot_date = d
            AND pbe.slot_time = ps.slot_time
        )
        -- User Atostogos block automatic materialization for the
        -- entire selected range.
        AND NOT EXISTS (
          SELECT 1
          FROM public.vacations v
          WHERE v.user_id = ps.user_id
            AND d BETWEEN v.starts_on AND v.ends_on
        )
        -- Existing active/pending occurrence already represents
        -- this recurring lesson.
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.user_id = ps.user_id
            AND b.slot_date = d
            AND b.slot_time = ps.slot_time
            AND b.status IN ('active', 'pending_cancel')
        )
        -- Do not create an occurrence that is already inside the
        -- normal three-hour public booking cutoff.
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

      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

REVOKE ALL
ON FUNCTION public.add_vacation_and_cancel(uuid, date, date, text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.add_vacation_and_cancel(uuid, date, date, text)
TO authenticated;

REVOKE ALL
ON FUNCTION public.materialize_permanent_bookings(date, date)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date, date)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date, date)
TO service_role;
