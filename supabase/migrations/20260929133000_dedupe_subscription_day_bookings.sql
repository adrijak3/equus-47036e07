-- Automatically resolve the specific accidental duplicate pattern:
--   same rider + same date + same lesson purpose/type
--   + times within 15 minutes
--   + one subscription-linked booking without a horse
--   + one separate horse-assigned booking without the subscription.
--
-- It deliberately does NOT delete every other booking on the rider's date.
-- Legitimate multiple lessons remain untouched.

CREATE OR REPLACE FUNCTION public.dedupe_subscription_day_bookings(
  _user_id uuid,
  _slot_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subscription_id uuid;
  v_v_subscription_booking_id uuid;
  v_v_horse_booking_id uuid;
  v_subscription_counts boolean;
  v_v_subscription_extra_fee numeric;
  v_v_subscription_extra_paid boolean;
  candidate_count integer;
  removed_count integer := 0;
BEGIN
  IF _user_id IS NULL OR _slot_date IS NULL THEN
    RETURN 0;
  END IF;

  -- Never recurse through the booking/horse triggers that this function itself
  -- can fire while moving the subscription onto the surviving booking.
  IF pg_trigger_depth() > 1 THEN
    RETURN 0;
  END IF;

  -- Find each subscription-linked booking that does not already have a horse.
  -- Only a single matching horse booking within 15 minutes is considered safe.
  FOR v_v_subscription_booking_id, v_subscription_id, v_subscription_counts,
      v_v_subscription_extra_fee, v_v_subscription_extra_paid IN
    SELECT
      b.id,
      b.subscription_id,
      b.counts_in_subscription,
      b.extra_fee_eur,
      b.extra_fee_paid
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.status IN ('active', 'pending_cancel')
      AND b.subscription_id IS NOT NULL
      AND b.counts_in_subscription = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.horse_assignments ha
        WHERE ha.booking_id = b.id
      )
      AND EXISTS (
        SELECT 1
        FROM public.bookings h
        WHERE h.user_id = b.user_id
          AND h.slot_date = b.slot_date
          AND h.status IN ('active', 'pending_cancel')
          AND h.id <> b.id
          AND EXISTS (
            SELECT 1
            FROM public.horse_assignments ha2
            WHERE ha2.booking_id = h.id
          )
          AND abs(extract(epoch FROM (h.slot_time - b.slot_time))) <= 900
          AND COALESCE(h.lesson_kind::text,
            CASE WHEN h.is_individual THEN 'individual' ELSE 'group' END
          ) = COALESCE(b.lesson_kind::text,
            CASE WHEN b.is_individual THEN 'individual' ELSE 'group' END
          )
      )
  LOOP
    SELECT count(*), min(h.id)
      INTO candidate_count, v_horse_booking_id
    FROM public.bookings h
    WHERE h.user_id = _user_id
      AND h.slot_date = _slot_date
      AND h.status IN ('active', 'pending_cancel')
      AND h.id <> v_subscription_booking_id
      AND EXISTS (
        SELECT 1
        FROM public.horse_assignments ha
        WHERE ha.booking_id = h.id
      )
      AND abs(extract(epoch FROM (h.slot_time - (
        SELECT b.slot_time
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      )))) <= 900
      AND COALESCE(h.lesson_kind::text,
        CASE WHEN h.is_individual THEN 'individual' ELSE 'group' END
      ) = (
        SELECT COALESCE(b.lesson_kind::text,
          CASE WHEN b.is_individual THEN 'individual' ELSE 'group' END
        )
        FROM public.bookings b
        WHERE b.id = v_subscription_booking_id
      );

    IF candidate_count <> 1 OR v_horse_booking_id IS NULL THEN
      CONTINUE;
    END IF;

    -- The horse booking is the survivor. Move the subscription attribution
    -- before deleting the duplicate row.
    UPDATE public.bookings
    SET
      subscription_id = v_subscription_id,
      counts_in_subscription = true,
      extra_fee_eur = COALESCE(v_subscription_extra_fee, 0),
      extra_fee_paid = COALESCE(v_subscription_extra_paid, false)
    WHERE id = v_horse_booking_id
      AND subscription_id IS NULL;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.bookings
    WHERE id = v_subscription_booking_id;

    removed_count := removed_count + 1;

    -- Keep the package counter aligned with the surviving booking.
    UPDATE public.subscriptions s
    SET lessons_used = LEAST(
      s.lessons_total,
      (
        SELECT count(*)::smallint
        FROM public.bookings b
        WHERE b.subscription_id = s.id
          AND b.counts_in_subscription = true
          AND b.status <> 'cancelled'
      )
    )
    WHERE s.id = v_subscription_id;
  END LOOP;

  RETURN removed_count;
END;
$$;


-- Clean up existing accidental duplicates using the same narrow rule.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT b.user_id, b.slot_date
    FROM public.bookings b
    WHERE b.subscription_id IS NOT NULL
      AND b.counts_in_subscription = true
      AND b.status IN ('active', 'pending_cancel')
  LOOP
    PERFORM public.dedupe_subscription_day_bookings(r.user_id, r.slot_date);
  END LOOP;
END;
$$;


CREATE OR REPLACE FUNCTION public.trg_dedupe_subscription_day_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trigger$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  PERFORM public.dedupe_subscription_day_bookings(NEW.user_id, NEW.slot_date);
  RETURN NEW;
END;
$trigger$;

CREATE OR REPLACE FUNCTION public.trg_dedupe_subscription_after_horse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trigger$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NOT NULL THEN
    PERFORM public.dedupe_subscription_day_bookings(NEW.user_id, NEW.slot_date);
  END IF;
  RETURN NEW;
END;
$trigger$;


DROP TRIGGER IF EXISTS trg_dedupe_subscription_day_booking
  ON public.bookings;

CREATE TRIGGER trg_dedupe_subscription_day_booking
AFTER INSERT OR UPDATE OF user_id, slot_date, status, subscription_id, counts_in_subscription
ON public.bookings
FOR EACH ROW
WHEN (NEW.status IN ('active', 'pending_cancel'))
EXECUTE FUNCTION public.trg_dedupe_subscription_day_booking();


DROP TRIGGER IF EXISTS trg_dedupe_subscription_after_horse
  ON public.horse_assignments;

CREATE TRIGGER trg_dedupe_subscription_after_horse
AFTER INSERT OR UPDATE OF booking_id, horse_id
ON public.horse_assignments
FOR EACH ROW
WHEN (NEW.booking_id IS NOT NULL)
EXECUTE FUNCTION public.trg_dedupe_subscription_after_horse();
