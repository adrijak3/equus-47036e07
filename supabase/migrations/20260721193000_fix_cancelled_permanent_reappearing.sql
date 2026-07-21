-- Fix cancelled permanent lessons reappearing after schedule reload.
-- A cancelled booking is a tombstone for that exact user/date/time and must never be re-created.

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(_start date, _end date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
BEGIN
  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;
    WHILE d <= _end LOOP
      IF extract(isodow from d)::int = ps.day_of_week THEN
        -- IMPORTANT: check every status, including cancelled.
        -- A cancelled row prevents this one occurrence from being recreated.
        IF NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.user_id = ps.user_id
            AND b.slot_date = d
            AND b.slot_time = ps.slot_time
        ) THEN
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

-- Cancel exactly one occurrence and verify that the caller is allowed to do it.
CREATE OR REPLACE FUNCTION public.cancel_booking_occurrence(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  target public.bookings%rowtype;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO target
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Rezervacija nerasta.');
  END IF;

  IF target.user_id <> caller
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, target.user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF target.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  UPDATE public.bookings
  SET status = 'cancelled'
  WHERE id = _booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', target.id,
    'slot_date', target.slot_date,
    'slot_time', target.slot_time
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_booking_occurrence(uuid) TO authenticated;

-- Repair rows that may already have been recreated by the old materializer.
-- When a cancelled occurrence exists, any active duplicate for the same user/date/time is cancelled too.
WITH cancelled_keys AS (
  SELECT DISTINCT user_id, slot_date, slot_time
  FROM public.bookings
  WHERE status = 'cancelled'
)
UPDATE public.bookings b
SET status = 'cancelled'
FROM cancelled_keys c
WHERE b.user_id = c.user_id
  AND b.slot_date = c.slot_date
  AND b.slot_time = c.slot_time
  AND b.status = 'active';
