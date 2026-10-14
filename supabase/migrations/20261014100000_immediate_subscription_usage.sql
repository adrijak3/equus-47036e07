-- Equus: count completed subscription lessons immediately, and auto-allocate
-- a completed, eligible booking to a compatible active subscription.
--
-- Intentionally scoped:
--   * Reconciliation changes only the subscription being reconciled.
--   * Attach/detach/delete still flow through the existing booking accounting trigger.
--   * Manual offsets, manual lesson notes, and approved purchase-request lessons remain counted.
--   * Future / active bookings are not automatically attached.
--   * Detaching a completed booking does not immediately re-attach it; auto-allocation
--     only runs when a booking is inserted as completed or transitions to completed.

CREATE OR REPLACE FUNCTION public.subscription_auto_used(_subscription_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $subscription_auto_used_immediate$
DECLARE
  v_used integer := 0;
  v_manual_used integer := 0;
  v_selected_used integer := 0;
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Every eligible completed booking counts immediately, including today's.
  -- Do not gate the current date behind the old 20:00-only setting.
  SELECT COUNT(*)::integer
    INTO v_used
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.slot_date BETWEEN
      COALESCE(s.start_from_date, s.purchase_date)
      AND s.expires_at
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    );

  -- Keep supporting older installations where the optional notes table was
  -- not present at the time the earlier migration was applied.
  IF to_regclass('public.subscription_manual_lessons') IS NOT NULL THEN
    EXECUTE
      'SELECT COUNT(*)::integer
         FROM public.subscription_manual_lessons
        WHERE subscription_id = $1'
      INTO v_manual_used
      USING _subscription_id;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_selected_used
  FROM public.subscription_purchase_request_lessons rl
  JOIN public.subscription_purchase_requests r
    ON r.id = rl.request_id
  WHERE r.subscription_id = _subscription_id
    AND r.status = 'approved';

  RETURN LEAST(
    32767,
    COALESCE(v_used, 0)
      + COALESCE(v_manual_used, 0)
      + COALESCE(v_selected_used, 0)
  )::smallint;
END;
$subscription_auto_used_immediate$;

REVOKE ALL
ON FUNCTION public.subscription_auto_used(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.subscription_auto_used(uuid)
TO service_role;


-- The existing booking-accounting trigger updates only the old/new subscription
-- when a booking is assigned, detached, completed or deleted. This extra trigger
-- handles the missing case: a completed booking that has no subscription yet.
CREATE OR REPLACE FUNCTION public.auto_allocate_completed_booking_to_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $auto_allocate_completed_booking$
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed'
     OR NEW.subscription_id IS NOT NULL
     OR NEW.counts_in_subscription IS FALSE
     OR NEW.is_paused_for_subscription IS TRUE
  THEN
    RETURN NEW;
  END IF;

  -- Do not undo an intentional detach when an unrelated UPDATE mentions status
  -- but leaves it completed. Only handle new completed records / transitions.
  IF TG_OP = 'UPDATE'
     AND OLD.status IS NOT DISTINCT FROM NEW.status
  THEN
    RETURN NEW;
  END IF;

  -- Allocation is idempotent. The existing subscription-accounting trigger
  -- will recalculate only the subscription the allocator attaches to.
  BEGIN
    PERFORM public.allocate_booking_to_subscription(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      -- Do not prevent the completed booking from being saved if allocation
      -- encounters a data issue; process-lessons can retry/log the allocation.
      RAISE WARNING
        'Equus auto-allocation failed for completed booking %: %',
        NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$auto_allocate_completed_booking$;

DROP TRIGGER IF EXISTS trg_auto_allocate_completed_booking_to_subscription
ON public.bookings;

CREATE TRIGGER trg_auto_allocate_completed_booking_to_subscription
AFTER INSERT OR UPDATE OF status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.auto_allocate_completed_booking_to_subscription();

REVOKE ALL
ON FUNCTION public.auto_allocate_completed_booking_to_subscription()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.auto_allocate_completed_booking_to_subscription()
TO service_role;
