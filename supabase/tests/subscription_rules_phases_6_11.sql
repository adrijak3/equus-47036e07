-- Equus Phases 6-11 regression checklist.
-- These queries are intentionally non-destructive.
-- Run as an authenticated admin in Supabase SQL Editor where auth.uid() is available,
-- or replace the UUIDs in the explicit test calls with real user IDs.
--
-- IMPORTANT: do not create fake customer bookings in production just to test this file.

-- 1) Schema / trigger health.
SELECT public.subscription_rules_schema_check();

-- 2) Admin bypass must remain absolute.
SELECT public.check_booking_eligibility(
  auth.uid(),
  DATE '2026-10-20',
  TIME '17:00',
  true
);

-- 3) Weekly registration windows.
SELECT
  public.weekly_registration_window_is_open(DATE '2026-10-05') AS oct5_now,
  public.weekly_registration_window_is_open(DATE '2026-10-12') AS oct12_now;

-- 4) Inspect the current user's rule state.
SELECT public.subscription_rules_regression_snapshot(auth.uid());

-- 5) Inspect the current user's detailed eligibility diagnostics.
SELECT public.subscription_rules_diagnostics(
  auth.uid(),
  DATE '2026-10-20',
  TIME '17:00'
);

-- 6) Trigger definitions.
SELECT
  tgname,
  tgenabled,
  pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass
  AND NOT tgisinternal
  AND tgname IN (
    'trg_enforce_booking_eligibility_phase2',
    'trg_notify_subscription_requirement_booking',
    'trg_protect_subscription_pause_state',
    'trg_sync_subscription_usage_from_booking'
  )
ORDER BY tgname;

SELECT
  tgname,
  tgenabled,
  pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.subscriptions'::regclass
  AND NOT tgisinternal
  AND tgname = 'trg_restore_paused_bookings_after_subscription_purchase';

-- 7) Required booking columns.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'bookings'
  AND column_name IN (
    'is_grace_booking',
    'is_paused_for_subscription',
    'subscription_id',
    'counts_in_subscription'
  )
ORDER BY column_name;

-- 8) Find any impossible state: paused + permanent.
SELECT
  COUNT(*) AS paused_permanent_bookings
FROM public.bookings b
WHERE b.is_paused_for_subscription = true
  AND public.booking_is_permanent(b.id);

-- 9) Find duplicate active/pending bookings for the same user/date/time.
SELECT
  user_id,
  slot_date,
  slot_time,
  COUNT(*) AS duplicate_count
FROM public.bookings
WHERE status IN ('active', 'pending_cancel')
GROUP BY user_id, slot_date, slot_time
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- 10) Find users with more than one active future grace booking.
SELECT
  user_id,
  COUNT(*) AS grace_count
FROM public.bookings b
WHERE b.status IN ('active', 'pending_cancel')
  AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  AND b.subscription_id IS NULL
  AND b.counts_in_subscription IS NOT FALSE
  AND b.is_paused_for_subscription = false
  AND b.is_grace_booking = true
  AND NOT public.booking_is_permanent(b.id)
GROUP BY user_id
HAVING COUNT(*) > 1
ORDER BY grace_count DESC;

-- 11) Find active future bookings without a usable matching subscription
-- that are NOT permanent and NOT paused. The result is informational:
-- one row per user is expected while that row is the user's grace booking.
SELECT
  b.user_id,
  b.id AS booking_id,
  b.slot_date,
  b.slot_time,
  b.is_grace_booking
FROM public.bookings b
WHERE b.status = 'active'
  AND b.slot_date >= DATE '2026-10-18'
  AND b.subscription_id IS NULL
  AND b.counts_in_subscription IS NOT FALSE
  AND b.is_paused_for_subscription = false
  AND NOT public.booking_is_permanent(b.id)
  AND NOT public.is_subscription_rule_exempt(b.user_id)
ORDER BY b.user_id, b.slot_date, b.slot_time;

-- 12) Find paused future bookings. These should be non-permanent,
-- non-admin/non-exempt users waiting for subscription restoration.
SELECT
  b.user_id,
  b.id AS booking_id,
  b.slot_date,
  b.slot_time,
  b.is_paused_for_subscription
FROM public.bookings b
WHERE b.is_paused_for_subscription = true
ORDER BY b.user_id, b.slot_date, b.slot_time;

-- 13) Verify queued requirement warnings are unique by booking.
SELECT
  booking_id,
  COUNT(*) AS event_count
FROM public.email_events
WHERE event_type = 'subscription_requirement_warning'
GROUP BY booking_id
HAVING COUNT(*) > 1;

-- 14) Verify the automatic email worker cron is still active.
SELECT
  jobid,
  jobname,
  schedule,
  active
FROM cron.job
WHERE jobname = 'equus-subscription-email-every-minute';

-- 15) Verify the Phase 5 deadline engine is present.
SELECT
  proname,
  pg_get_function_identity_arguments(oid) AS arguments
FROM pg_proc
WHERE proname IN (
  'enforce_subscription_requirement_deadlines',
  'queue_subscription_requirement_warning',
  'pause_uncovered_future_bookings',
  'restore_paused_bookings_for_subscription',
  'allocate_booking_to_subscription',
  'booking_subscription_is_usable_for_slot'
)
ORDER BY proname;
