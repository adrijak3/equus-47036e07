-- Reconcile existing Atostogos with already-materialized bookings.
--
-- The new vacation rules protect future materialization, but vacation rows
-- created before those rules were deployed may already have active bookings.
-- This one-time repair brings all existing vacation rows into the same state.

-- 1. Prevent recurring materialization from recreating occurrences inside
--    any already-existing vacation range.
INSERT INTO public.permanent_booking_exceptions (
  user_id,
  slot_date,
  slot_time
)
SELECT
  ps.user_id,
  d::date,
  ps.slot_time
FROM public.vacations v
JOIN public.permanent_slots ps
  ON ps.user_id = v.user_id
CROSS JOIN LATERAL generate_series(
  v.starts_on,
  v.ends_on,
  interval '1 day'
) AS d
WHERE ps.day_of_week = EXTRACT(ISODOW FROM d)::integer
ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;

-- 2. Cancel every still-active/pending lesson that falls inside a user's
--    existing vacation period. This intentionally includes both recurring
--    and one-off bookings: Atostogos means the rider does not attend during
--    the selected range.
UPDATE public.bookings b
SET
  status = 'cancelled',
  counts_in_subscription = false,
  updated_at = now()
WHERE b.status IN ('active', 'pending_cancel')
  AND EXISTS (
    SELECT 1
    FROM public.vacations v
    WHERE v.user_id = b.user_id
      AND b.slot_date BETWEEN v.starts_on AND v.ends_on
  );
