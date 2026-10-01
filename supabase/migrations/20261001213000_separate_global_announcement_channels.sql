-- EQUUS — SEPARATE GLOBAL ANNOUNCEMENT CHANNELS
-- Lets admins choose app notification, email, or both.

CREATE OR REPLACE FUNCTION public.admin_send_global_notification(
  _title_lt text,
  _title_en text,
  _body_lt text,
  _body_en text,
  _url text DEFAULT '/grafikas',
  _dedupe_key text DEFAULT NULL,
  _send_push boolean DEFAULT true
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
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
      r.id,
      'GLOBAL_IMPORTANT_UPDATE',
      _title_lt,
      _title_en,
      _body_lt,
      _body_en,
      COALESCE(_url, '/grafikas'),
      CASE WHEN _dedupe_key IS NULL THEN NULL ELSE _dedupe_key || ':' || r.id END
    )
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    IF _send_push THEN
      PERFORM public.queue_equus_notification(
        r.id,
        'GLOBAL_IMPORTANT_UPDATE',
        _title_lt,
        _title_en,
        _body_lt,
        _body_en,
        COALESCE(_url, '/grafikas'),
        CASE WHEN _dedupe_key IS NULL THEN NULL ELSE _dedupe_key || ':' || r.id END
      );
    END IF;

    queued_count := queued_count + 1;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.admin_send_global_notification(text,text,text,text,text,text)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE
ON FUNCTION public.admin_send_global_notification(text,text,text,text,text,text,boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_send_global_notification(text,text,text,text,text,text,boolean)
TO authenticated;
