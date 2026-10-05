-- Equus: harden permanent recurring bookings after the stale-recurring cleanup.
--
-- The 20261004220000 migration was a one-time data cleanup. It correctly
-- identified stale old-time recurring copies, but its UPDATE changed those
-- bookings to cancelled, which polluted the permanent-booking cancellation
-- history with "system" entries.
--
-- Do NOT edit that already-applied migration. This follow-up:
--   1) re-materializes the canonical future permanent occurrences safely;
--   2) marks only stale-cleanup cancellations that already have a current
--      permanent occurrence as accidental/restored in the audit log;
--   3) leaves the original cancelled booking rows untouched;
--   4) makes no subscription-driven cancellations.
--
-- A cancelled historical row is never rewritten into an active booking.
-- The active occurrence is represented by a new canonical booking at the
-- current permanent slot time.

-- 1. Rebuild missing future permanent occurrences using the current,
-- subscription-aware materializer. It is idempotent and respects:
-- permanent_booking_exceptions, vacations, zero-capacity overrides, the
-- three-hour cutoff, and current slot capacity semantics.
SELECT public.materialize_permanent_bookings(
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 1),
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + 120)
);

-- 2. The stale-recurring cleanup is identifiable without relying on its
-- migration timestamp:
--   * the booking is cancelled;
--   * its cancellation was recorded as system;
--   * the rider still has a permanent slot on the same weekday, but at a
--     different (current) time;
--   * a current active/pending booking exists for that same rider/date at
--     that current permanent time.
--
-- That last condition is important: we only mark the audit row restored when
-- the occurrence is demonstrably present. We do not guess which historical
-- cancellations were legitimate.
UPDATE public.booking_cancellations bc
SET
  accidental = true,
  restored_at = COALESCE(bc.restored_at, now()),
  reason = COALESCE(
    bc.reason,
    'Pasenusios nuolatinio laiko pamokos valymo klaida; dabartinė nuolatinė pamoka palikta aktyvi.'
  )
FROM public.bookings b
WHERE bc.booking_id = b.id
  AND b.status = 'cancelled'
  AND bc.cancelled_by_role = 'system'
  AND bc.restored_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.permanent_slots ps
    WHERE ps.user_id = b.user_id
      AND ps.day_of_week = EXTRACT(ISODOW FROM b.slot_date)::integer
      AND ps.slot_time <> b.slot_time
  )
  AND EXISTS (
    SELECT 1
    FROM public.bookings current_booking
    JOIN public.permanent_slots ps
      ON ps.user_id = current_booking.user_id
     AND ps.day_of_week = EXTRACT(ISODOW FROM current_booking.slot_date)::integer
     AND ps.slot_time = current_booking.slot_time
    WHERE current_booking.user_id = b.user_id
      AND current_booking.slot_date = b.slot_date
      AND current_booking.status IN ('active', 'pending_cancel')
      AND current_booking.slot_time = ps.slot_time
      AND ps.slot_time <> b.slot_time
  );

-- 3. Future permanent bookings are protected from the subscription pause
-- system by booking_is_permanent(); subscription enforcement must pause
-- ordinary bookings rather than cancelling permanent occurrences.
-- No UPDATE of bookings.status is performed here on purpose.
