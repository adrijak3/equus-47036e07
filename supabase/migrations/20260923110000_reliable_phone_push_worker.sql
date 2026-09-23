-- Equus reliable server-side phone push delivery.
-- Additive: preserves notification history, bookings, lesson subscriptions and
-- existing notification types.

-- Push subscriptions are per device/endpoint. Existing rows stay for diagnosis.
ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS invalid_at timestamptz;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uniq
  ON public.push_subscriptions (endpoint);

-- Replace any older push-subscription policies, including restrictive policies
-- that could otherwise continue to block the user's own upsert/update/delete.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_subscriptions'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.push_subscriptions',
      p.policyname
    );
  END LOOP;
END;
$$;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_subscriptions_select_own"
ON public.push_subscriptions
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_insert_own"
ON public.push_subscriptions
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_update_own"
ON public.push_subscriptions
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_subscriptions_delete_own"
ON public.push_subscriptions
FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Queue worker state. A claim token prevents two workers from processing the
-- same queue row concurrently. Stale claims are reclaimable after 15 minutes.
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS processing_at timestamptz;

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS processing_token uuid;

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_queue_pending_idx
  ON public.notification_queue (created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_notification_queue(_limit integer DEFAULT 100)
RETURNS SETOF public.notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_token uuid := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT nq.id
    FROM public.notification_queue nq
    WHERE nq.sent_at IS NULL
      AND nq.failed_at IS NULL
      AND nq.attempts < 5
      AND (
        nq.processing_at IS NULL
        OR nq.processing_at < now() - interval '15 minutes'
      )
    ORDER BY nq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 200))
  )
  UPDATE public.notification_queue nq
  SET processing_at = now(),
      processing_token = claim_token,
      attempts = nq.attempts + 1
  FROM candidates c
  WHERE nq.id = c.id
  RETURNING nq.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification_queue(integer)
FROM PUBLIC, anon, authenticated;

-- Reminder generation is based on a real Europe/Vilnius timestamptz rather than
-- a server/session-local timestamp. The ±3 minute window makes a once-per-minute
-- cron safe without requiring an exact millisecond match.
CREATE OR REPLACE FUNCTION public.queue_training_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
  r record;
  booking_start timestamptz;
  reminder_target timestamptz;
  hours_before integer;
  queued_id uuid;
  local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  FOR r IN
    SELECT
      b.id,
      b.user_id,
      b.slot_date,
      b.slot_time,
      p.notify_lesson_reminders,
      p.notify_lesson_reminder_hours
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.user_id
    WHERE b.user_id IS NOT NULL
      AND b.status = 'active'
      AND p.notify_lesson_reminders = true
      AND p.notify_lesson_reminder_hours IN (5, 24)
      AND b.slot_date >= local_date
  LOOP
    booking_start := make_timestamptz(
      extract(year from r.slot_date)::integer,
      extract(month from r.slot_date)::integer,
      extract(day from r.slot_date)::integer,
      extract(hour from r.slot_time)::integer,
      extract(minute from r.slot_time)::integer,
      extract(second from r.slot_time),
      'Europe/Vilnius'
    );

    hours_before := r.notify_lesson_reminder_hours;
    reminder_target := booking_start - make_interval(hours => hours_before);

    IF booking_start > now()
       AND abs(extract(epoch from (now() - reminder_target))) <= 180
    THEN
      SELECT public.queue_equus_notification(
        r.user_id,
        'TRAINING_REMINDER',
        'Primename apie treniruotę 🐴',
        'Training reminder 🐴',
        format(
          'Jūsų treniruotė %s %s.',
          to_char(booking_start AT TIME ZONE 'Europe/Vilnius', 'DD.MM'),
          to_char(booking_start AT TIME ZONE 'Europe/Vilnius', 'HH24:MI')
        ),
        format(
          'Your training is on %s at %s.',
          to_char(booking_start AT TIME ZONE 'Europe/Vilnius', 'DD.MM'),
          to_char(booking_start AT TIME ZONE 'Europe/Vilnius', 'HH24:MI')
        ),
        '/grafikas',
        format('training-reminder:%s:%s', r.id, hours_before)
      ) INTO queued_id;

      IF queued_id IS NOT NULL THEN
        queued_count := queued_count + 1;
        RAISE LOG 'Equus push worker: reminder queued kind=TRAINING_REMINDER booking=%', r.id;
      END IF;
    END IF;
  END LOOP;

  RAISE LOG 'Equus push worker: reminders generated count=%', queued_count;
  RETURN queued_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_training_reminders()
FROM PUBLIC, anon, authenticated;

-- Recurring/permanent time changes: notify only future reservations actually
-- affected by the old recurring slot. This preserves the existing in-site
-- important notification as well as the push queue.
CREATE OR REPLACE FUNCTION public.notify_permanent_slot_time_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  old_day_lt text;
  new_day_lt text;
  old_time text;
  new_time text;
  notification_key text;
BEGIN
  IF OLD.day_of_week IS NOT DISTINCT FROM NEW.day_of_week
     AND OLD.slot_time IS NOT DISTINCT FROM NEW.slot_time THEN
    RETURN NEW;
  END IF;

  old_day_lt := CASE OLD.day_of_week
    WHEN 1 THEN 'Pirmadienis' WHEN 2 THEN 'Antradienis' WHEN 3 THEN 'Trečiadienis'
    WHEN 4 THEN 'Ketvirtadienis' WHEN 5 THEN 'Penktadienis'
    WHEN 6 THEN 'Šeštadienis' WHEN 7 THEN 'Sekmadienis'
  END;

  new_day_lt := CASE NEW.day_of_week
    WHEN 1 THEN 'Pirmadienis' WHEN 2 THEN 'Antradienis' WHEN 3 THEN 'Trečiadienis'
    WHEN 4 THEN 'Ketvirtadienis' WHEN 5 THEN 'Penktadienis'
    WHEN 6 THEN 'Šeštadienis' WHEN 7 THEN 'Sekmadienis'
  END;

  old_time := to_char(OLD.slot_time, 'HH24:MI');
  new_time := to_char(NEW.slot_time, 'HH24:MI');

  FOR r IN
    SELECT b.id, b.user_id, b.slot_date, b.slot_time
    FROM public.bookings b
    WHERE b.user_id = NEW.user_id
      AND b.status IN ('active', 'pending_cancel')
      AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND (
        CASE
          WHEN extract(dow from b.slot_date)::integer = 0 THEN 7
          ELSE extract(dow from b.slot_date)::integer
        END
      ) = OLD.day_of_week
      AND b.slot_time = OLD.slot_time
  LOOP
    notification_key := format(
      'recurring-time-auto:%s:%s:%s:%s:%s',
      r.id, OLD.day_of_week, OLD.slot_time, NEW.day_of_week, NEW.slot_time
    );

    INSERT INTO public.important_notifications (
      user_id, notification_type, title_lt, title_en, body_lt, body_en, url, dedupe_key
    )
    VALUES (
      r.user_id,
      'RECURRING_TIME_CHANGED',
      'Pasikeitė Jūsų treniruotės laikas',
      'Your training time changed',
      format(
        'Jūsų treniruotė %s %s perkelta į %s %s.',
        to_char(r.slot_date, 'DD.MM'), old_time, new_day_lt, new_time
      ),
      format(
        'Your training on %s at %s was moved to %s at %s.',
        to_char(r.slot_date, 'DD.MM'), old_time, new_day_lt, new_time
      ),
      '/grafikas',
      notification_key
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    PERFORM public.queue_equus_notification(
      r.user_id,
      'RECURRING_TIME_CHANGED',
      'Pasikeitė Jūsų treniruotės laikas',
      'Your training time changed',
      format(
        'Jūsų treniruotė %s %s perkelta į %s %s.',
        to_char(r.slot_date, 'DD.MM'), old_time, new_day_lt, new_time
      ),
      format(
        'Your training on %s at %s was moved to %s at %s.',
        to_char(r.slot_date, 'DD.MM'), old_time, new_day_lt, new_time
      ),
      '/grafikas',
      notification_key
    );

    RAISE LOG 'Equus push worker: recurring time change queued booking=% user=%', r.id, r.user_id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_permanent_slot_time_change ON public.permanent_slots;
CREATE TRIGGER trg_notify_permanent_slot_time_change
AFTER UPDATE OF day_of_week, slot_time ON public.permanent_slots
FOR EACH ROW
EXECUTE FUNCTION public.notify_permanent_slot_time_change();

REVOKE EXECUTE ON FUNCTION public.notify_permanent_slot_time_change()
FROM PUBLIC, anon, authenticated;

-- One scheduled job drives both reminder generation and queued-event delivery.
-- The secret itself is never stored in this migration; create the Vault secret
-- named equus_push_cron_secret and the matching Edge Function secret separately.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'equus-push-notifications-every-minute';

SELECT cron.schedule(
  'equus-push-notifications-every-minute',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://tkksskpvpartlhpnctzu.supabase.co/functions/v1/push-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-equus-push-secret',
        COALESCE(
          (SELECT decrypted_secret
           FROM vault.decrypted_secrets
           WHERE name = 'equus_push_cron_secret'
           LIMIT 1),
          ''
        )
      ),
      body := jsonb_build_object('source', 'pg_cron')
    ) AS request_id;
  $$
);
