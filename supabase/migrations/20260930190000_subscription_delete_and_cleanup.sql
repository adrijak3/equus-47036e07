-- ============================================================
-- EQUUS: Admin subscription deletion + automatic old-sub cleanup
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_delete_subscription(
  _subscription_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_user_id uuid;
  v_lessons_total smallint;
  v_lessons_used smallint;
  v_payment_id uuid;
  v_unlinked_bookings integer := 0;
BEGIN
  v_actor := auth.uid();

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  SELECT user_id, lessons_total, lessons_used
    INTO v_user_id, v_lessons_total, v_lessons_used
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  UPDATE public.bookings
  SET subscription_id = NULL,
      counts_in_subscription = false
  WHERE subscription_id = _subscription_id;

  GET DIAGNOSTICS v_unlinked_bookings = ROW_COUNT;

  SELECT id
    INTO v_payment_id
  FROM public.subscription_payments
  WHERE subscription_id = _subscription_id
  LIMIT 1;

  INSERT INTO public.subscription_audit_log (
    actor_user_id,
    target_user_id,
    subscription_id,
    payment_id,
    action,
    old_value,
    metadata
  )
  VALUES (
    v_actor,
    v_user_id,
    _subscription_id,
    v_payment_id,
    'subscription_deleted',
    jsonb_build_object(
      'lessons_total', v_lessons_total,
      'lessons_used', v_lessons_used
    ),
    jsonb_build_object(
      'reason', 'admin_delete',
      'bookings_unlinked', v_unlinked_bookings
    )
  );

  DELETE FROM public.subscription_allocations
  WHERE subscription_id = _subscription_id;

  DELETE FROM public.email_events
  WHERE subscription_id = _subscription_id;

  DELETE FROM public.subscription_payments
  WHERE subscription_id = _subscription_id;

  DELETE FROM public.subscriptions
  WHERE id = _subscription_id;

  RETURN jsonb_build_object(
    'subscription_id', _subscription_id,
    'deleted', true,
    'bookings_unlinked', v_unlinked_bookings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_subscription(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.cleanup_old_fully_used_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_subscription uuid;
BEGIN
  FOR v_subscription IN
    SELECT s.id
    FROM public.subscriptions s
    WHERE s.lessons_used >= s.lessons_total
      AND s.purchase_date <= CURRENT_DATE - INTERVAL '7 days'
      AND EXISTS (
        SELECT 1
        FROM public.subscriptions newer
        WHERE newer.user_id = s.user_id
          AND newer.purchase_date > s.purchase_date
      )
    ORDER BY s.purchase_date ASC
  LOOP
    UPDATE public.bookings
    SET subscription_id = NULL,
        counts_in_subscription = false
    WHERE subscription_id = v_subscription;

    DELETE FROM public.subscription_allocations
    WHERE subscription_id = v_subscription;

    DELETE FROM public.email_events
    WHERE subscription_id = v_subscription;

    INSERT INTO public.subscription_audit_log (
      target_user_id,
      action,
      old_value,
      metadata
    )
    SELECT
      s.user_id,
      'subscription_auto_deleted',
      jsonb_build_object(
        'subscription_id', s.id,
        'lessons_total', s.lessons_total,
        'lessons_used', s.lessons_used
      ),
      jsonb_build_object(
        'reason', 'fully_used_7_days_after_newer_purchase'
      )
    FROM public.subscriptions s
    WHERE s.id = v_subscription;

    DELETE FROM public.subscription_payments
    WHERE subscription_id = v_subscription;

    DELETE FROM public.subscriptions
    WHERE id = v_subscription;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_fully_used_subscriptions() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'equus-cleanup-old-fully-used-subscriptions';

SELECT cron.schedule(
  'equus-cleanup-old-fully-used-subscriptions',
  '15 3 * * *',
  $$
    SELECT public.cleanup_old_fully_used_subscriptions();
  $$
);
