-- Equus Gmail email expansion:
-- 1) payload support for queued emails
-- 2) subscription-expiry reminder (one day before the last counted training)
-- 3) admin global email announcements
-- 4) keep the existing one-email-per-minute worker; the queue is idempotent

ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS email_events_type_created_idx
  ON public.email_events(event_type, created_at DESC);

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
  LOOP
    SELECT max(b.slot_date)
      INTO v_last_training
    FROM public.bookings b
    WHERE b.subscription_id = r.id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE;

    -- "A day before the last training" means the last counted booking is tomorrow.
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

CREATE OR REPLACE FUNCTION public.admin_send_global_email(
  _title_lt text,
  _title_en text,
  _body_lt text,
  _body_en text,
  _url text DEFAULT '/grafikas',
  _dedupe_key text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF NULLIF(trim(_body_lt), '') IS NULL OR NULLIF(trim(_body_en), '') IS NULL THEN
    RAISE EXCEPTION 'MESSAGE_REQUIRED';
  END IF;

  FOR r IN
    SELECT p.id, u.email
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE u.email IS NOT NULL
  LOOP
    INSERT INTO public.email_events(
      event_key,
      event_type,
      user_id,
      email,
      payload,
      status
    )
    VALUES(
      'global_important_update:' ||
        COALESCE(_dedupe_key, gen_random_uuid()::text) || ':' || r.id::text,
      'global_important_update',
      r.id,
      r.email,
      jsonb_build_object(
        'title_lt', trim(_title_lt),
        'title_en', trim(_title_en),
        'body_lt', trim(_body_lt),
        'body_en', trim(_body_en),
        'url', COALESCE(_url, '/grafikas')
      ),
      'pending'
    )
    ON CONFLICT(event_key) DO NOTHING;

    IF FOUND THEN
      queued_count := queued_count + 1;
    END IF;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_global_email(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_global_email(text,text,text,text,text,text) TO authenticated;

-- Backstop: if this migration is applied after the original cron migration,
-- replace the function so expiry reminders are queued before the worker runs.
CREATE OR REPLACE FUNCTION public.equus_email_cron_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  cron_secret text;
BEGIN
  PERFORM public.queue_subscription_expiry_emails();

  SELECT decrypted_secret
    INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'equus_push_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL OR cron_secret = '' THEN
    RAISE WARNING 'equus_push_cron_secret is missing; subscription email worker was not invoked';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://mdjhdpyrnroywxoaaraa.supabase.co/functions/v1/send-subscription-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-equus-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')::jsonb
  );
END;
$$;
