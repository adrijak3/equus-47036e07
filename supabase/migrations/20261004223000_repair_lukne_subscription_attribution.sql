-- Repair Luknė's current 12-lesson subscription attribution.
--
-- The current subscription started on 2026-09-07. Four completed lessons in
-- that subscription period were left pointing at orphaned historical
-- subscription IDs:
--   2026-09-09 19:15
--   2026-09-14 17:15
--   2026-09-16 19:15
--   2026-09-18 17:30
--
-- Do NOT change lesson completion/history. These bookings remain COMPLETED.
-- Do NOT touch the earlier 2026-09-02 and 2026-09-04 lessons because they
-- predate the current 2026-09-07 subscription.
--
-- The booking subscription-sync trigger will create allocation rows and
-- reconcile lessons_used for the current subscription.

DO $$
DECLARE
  v_subscription_id uuid := '61549752-5a26-4047-8879-311381cceae0';
  v_expected integer := 4;
  v_updated integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE id = v_subscription_id
      AND user_id = (
        SELECT id
        FROM public.profiles
        WHERE full_name = 'Luknė Pa'
        LIMIT 1
      )
      AND lessons_total = 12
  ) THEN
    RAISE EXCEPTION 'EXPECTED_LUKNE_SUBSCRIPTION_NOT_FOUND';
  END IF;

  WITH target AS (
    SELECT b.id
    FROM public.bookings b
    WHERE b.id IN (
      '3a684ac8-c24f-49a9-9b45-b8d2fcf6e269',
      '60f4ff66-bd91-4587-9667-05eda5cc48c7',
      '82737af0-0ac5-4ade-b30d-fabca31846d0',
      '5ae0b2d7-b595-44b2-be5c-8feb03d343a4'
    )
      AND b.status = 'completed'
      AND b.counts_in_subscription IS NOT FALSE
      AND b.subscription_id IS DISTINCT FROM v_subscription_id
  )
  UPDATE public.bookings b
  SET
    subscription_id = v_subscription_id,
    counts_in_subscription = true,
    updated_at = now()
  FROM target
  WHERE b.id = target.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'LUKNE_SUBSCRIPTION_REPAIR_EXPECTED_4_UPDATED_%', v_updated;
  END IF;

  -- The historical rows already attached to this subscription were missing
  -- allocation records. Backfill those metadata rows without changing any
  -- booking status or subscription completion history.
  WITH target_bookings AS (
    SELECT
      b.id,
      b.status,
      b.slot_date,
      b.slot_time,
      b.created_at,
      row_number() OVER (
        ORDER BY b.slot_date, b.slot_time, b.created_at, b.id
      )::smallint AS allocation_number
    FROM public.bookings b
    WHERE b.subscription_id = v_subscription_id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE
  )
  INSERT INTO public.subscription_allocations (
    subscription_id,
    booking_id,
    allocation_number,
    status,
    consumed_at
  )
  SELECT
    v_subscription_id,
    tb.id,
    tb.allocation_number,
    CASE WHEN tb.status = 'completed' THEN 'consumed' ELSE 'allocated' END,
    CASE WHEN tb.status = 'completed' THEN tb.created_at ELSE NULL END
  FROM target_bookings tb
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.subscription_allocations sa
    WHERE sa.subscription_id = v_subscription_id
      AND sa.booking_id = tb.id
  );

  PERFORM public.reconcile_subscription_usage(v_subscription_id);
END
$$;
