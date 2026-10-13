-- Preserve manually recorded lessons: do not auto-delete a subscription
-- while it still owns manual lesson notes. All other cleanup conditions/actions
-- remain unchanged. After an admin removes all notes, existing cleanup rules
-- apply normally on the next scheduled run.

CREATE OR REPLACE FUNCTION public.cleanup_old_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cleanup_old_subs_keep_manual_lessons$
DECLARE
  v_removed integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT s.*
    FROM public.subscriptions s
    WHERE s.expires_at < (
      (now() AT TIME ZONE 'Europe/Vilnius')::date - INTERVAL '1 month'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscription_manual_lessons ml
        WHERE ml.subscription_id = s.id
      )
    ORDER BY s.expires_at, s.id
  LOOP
    INSERT INTO public.subscription_audit_log (
      target_user_id,
      subscription_id,
      action,
      old_value,
      metadata
    )
    VALUES (
      r.user_id,
      r.id,
      'subscription_auto_deleted',
      jsonb_build_object(
        'lessons_total', r.lessons_total,
        'lessons_used', r.lessons_used,
        'purchase_date', r.purchase_date,
        'start_from_date', r.start_from_date,
        'expires_at', r.expires_at
      ),
      jsonb_build_object(
        'reason', 'one_month_after_expiry'
      )
    );

    UPDATE public.bookings
    SET
      subscription_id = NULL,
      counts_in_subscription = false,
      is_grace_booking = false
    WHERE subscription_id = r.id;

    DELETE FROM public.subscription_allocations
    WHERE subscription_id = r.id;

    DELETE FROM public.email_events
    WHERE subscription_id = r.id;

    DELETE FROM public.subscription_payments
    WHERE subscription_id = r.id;

    DELETE FROM public.subscriptions
    WHERE id = r.id;

    v_removed := v_removed + 1;
  END LOOP;

  RETURN v_removed;
END;
$cleanup_old_subs_keep_manual_lessons$;

REVOKE ALL
ON FUNCTION public.cleanup_old_subscriptions()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.cleanup_old_subscriptions()
TO service_role;
