-- =========================================================
-- FIX 1: capacity check must match the correct weekday row
-- =========================================================
CREATE OR REPLACE FUNCTION public.enforce_booking_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cap    int;
  taken  int;
  caller uuid := auth.uid();
  dow    int  := CASE WHEN EXTRACT(DOW FROM NEW.slot_date)::int = 0
                      THEN 7 ELSE EXTRACT(DOW FROM NEW.slot_date)::int END;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- Admin / trainer can always overbook
  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  -- Per-date override wins
  SELECT o.max_capacity INTO cap
    FROM public.slot_overrides o
   WHERE o.slot_date = NEW.slot_date AND o.slot_time = NEW.slot_time
   LIMIT 1;

  -- Fall back to the weekly template, matched by BOTH day_of_week AND slot_time
  IF cap IS NULL THEN
    SELECT ts.max_capacity INTO cap
      FROM public.time_slots ts
     WHERE ts.slot_time = NEW.slot_time
       AND ts.day_of_week = dow
       AND ts.active = true
     ORDER BY ts.max_capacity DESC
     LIMIT 1;
  END IF;

  IF cap IS NULL THEN cap := 5; END IF;

  SELECT count(*) INTO taken
    FROM public.bookings b
   WHERE b.slot_date = NEW.slot_date
     AND b.slot_time = NEW.slot_time
     AND b.status = 'active'
     AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

  IF taken >= cap THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================
-- FIX 2: restore recurring-booking generation for future weeks
-- (keep the cancellation logic — we still skip any date where
--  ANY booking already exists for that user/slot, cancelled or not)
-- =========================================================

-- Remove the broken arg-less overload from 20260705000000 that
-- referenced a non-existent bookings.source column and inserted
-- every calendar day instead of matching day_of_week.
DROP FUNCTION IF EXISTS public.materialize_permanent_bookings();

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(_start date, _end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
  ps RECORD;
  d  date;
  exists_booking boolean;
BEGIN
  FOR ps IN SELECT user_id, day_of_week, slot_time FROM public.permanent_slots LOOP
    d := _start;
    WHILE d <= _end LOOP
      IF (CASE WHEN EXTRACT(DOW FROM d)::int = 0 THEN 7
               ELSE EXTRACT(DOW FROM d)::int END) = ps.day_of_week THEN

        SELECT EXISTS (
          SELECT 1 FROM public.bookings
           WHERE user_id  = ps.user_id
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

REVOKE ALL ON FUNCTION public.materialize_permanent_bookings(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO authenticated, service_role;

-- Extend the "materialize on insert" horizon to 16 weeks so freshly-added
-- recurring slots show up well past what the client normally prefetches.
CREATE OR REPLACE FUNCTION public.on_permanent_slot_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  PERFORM public.materialize_permanent_bookings(
    vilnius_today,
    (vilnius_today + INTERVAL '16 weeks')::date
  );
  RETURN NEW;
END;
$function$;

-- Make absolutely sure the trigger is attached (previous migrations
-- have dropped and re-added it; re-assert here).
DROP TRIGGER IF EXISTS trg_permanent_slot_insert ON public.permanent_slots;
CREATE TRIGGER trg_permanent_slot_insert
AFTER INSERT ON public.permanent_slots
FOR EACH ROW EXECUTE FUNCTION public.on_permanent_slot_insert();

-- Backfill for any recurring slots added while the arg-less overload
-- was breaking the trigger.
SELECT public.materialize_permanent_bookings(
  (now() AT TIME ZONE 'Europe/Vilnius')::date,
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + INTERVAL '16 weeks')::date
);

-- =========================================================
-- FIX 3: "Cancel a whole day" (one-off) — new table
-- =========================================================
CREATE TABLE IF NOT EXISTS public.day_cancellations (
  note_date  date PRIMARY KEY,
  note       text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.day_cancellations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.day_cancellations TO authenticated;
GRANT ALL ON public.day_cancellations TO service_role;

ALTER TABLE public.day_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "day_cancellations readable"        ON public.day_cancellations;
DROP POLICY IF EXISTS "day_cancellations admins manage"   ON public.day_cancellations;

CREATE POLICY "day_cancellations readable"
  ON public.day_cancellations FOR SELECT USING (true);

CREATE POLICY "day_cancellations admins manage"
  ON public.day_cancellations FOR ALL TO authenticated
  USING      (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

-- When an admin cancels a whole day, cancel every active booking on it.
CREATE OR REPLACE FUNCTION public.on_day_cancellation_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.bookings
     SET status = 'cancelled', counts_in_subscription = false
   WHERE slot_date = NEW.note_date AND status = 'active';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_day_cancellation_insert ON public.day_cancellations;
CREATE TRIGGER trg_day_cancellation_insert
AFTER INSERT ON public.day_cancellations
FOR EACH ROW EXECUTE FUNCTION public.on_day_cancellation_insert();
