-- ============================================================
-- EQUUS — ADMIN CANCELLATION BYPASS
--
-- Admin cancellation decisions are privileged administrative
-- actions. They must be able to change cancellation state,
-- booking subscription-count state, and any subscription
-- counters/credits affected by cancellation triggers.
--
-- The subscriptions protection trigger intentionally blocks
-- ordinary client updates. This RPC sets the transaction-local
-- trusted marker before the cancellation update so its AFTER
-- triggers are allowed to perform their administrative changes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_decide_cancellation(
  _request_id uuid,
  _counts boolean,
  _makeup_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_req public.cancellation_requests%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_old_counts boolean;
  v_subscription_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _request_id IS NULL THEN
    RAISE EXCEPTION 'CANCELLATION_REQUEST_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_req
  FROM public.cancellation_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANCELLATION_REQUEST_NOT_FOUND';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'CANCELLATION_ALREADY_DECIDED';
  END IF;

  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = v_req.booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  v_old_counts := COALESCE(v_booking.counts_in_subscription, true);
  v_subscription_id := v_booking.subscription_id;

  -- This is the trusted admin path. It is transaction-local, so
  -- normal client writes remain protected by the subscription trigger.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.cancellation_requests
  SET
    status = 'approved',
    admin_decision_counts = _counts,
    makeup_deadline = CASE
      WHEN _counts = false THEN _makeup_deadline
      ELSE NULL
    END,
    decided_at = now()
  WHERE id = _request_id;

  UPDATE public.bookings
  SET counts_in_subscription = _counts
  WHERE id = v_booking.id;

  -- Keep the subscription counter aligned with the administrative
  -- cancellation decision. Do not change the counter when the
  -- booking was already in the requested state.
  IF v_subscription_id IS NOT NULL
     AND v_old_counts IS DISTINCT FROM _counts
  THEN
    IF _counts = false THEN
      UPDATE public.subscriptions
      SET lessons_used = GREATEST(0, lessons_used - 1)
      WHERE id = v_subscription_id;
    ELSE
      UPDATE public.subscriptions
      SET lessons_used = LEAST(lessons_total, lessons_used + 1)
      WHERE id = v_subscription_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_req.id,
    'booking_id', v_booking.id,
    'subscription_id', v_subscription_id,
    'counts_in_subscription', _counts,
    'makeup_deadline', CASE
      WHEN _counts = false THEN _makeup_deadline
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_cancellation(uuid,boolean,date)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_decide_cancellation(uuid,boolean,date)
TO authenticated;
