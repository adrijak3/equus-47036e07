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
    PERFORM public.queue_equus_notification(
      r.id,
      'GLOBAL_IMPORTANT_UPDATE',
      _title_lt,
      _title_en,
      _body_lt,
      _body_en,
      COALESCE(_url, '/grafikas'),
      CASE
        WHEN _dedupe_key IS NULL THEN NULL
        ELSE _dedupe_key || ':' || r.id
      END
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
