-- Automatically clean up accidental duplicate subscription bookings for the same rider/day.
--
-- Rule:
-- * Only consider days where the rider has at least one booking linked to a subscription
--   and marked to count toward that subscription.
-- * If exactly one of that day's active/pending bookings has a horse assignment,
--   keep the horse-assigned booking and remove the other duplicate booking(s).
-- * If the horse-assigned booking is the one without the subscription, move the
--   subscription link/counting fields to the horse booking before deleting the duplicate.
-- * If there is no horse assignment, or more than one horse-assigned booking,
--   leave the data alone because the bookings may be intentional.
-- * Completed historical bookings are never deleted.

CREATE OR REPLACE FUNCTION public.dedupe_subscription_day_bookings(
  _user_id uuid,
  _slot_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keeper_id uuid;
  keeper_has_subscription boolean;
  keeper_subscription_id uuid;
  keeper_counts boolean;
  keeper_extra_fee numeric;
  keeper_extra_paid boolean;
  booking_count integer;
  subscription_booking_count integer;
  horse_booking_count integer;
  removed_count integer := 0;
  affected_subscriptions uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT count(*)
    INTO booking_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = _slot_date
    AND b.status IN ('active', 'pending_cancel');

  IF booking_count <= 1 THEN
    RETURN 0;
  END IF;

  SELECT count(*)
    INTO subscription_booking_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = _slot_date
    AND b.status IN ('active', 'pending_cancel')
    AND b.subscription_id IS NOT NULL
    AND b.counts_in_subscription = true;

  IF subscription_booking_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*)
    INTO horse_booking_count
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = _slot_date
    AND b.status IN ('active', 'pending_cancel')
    AND EXISTS (
      SELECT 1
      FROM public.horse_assignments ha
      WHERE ha.booking_id = b.id
    );

  -- Only auto-resolve the unambiguous "one horse + one/no-horse duplicate" case.
  IF horse_booking_count <> 1 THEN
    RETURN 0;
  END IF;

  SELECT
    b.id,
    b.subscription_id IS NOT NULL,
    b.subscription_id,
    b.counts_in_subscription,
    b.extra_fee_eur,
    b.extra_fee_paid
  INTO
    keeper_id,
    keeper_has_subscription,
    keeper_subscription_id,
    keeper_counts,
    keeper_extra_fee,
    keeper_extra_paid
  FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = _slot_date
    AND b.status IN ('active', 'pending_cancel')
    AND EXISTS (
      SELECT 1
      FROM public.horse_assignments ha
      WHERE ha.booking_id = b.id
    )
  LIMIT 1;

  -- If the horse booking is not the subscription-linked row, move the
  -- subscription linkage to the horse booking before removing the duplicate.
  IF NOT keeper_has_subscription THEN
    SELECT
      b.subscription_id,
      b.counts_in_subscription,
      b.extra_fee_eur,
      b.extra_fee_paid
    INTO
      keeper_subscription_id,
      keeper_counts,
      keeper_extra_fee,
      keeper_extra_paid
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.status IN ('active', 'pending_cancel')
      AND b.id <> keeper_id
      AND b.subscription_id IS NOT NULL
      AND b.counts_in_subscription = true
    ORDER BY b.created_at ASC
    LIMIT 1;

    IF keeper_subscription_id IS NULL THEN
      RETURN 0;
    END IF;

    UPDATE public.bookings
    SET
      subscription_id = keeper_subscription_id,
      counts_in_subscription = true,
      extra_fee_eur = COALESCE(keeper_extra_fee, 0),
      extra_fee_paid = COALESCE(keeper_extra_paid, false)
    WHERE id = keeper_id;
  END IF;

  -- Remember affected subscription ids before deleting duplicate rows.
  SELECT ARRAY(
    SELECT DISTINCT b.subscription_id
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.slot_date = _slot_date
      AND b.status IN ('active', 'pending_cancel')
      AND b.subscription_id IS NOT NULL
  )
  INTO affected_subscriptions;

  -- Delete all other active/pending bookings for this rider on this date.
  DELETE FROM public.bookings b
  WHERE b.user_id = _user_id
    AND b.slot_date = _slot_date
    AND b.status IN ('active', 'pending_cancel')
    AND b.id <> keeper_id;

  GET DIAGNOSTICS removed_count = ROW_COUNT;

  -- Keep the subscription's stored counter aligned with the surviving bookings.
  IF affected_subscriptions IS NOT NULL THEN
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
    WHERE s.id = ANY(affected_subscriptions);
  END IF;

  RETURN removed_count;
END;
$$;


-- Clean up existing accidental duplicates once, using the same safe rule.
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


-- Trigger wrappers.
CREATE OR REPLACE FUNCTION public.trg_dedupe_subscription_day_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trigger$
BEGIN
  PERFORM public.dedupe_subscription_day_bookings(NEW.user_id, NEW.slot_date);
  RETURN NEW;
END;
$trigger$;

CREATE OR REPLACE FUNCTION public.trg_dedupe_subscription_after_horse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trigger$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    PERFORM public.dedupe_subscription_day_bookings(NEW.user_id, NEW.slot_date);
  END IF;
  RETURN NEW;
END;
$trigger$;


-- Future booking creation/changes.
DROP TRIGGER IF EXISTS trg_dedupe_subscription_day_booking
  ON public.bookings;

CREATE TRIGGER trg_dedupe_subscription_day_booking
AFTER INSERT OR UPDATE OF user_id, slot_date, status, subscription_id, counts_in_subscription
ON public.bookings
FOR EACH ROW
WHEN (NEW.status IN ('active', 'pending_cancel'))
EXECUTE FUNCTION public.trg_dedupe_subscription_day_booking();


-- A horse is often assigned after the booking is created, so run the same
-- cleanup when staff assigns a horse.
DROP TRIGGER IF EXISTS trg_dedupe_subscription_after_horse
  ON public.horse_assignments;

CREATE TRIGGER trg_dedupe_subscription_after_horse
AFTER INSERT OR UPDATE OF booking_id, horse_id
ON public.horse_assignments
FOR EACH ROW
WHEN (NEW.booking_id IS NOT NULL)
EXECUTE FUNCTION public.trg_dedupe_subscription_after_horse();
