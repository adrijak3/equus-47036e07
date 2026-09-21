CREATE TABLE IF NOT EXISTS public.important_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  title_lt text NOT NULL,
  title_en text NOT NULL,
  body_lt text NOT NULL,
  body_en text NOT NULL,
  url text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS important_notifications_user_unread_idx
  ON public.important_notifications(user_id, created_at)
  WHERE read_at IS NULL;

ALTER TABLE public.important_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own important notifications"
ON public.important_notifications;
CREATE POLICY "Users can view own important notifications"
ON public.important_notifications
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can mark own important notifications read"
ON public.important_notifications;
CREATE POLICY "Users can mark own important notifications read"
ON public.important_notifications
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS important_notifications_dedupe_uniq
  ON public.important_notifications(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Admin important-update notifications: global announcements and targeted recurring-time changes.

CREATE OR REPLACE FUNCTION public.admin_send_global_notification(
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

  FOR r IN
    SELECT p.id
    FROM public.profiles p
  LOOP
    INSERT INTO public.important_notifications (
      user_id, notification_type, title_lt, title_en, body_lt, body_en, url, dedupe_key
    )
    VALUES (
      r.id, 'GLOBAL_IMPORTANT_UPDATE', _title_lt, _title_en, _body_lt, _body_en,
      COALESCE(_url, '/grafikas'),
      CASE WHEN _dedupe_key IS NULL THEN NULL ELSE _dedupe_key || ':' || r.id END
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    PERFORM public.queue_equus_notification(
      r.id, 'GLOBAL_IMPORTANT_UPDATE', _title_lt, _title_en, _body_lt, _body_en,
      COALESCE(_url, '/grafikas'),
      CASE WHEN _dedupe_key IS NULL THEN NULL ELSE _dedupe_key || ':' || r.id END
    );
    queued_count := queued_count + 1;
  END LOOP;

  RETURN queued_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_recurring_time_change(
  _user_id uuid,
  _old_day text,
  _old_time text,
  _new_day text,
  _new_time text,
  _dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  INSERT INTO public.important_notifications (
    user_id, notification_type, title_lt, title_en, body_lt, body_en, url, dedupe_key
  )
  VALUES (
    _user_id,
    'RECURRING_TIME_CHANGED',
    'Pasikeitė Jūsų nuolatinės treniruotės laikas',
    'Your recurring training time changed',
    format('Jūsų nuolatinės treniruotės laikas pasikeitė: %s %s → %s %s.', _old_day, _old_time, _new_day, _new_time),
    format('Your recurring training time changed: %s %s → %s %s.', _old_day, _old_time, _new_day, _new_time),
    '/grafikas',
    COALESCE(_dedupe_key, format('recurring-time-changed:%s:%s:%s:%s:%s', _user_id, _old_day, _old_time, _new_day, _new_time))
  )
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  SELECT public.queue_equus_notification(
    _user_id,
    'RECURRING_TIME_CHANGED',
    'Pasikeitė Jūsų nuolatinės treniruotės laikas',
    'Your recurring training time changed',
    format('Jūsų nuolatinės treniruotės laikas pasikeitė: %s %s → %s %s.', _old_day, _old_time, _new_day, _new_time),
    format('Your recurring training time changed: %s %s → %s %s.', _old_day, _old_time, _new_day, _new_time),
    '/grafikas',
    COALESCE(_dedupe_key, format('recurring-time-changed:%s:%s:%s:%s:%s', _user_id, _old_day, _old_time, _new_day, _new_time))
  ) INTO queued_id;

  RETURN queued_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_global_notification(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_send_recurring_time_change(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_global_notification(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_recurring_time_change(uuid,text,text,text,text,text) TO authenticated;
