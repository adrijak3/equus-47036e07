-- Equus: read-only subscription/recurring system diagnostics.
-- No customer data is modified by this migration or by the diagnostics RPC.

CREATE OR REPLACE FUNCTION public.equus_subscription_system_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $diag$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;

  v_orphaned_completed integer;
  v_invalid_completed integer;
  v_unassigned_completed_with_candidate integer;
  v_orphaned_future integer;
  v_invalid_future integer;
  v_missing_allocations integer;
  v_allocation_mismatches integer;
  v_subscription_counter_mismatches integer;
  v_stale_recurring_pairs integer;
  v_over_capacity_slots integer;
  v_duplicate_user_slot_rows integer;
  v_pending_duplicates integer;
  v_pending_count integer;
  v_active_count integer;
  v_expired_unexpired_usage integer;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT count(*)
    INTO v_orphaned_completed
  FROM public.bookings b
  LEFT JOIN public.subscriptions s ON s.id = b.subscription_id
  WHERE b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.subscription_id IS NOT NULL
    AND s.id IS NULL;

  SELECT count(*)
    INTO v_invalid_completed
  FROM public.bookings b
  JOIN public.subscriptions s ON s.id = b.subscription_id
  WHERE b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND (
      s.user_id IS DISTINCT FROM b.user_id
      OR s.paid IS NOT TRUE
      OR s.cancelled_at IS NOT NULL
      OR s.start_pending = true
      OR s.start_from_date IS NULL
      OR s.expires_at IS NULL
      OR b.slot_date NOT BETWEEN s.start_from_date AND s.expires_at
      OR (
        public.equus_effective_slot_capacity(b.slot_date, b.slot_time) > 0
        AND public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        ) IS NOT TRUE
      )
    );

  SELECT count(*)
    INTO v_unassigned_completed_with_candidate
  FROM public.bookings b
  WHERE b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.subscription_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.user_id = b.user_id
        AND s.paid = true
        AND s.cancelled_at IS NULL
        AND s.start_pending = false
        AND s.start_from_date IS NOT NULL
        AND s.expires_at IS NOT NULL
        AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
        AND public.subscription_committed_lessons(s.id) < s.lessons_total
        AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) > 0
        AND public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        ) IS TRUE
    );

  SELECT count(*)
    INTO v_orphaned_future
  FROM public.bookings b
  LEFT JOIN public.subscriptions s ON s.id = b.subscription_id
  WHERE b.status IN ('active', 'pending_cancel')
    AND b.subscription_id IS NOT NULL
    AND s.id IS NULL;

  SELECT count(*)
    INTO v_invalid_future
  FROM public.bookings b
  JOIN public.subscriptions s ON s.id = b.subscription_id
  WHERE b.status IN ('active', 'pending_cancel')
    AND (
      s.user_id IS DISTINCT FROM b.user_id
      OR s.paid IS NOT TRUE
      OR s.cancelled_at IS NOT NULL
      OR s.start_pending = true
      OR s.start_from_date IS NULL
      OR s.expires_at IS NULL
      OR b.slot_date NOT BETWEEN s.start_from_date AND s.expires_at
      OR (
        public.equus_effective_slot_capacity(b.slot_date, b.slot_time) > 0
        AND public.booking_matches_subscription_package(
          b.id,
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          )
        ) IS NOT TRUE
      )
    );

  SELECT count(*)
    INTO v_missing_allocations
  FROM public.bookings b
  JOIN public.subscriptions s ON s.id = b.subscription_id
  LEFT JOIN public.subscription_allocations sa
    ON sa.subscription_id = b.subscription_id
   AND sa.booking_id = b.id
  WHERE b.status IN ('active', 'pending_cancel', 'completed')
    AND b.counts_in_subscription IS NOT FALSE
    AND s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
    AND public.equus_effective_slot_capacity(b.slot_date, b.slot_time) >= 0
    AND sa.id IS NULL;

  SELECT count(*)
    INTO v_allocation_mismatches
  FROM public.subscription_allocations sa
  LEFT JOIN public.bookings b ON b.id = sa.booking_id
  WHERE b.id IS NULL
     OR b.subscription_id IS DISTINCT FROM sa.subscription_id
     OR (
       sa.status <> 'released'
       AND (
         b.status = 'cancelled'
         OR b.counts_in_subscription IS FALSE
       )
     );

  SELECT count(*)
    INTO v_subscription_counter_mismatches
  FROM public.subscriptions s
  WHERE s.start_pending = false
    AND s.start_from_date IS NOT NULL
    AND s.expires_at IS NOT NULL
    AND s.lessons_used IS DISTINCT FROM LEAST(
      s.lessons_total,
      (
        SELECT count(*)::smallint
        FROM public.bookings b
        WHERE b.subscription_id = s.id
          AND b.status = 'completed'
          AND b.counts_in_subscription IS NOT FALSE
          AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
          AND (
            public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 0
            OR public.booking_matches_subscription_package(
              b.id,
              COALESCE(
                s.package_type,
                CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
              )
            ) IS TRUE
          )
      )
    );

  SELECT count(*)
    INTO v_stale_recurring_pairs
  FROM public.bookings stale
  JOIN public.permanent_slots ps
    ON ps.user_id = stale.user_id
   AND ps.day_of_week = EXTRACT(ISODOW FROM stale.slot_date)::integer
   AND ps.slot_time <> stale.slot_time
  JOIN public.bookings current_b
    ON current_b.user_id = stale.user_id
   AND current_b.slot_date = stale.slot_date
   AND current_b.slot_time = ps.slot_time
   AND current_b.status IN ('active', 'pending_cancel')
   AND public.booking_is_permanent(current_b.id)
  WHERE stale.status IN ('active', 'pending_cancel')
    AND stale.trainer_name IS NULL
    AND COALESCE(stale.is_individual, false) = false
    AND stale.slot_date >= v_today + 1
    AND current_b.created_at >= stale.created_at;

  SELECT count(*)
    INTO v_over_capacity_slots
  FROM (
    SELECT
      b.slot_date,
      b.slot_time,
      count(*) AS occupied,
      public.equus_effective_slot_capacity(b.slot_date, b.slot_time) AS capacity
    FROM public.bookings b
    WHERE b.status IN ('active', 'pending_cancel')
      AND b.is_paused_for_subscription IS NOT TRUE
      AND b.slot_date >= v_today
    GROUP BY b.slot_date, b.slot_time
  ) x
  WHERE x.capacity > 0
    AND x.occupied > x.capacity;

  SELECT count(*)
    INTO v_duplicate_user_slot_rows
  FROM (
    SELECT user_id, slot_date, slot_time
    FROM public.bookings
    WHERE status IN ('active', 'pending_cancel')
    GROUP BY user_id, slot_date, slot_time
    HAVING count(*) > 1
  ) x;

  SELECT count(*)
    INTO v_pending_duplicates
  FROM (
    SELECT user_id
    FROM public.subscriptions
    WHERE start_pending = true
      AND cancelled_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) x;

  SELECT count(*) INTO v_pending_count
  FROM public.subscriptions
  WHERE start_pending = true
    AND paid = true
    AND cancelled_at IS NULL;

  SELECT count(*) INTO v_active_count
  FROM public.subscriptions
  WHERE start_pending = false
    AND paid = true
    AND cancelled_at IS NULL
    AND start_from_date IS NOT NULL
    AND expires_at IS NOT NULL
    AND expires_at >= v_today
    AND lessons_used < lessons_total;

  SELECT count(*)
    INTO v_expired_unexpired_usage
  FROM public.subscriptions
  WHERE start_pending = false
    AND paid = true
    AND cancelled_at IS NULL
    AND expires_at IS NOT NULL
    AND expires_at < v_today
    AND lessons_used < lessons_total;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'today', v_today,
    'completed_orphaned_subscription_links', v_orphaned_completed,
    'completed_invalid_subscription_links', v_invalid_completed,
    'completed_unassigned_with_valid_candidate', v_unassigned_completed_with_candidate,
    'future_orphaned_subscription_links', v_orphaned_future,
    'future_invalid_subscription_links', v_invalid_future,
    'valid_attached_bookings_missing_allocation', v_missing_allocations,
    'allocation_metadata_mismatches', v_allocation_mismatches,
    'subscription_counter_mismatches', v_subscription_counter_mismatches,
    'stale_future_recurring_pairs', v_stale_recurring_pairs,
    'over_capacity_active_slots', v_over_capacity_slots,
    'duplicate_user_future_occurrences', v_duplicate_user_slot_rows,
    'pending_subscription_duplicate_users', v_pending_duplicates,
    'pending_subscriptions', v_pending_count,
    'active_subscriptions', v_active_count,
    'expired_subscriptions_with_remaining_lessons', v_expired_unexpired_usage
  );
END;
$diag$;

REVOKE ALL
ON FUNCTION public.equus_subscription_system_diagnostics()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.equus_subscription_system_diagnostics()
TO authenticated, service_role;
