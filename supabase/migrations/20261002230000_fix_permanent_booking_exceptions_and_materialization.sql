-- Fix permanent-booking materialization and the stale cancelled rows that
-- currently prevent Nuolatiniai from appearing in Grafikas.
--
-- Root cause:
-- materialize_permanent_bookings() previously treated ANY existing booking
-- (including status='cancelled') as a blocker. When a permanent slot was
-- removed/re-added or an old recurring occurrence was cancelled, that stale
-- cancelled row prevented the new active occurrence from being materialized.
--
-- Correct model:
--   * active/pending bookings block materialization
--   * an explicit permanent_booking_exceptions row blocks materialization
--   * a cancelled booking by itself does NOT block materialization
--   * zero-capacity slot_overrides continue to suppress one occurrence
--
-- permanent_booking_exceptions is also kept in sync automatically when a
-- current permanent occurrence is cancelled/restored.

CREATE TABLE IF NOT EXISTS public.permanent_booking_exceptions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_date, slot_time)
);

ALTER TABLE public.permanent_booking_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permanent booking exceptions readable" ON public.permanent_booking_exceptions;
CREATE POLICY "Permanent booking exceptions readable"
ON public.permanent_booking_exceptions
FOR SELECT
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'trainer')
);

DROP POLICY IF EXISTS "Users manage own permanent booking exceptions" ON public.permanent_booking_exceptions;
CREATE POLICY "Users manage own permanent booking exceptions"
ON public.permanent_booking_exceptions
FOR ALL
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'admin')
);

-- Record a real cancellation of a currently active permanent occurrence.
-- Removing the permanent slot itself does NOT create an exception because
-- the permanent_slots row is deleted before its future bookings are cancelled.
CREATE OR REPLACE FUNCTION public.sync_permanent_booking_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  dow integer;
BEGIN
  dow := CASE
    WHEN EXTRACT(DOW FROM NEW.slot_date)::integer = 0 THEN 7
    ELSE EXTRACT(DOW FROM NEW.slot_date)::integer
  END;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF EXISTS (
      SELECT 1
      FROM public.permanent_slots ps
      WHERE ps.user_id = NEW.user_id
        AND ps.day_of_week = dow
        AND ps.slot_time = NEW.slot_time
    ) THEN
      INSERT INTO public.permanent_booking_exceptions (
        user_id,
        slot_date,
        slot_time
      )
      VALUES (
        NEW.user_id,
        NEW.slot_date,
        NEW.slot_time
      )
      ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;
    END IF;
  ELSIF OLD.status = 'cancelled'
        AND NEW.status IN ('active', 'pending_cancel') THEN
    DELETE FROM public.permanent_booking_exceptions
    WHERE user_id = NEW.user_id
      AND slot_date = NEW.slot_date
      AND slot_time = NEW.slot_time;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_permanent_booking_exception ON public.bookings;
CREATE TRIGGER trg_sync_permanent_booking_exception
AFTER UPDATE OF status ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_permanent_booking_exception();

-- If a permanent weekly slot is removed, forget its one-off exceptions.
-- Re-adding the permanent slot later should start a fresh recurring schedule.
CREATE OR REPLACE FUNCTION public.cleanup_permanent_booking_exceptions_on_slot_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.permanent_booking_exceptions
  WHERE user_id = OLD.user_id
    AND slot_time = OLD.slot_time
    AND (
      CASE
        WHEN EXTRACT(DOW FROM slot_date)::integer = 0 THEN 7
        ELSE EXTRACT(DOW FROM slot_date)::integer
      END
    ) = OLD.day_of_week;

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cleanup_permanent_booking_exceptions_on_slot_delete
ON public.permanent_slots;

CREATE TRIGGER trg_cleanup_permanent_booking_exceptions_on_slot_delete
AFTER DELETE ON public.permanent_slots
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_permanent_booking_exceptions_on_slot_delete();

-- Preserve explicit cancellations already recorded in the cancellation systems.
-- Stale cancelled bookings with no cancellation record remain eligible for
-- re-materialization.
INSERT INTO public.permanent_booking_exceptions (
  user_id,
  slot_date,
  slot_time
)
SELECT DISTINCT
  b.user_id,
  b.slot_date,
  b.slot_time
FROM public.bookings b
JOIN public.permanent_slots ps
  ON ps.user_id = b.user_id
 AND ps.slot_time = b.slot_time
 AND ps.day_of_week = CASE
   WHEN EXTRACT(DOW FROM b.slot_date)::integer = 0 THEN 7
   ELSE EXTRACT(DOW FROM b.slot_date)::integer
 END
WHERE b.status = 'cancelled'
  AND (
    EXISTS (
      SELECT 1
      FROM public.booking_cancellations bc
      WHERE bc.booking_id = b.id
        AND bc.restored_at IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM public.cancellation_requests cr
      WHERE cr.booking_id = b.id
        AND cr.status IN ('pending', 'approved')
    )
  )
ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;

-- Rebuild the materializer with the correct semantics.
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
  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;

    WHILE d <= _end LOOP
      IF (
        CASE
          WHEN EXTRACT(DOW FROM d)::integer = 0 THEN 7
          ELSE EXTRACT(DOW FROM d)::integer
        END
      ) = ps.day_of_week
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
        FROM public.bookings b
        WHERE b.user_id = ps.user_id
          AND b.slot_date = d
          AND b.slot_time = ps.slot_time
          AND b.status IN ('active', 'pending_cancel')
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
ON FUNCTION public.materialize_permanent_bookings(date, date)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date, date)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.materialize_permanent_bookings(date, date)
TO service_role;

-- Repair currently missing future occurrences.
SELECT public.materialize_permanent_bookings(
  (now() AT TIME ZONE 'Europe/Vilnius')::date,
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 120)
);
