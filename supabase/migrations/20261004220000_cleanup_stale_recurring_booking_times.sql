-- Clean stale recurring booking times left behind by earlier recurring schedule changes.
--
-- Root cause:
--   Once permanent_slots had already been updated to the new time, later
--   materialization could create the new booking while the old booking no
--   longer matched permanent_slots and therefore could not be moved/removed
--   by the previous repair logic.
--
-- This migration:
--   1. makes the internal waitlist trigger safe during this cleanup,
--   2. teaches admin_apply_recurring_time_change() to remove stale old-time
--      recurring copies when the new-time copy already exists, and
--   3. performs a one-time cleanup of the same production data pattern.

CREATE OR REPLACE FUNCTION public.promote_from_waiting_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slot_date_value date;
  slot_time_value time;
  capacity integer;
  active_count integer;
  next_id uuid;
  next_user uuid;
  promoted_id uuid;
BEGIN
  -- Internal recurring-time cleanup may intentionally free a stale booking
  -- without opening the obsolete slot to waiting-list promotion.
  IF current_setting('equus.skip_waitlist_promotion', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    slot_date_value := OLD.slot_date;
    slot_time_value := OLD.slot_time;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    slot_date_value := OLD.slot_date;
    slot_time_value := OLD.slot_time;
  ELSE
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(slot_date_value::text || '|' || slot_time_value::text)
  );

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = slot_date_value
        AND so.slot_time = slot_time_value
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.slot_time = slot_time_value
        AND ts.active = true
        AND (ts.one_off_date = slot_date_value OR ts.one_off_date IS NULL)
      ORDER BY (ts.one_off_date IS NULL), ts.one_off_date DESC
      LIMIT 1
    ),
    1
  ) INTO capacity;

  SELECT count(*) INTO active_count
  FROM public.bookings b
  WHERE b.slot_date = slot_date_value
    AND b.slot_time = slot_time_value
    AND b.status IN ('active', 'pending_cancel');

  WHILE active_count < capacity LOOP
    next_id := NULL;
    next_user := NULL;

    SELECT wl.id, wl.user_id
      INTO next_id, next_user
    FROM public.waiting_list wl
    WHERE wl.slot_date = slot_date_value
      AND wl.slot_time = slot_time_value
    ORDER BY wl.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    EXIT WHEN next_id IS NULL;

    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.user_id = next_user
        AND b.slot_date = slot_date_value
        AND b.slot_time = slot_time_value
        AND b.status IN ('active', 'pending_cancel')
    ) THEN
      DELETE FROM public.waiting_list WHERE id = next_id;
      CONTINUE;
    END IF;

    promoted_id := NULL;

    INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
    VALUES (next_user, slot_date_value, slot_time_value, 'active')
    ON CONFLICT DO NOTHING
    RETURNING id INTO promoted_id;

    IF promoted_id IS NOT NULL THEN
      DELETE FROM public.waiting_list WHERE id = next_id;

      PERFORM public.queue_equus_notification(
        next_user,
        'WAITLIST_PROMOTED',
        'Atsirado vieta treniruotei 🐴',
        'A training place opened 🐴',
        format('Jūs automatiškai perkelti iš laukiančiųjų sąrašo į %s %s.', to_char(slot_date_value, 'DD.MM'), to_char(slot_time_value, 'HH24:MI')),
        format('You were automatically moved from the waiting list into the %s %s training.', to_char(slot_date_value, 'DD.MM'), to_char(slot_time_value, 'HH24:MI')),
        '/grafikas',
        format('waitlist-promoted:%s:%s:%s', next_user, slot_date_value, slot_time_value)
      );

      active_count := active_count + 1;
    ELSE
      DELETE FROM public.waiting_list WHERE id = next_id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

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

  -- A previous recurring-time change can leave a stale active booking at the
  -- old time after permanent_slots has already been updated. If the same
  -- rider already has the current recurring booking at the target time,
  -- remove only the stale recurring copy.
  SELECT set_config('equus.skip_waitlist_promotion', 'true', true);

  WITH stale AS (
    SELECT stale_booking.id
    FROM public.bookings stale_booking
    JOIN public.permanent_slots ps
      ON ps.user_id = stale_booking.user_id
     AND ps.day_of_week = slot_row.day_of_week
     AND ps.slot_time = old_time
    JOIN public.bookings current_booking
      ON current_booking.user_id = stale_booking.user_id
     AND current_booking.slot_date = stale_booking.slot_date
     AND current_booking.slot_time = _new_time
     AND current_booking.status IN ('active', 'pending_cancel')
     AND current_booking.trainer_name IS NULL
     AND COALESCE(current_booking.is_individual, false) = false
    WHERE stale_booking.slot_time = old_time
      AND stale_booking.status IN ('active', 'pending_cancel')
      AND stale_booking.trainer_name IS NULL
      AND COALESCE(stale_booking.is_individual, false) = false
      AND stale_booking.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND (
        CASE
          WHEN EXTRACT(DOW FROM stale_booking.slot_date)::int = 0 THEN 7
          ELSE EXTRACT(DOW FROM stale_booking.slot_date)::int
        END
      ) = slot_row.day_of_week
      AND current_booking.created_at >= stale_booking.created_at
  )
  UPDATE public.bookings b
  SET
    status = 'cancelled',
    counts_in_subscription = false,
    updated_at = now()
  WHERE b.id IN (SELECT id FROM stale);

  PERFORM set_config('equus.skip_waitlist_promotion', 'false', true);

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


-- One-time repair for existing future stale recurring reservations.
-- Only rows that are active/pending at a non-current time, belong to a rider
-- with a current permanent slot on that weekday, have a matching current-time
-- recurring booking, and look like materialized recurring rows are touched.
SELECT set_config('equus.skip_waitlist_promotion', 'true', true);

WITH stale AS (
  SELECT stale_booking.id
  FROM public.bookings stale_booking
  JOIN public.permanent_slots ps
    ON ps.user_id = stale_booking.user_id
   AND ps.day_of_week = CASE
     WHEN EXTRACT(DOW FROM stale_booking.slot_date)::integer = 0 THEN 7
     ELSE EXTRACT(DOW FROM stale_booking.slot_date)::integer
   END
   AND ps.slot_time <> stale_booking.slot_time
  JOIN public.bookings current_booking
    ON current_booking.user_id = stale_booking.user_id
   AND current_booking.slot_date = stale_booking.slot_date
   AND current_booking.slot_time = ps.slot_time
   AND current_booking.status IN ('active', 'pending_cancel')
   AND current_booking.trainer_name IS NULL
   AND COALESCE(current_booking.is_individual, false) = false
  WHERE stale_booking.status IN ('active', 'pending_cancel')
    AND stale_booking.trainer_name IS NULL
    AND COALESCE(stale_booking.is_individual, false) = false
    AND stale_booking.slot_date >= ((now() AT TIME ZONE 'Europe/Vilnius')::date + 1)
    AND current_booking.created_at >= stale_booking.created_at
)
UPDATE public.bookings b
SET
  status = 'cancelled',
  counts_in_subscription = false,
  updated_at = now()
WHERE b.id IN (SELECT id FROM stale);

SELECT set_config('equus.skip_waitlist_promotion', 'false', true);

