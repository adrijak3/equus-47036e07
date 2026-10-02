-- Fix recurring Grafikas changes so Nuolatiniai and future bookings stay in sync.
--
-- Root cause:
--   admin_apply_recurring_time_change() previously moved bookings by
--   trainer_name, while materialize_permanent_bookings() creates permanent
--   bookings without trainer_name. That could leave some permanent riders
--   behind when a recurring Grafikas time was changed.
--
-- This version identifies the affected bookings by the actual permanent_slots
-- membership (user + weekday + old time), then re-materializes the future range
-- so missing occurrences are restored without duplicating existing bookings.

CREATE OR REPLACE FUNCTION public.admin_apply_recurring_time_change(
  _slot_id uuid,
  _new_time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  caller uuid := auth.uid();
  slot_row public.time_slots%ROWTYPE;
  old_time time;
  moved_count integer := 0;
  materialized_count integer := 0;
  affected_users integer := 0;
BEGIN
  IF caller IS NULL OR NOT public.has_role(caller, 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT *
  INTO slot_row
  FROM public.time_slots
  WHERE id = _slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  IF slot_row.one_off_date IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_RECURRING_SLOT';
  END IF;

  old_time := slot_row.slot_time;

  IF old_time = _new_time THEN
    RETURN jsonb_build_object(
      'ok', true,
      'bookings_moved', 0,
      'bookings_materialized', 0
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.time_slots x
    WHERE x.id <> slot_row.id
      AND x.active
      AND x.one_off_date IS NULL
      AND x.day_of_week = slot_row.day_of_week
      AND x.slot_time = _new_time
      AND x.trainer_name IS NOT DISTINCT FROM slot_row.trainer_name
  ) THEN
    RAISE EXCEPTION 'TARGET_TIME_EXISTS';
  END IF;

  -- A target-time conflict is relevant when an affected permanent rider
  -- already has a booking at the target time, or when moving the recurring
  -- riders would exceed the target slot capacity.
  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.permanent_slots ps
      ON ps.user_id = b.user_id
     AND ps.day_of_week = slot_row.day_of_week
     AND ps.slot_time = old_time
    WHERE b.slot_time = old_time
      AND b.status IN ('active', 'pending_cancel')
      AND (
        CASE
          WHEN EXTRACT(DOW FROM b.slot_date)::int = 0 THEN 7
          ELSE EXTRACT(DOW FROM b.slot_date)::int
        END
      ) = slot_row.day_of_week
      AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND EXISTS (
        SELECT 1
        FROM public.bookings c
        WHERE c.user_id = b.user_id
          AND c.id <> b.id
          AND c.slot_date = b.slot_date
          AND c.slot_time = _new_time
          AND c.status IN ('active', 'pending_cancel')
      )
  ) THEN
    RAISE EXCEPTION 'RECURRING_MOVE_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT b.slot_date
      FROM public.bookings b
      JOIN public.permanent_slots ps
        ON ps.user_id = b.user_id
       AND ps.day_of_week = slot_row.day_of_week
       AND ps.slot_time = old_time
      WHERE b.slot_time = old_time
        AND b.status IN ('active', 'pending_cancel')
        AND (
          CASE
            WHEN EXTRACT(DOW FROM b.slot_date)::int = 0 THEN 7
            ELSE EXTRACT(DOW FROM b.slot_date)::int
          END
        ) = slot_row.day_of_week
        AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      GROUP BY b.slot_date
    ) affected_dates
    WHERE (
      SELECT count(*)
      FROM public.bookings target
      WHERE target.slot_date = affected_dates.slot_date
        AND target.slot_time = _new_time
        AND target.status IN ('active', 'pending_cancel')
        AND NOT EXISTS (
          SELECT 1
          FROM public.permanent_slots ps2
          WHERE ps2.user_id = target.user_id
            AND ps2.day_of_week = slot_row.day_of_week
            AND ps2.slot_time = old_time
        )
    ) + (
      SELECT count(*)
      FROM public.bookings source
      JOIN public.permanent_slots ps3
        ON ps3.user_id = source.user_id
       AND ps3.day_of_week = slot_row.day_of_week
       AND ps3.slot_time = old_time
      WHERE source.slot_date = affected_dates.slot_date
        AND source.slot_time = old_time
        AND source.status IN ('active', 'pending_cancel')
    ) > COALESCE(
      (
        SELECT so.max_capacity
        FROM public.slot_overrides so
        WHERE so.slot_date = affected_dates.slot_date
          AND so.slot_time = _new_time
        LIMIT 1
      ),
      slot_row.max_capacity
    )
  ) THEN
    RAISE EXCEPTION 'RECURRING_MOVE_CONFLICT';
  END IF;

  -- Count affected permanent riders before changing permanent_slots.
  SELECT count(*)
  INTO affected_users
  FROM public.permanent_slots
  WHERE day_of_week = slot_row.day_of_week
    AND slot_time = old_time;

  UPDATE public.time_slots
  SET slot_time = _new_time
  WHERE id = slot_row.id;

  UPDATE public.permanent_slots
  SET slot_time = _new_time
  WHERE day_of_week = slot_row.day_of_week
    AND slot_time = old_time;

  -- Move only bookings belonging to riders who actually have this permanent
  -- slot. Do not rely on trainer_name because permanent materialized bookings
  -- intentionally do not populate that column.
  WITH moved AS (
    UPDATE public.bookings b
    SET
      slot_time = _new_time,
      updated_at = now()
    WHERE b.slot_time = old_time
      AND b.status IN ('active', 'pending_cancel')
      AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND (
        CASE
          WHEN EXTRACT(DOW FROM b.slot_date)::int = 0 THEN 7
          ELSE EXTRACT(DOW FROM b.slot_date)::int
        END
      ) = slot_row.day_of_week
      AND EXISTS (
        SELECT 1
        FROM public.permanent_slots ps
        WHERE ps.user_id = b.user_id
          AND ps.day_of_week = slot_row.day_of_week
          AND ps.slot_time = _new_time
      )
    RETURNING b.id
  )
  SELECT count(*)
  INTO moved_count
  FROM moved;

  -- Rebuild any missing future occurrences. This is idempotent because the
  -- materializer checks for an existing booking before inserting.
  materialized_count := public.materialize_permanent_bookings(
    (now() AT TIME ZONE 'Europe/Vilnius')::date,
    ((now() AT TIME ZONE 'Europe/Vilnius')::date + 120)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bookings_moved', moved_count,
    'bookings_materialized', materialized_count,
    'permanent_riders_affected', affected_users,
    'old_time', old_time,
    'new_time', _new_time
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.admin_apply_recurring_time_change(uuid, time)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_apply_recurring_time_change(uuid, time)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_apply_recurring_time_change(uuid, time)
TO service_role;

-- One-time safe repair for currently missing future Nuolatiniai occurrences.
-- materialize_permanent_bookings() is idempotent and respects zero-capacity
-- slot overrides, so existing bookings are not duplicated.
SELECT public.materialize_permanent_bookings(
  (now() AT TIME ZONE 'Europe/Vilnius')::date,
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 120)
);
