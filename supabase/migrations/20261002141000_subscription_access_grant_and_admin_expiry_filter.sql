-- Fix subscription access grants and keep client expiry reminders out of admin accounts.
-- GRANT is required before RLS can evaluate a SELECT request.
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_subscription_expiry_emails()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
  r record;
  v_email text;
  v_last_training date;
BEGIN
  FOR r IN
    SELECT
      s.id,
      s.user_id,
      s.lessons_total,
      s.lessons_used
    FROM public.subscriptions s
    WHERE COALESCE(s.paid, false) = true
      AND COALESCE(s.cancelled_at IS NULL, true)
      AND s.user_id IS NOT NULL
      AND s.lessons_used < s.lessons_total
      AND NOT public.has_role(s.user_id, 'admin'::public.app_role)
  LOOP
    SELECT max(b.slot_date)
      INTO v_last_training
    FROM public.bookings b
    WHERE b.subscription_id = r.id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE;

    IF v_last_training = current_date + 1 THEN
      SELECT u.email
        INTO v_email
      FROM auth.users u
      WHERE u.id = r.user_id
        AND u.email IS NOT NULL;

      IF v_email IS NOT NULL THEN
        INSERT INTO public.email_events(
          event_key,
          event_type,
          user_id,
          email,
          subscription_id,
          booking_id,
          payload,
          status
        )
        VALUES(
          'subscription_expiring:' || r.id::text || ':' || v_last_training::text,
          'subscription_expiring',
          r.user_id,
          v_email,
          r.id,
          NULL,
          jsonb_build_object(
            'last_training_date', v_last_training,
            'lessons_total', r.lessons_total,
            'lessons_used', r.lessons_used,
            'remaining', GREATEST(0, r.lessons_total - r.lessons_used)
          ),
          'pending'
        )
        ON CONFLICT(event_key) DO NOTHING;

        IF FOUND THEN
          queued_count := queued_count + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_subscription_expiry_emails() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_subscription_expiry_emails() TO service_role;
