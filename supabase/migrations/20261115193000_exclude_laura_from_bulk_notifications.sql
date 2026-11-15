-- Bulk announcements can exclude Laura from app/push and email queues.
-- Historical overloads remain unchanged for backward compatibility.

CREATE OR REPLACE FUNCTION public.admin_send_global_email(_title_lt text, _title_en text, _body_lt text, _body_en text, _url text DEFAULT '/grafikas'::text, _dedupe_key text DEFAULT NULL::text, _image_url text DEFAULT NULL::text, _exclude_laura boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (NOT _exclude_laura OR lower(btrim(coalesce(p.full_name,''))) <> 'laura')
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
        'url', COALESCE(_url, '/grafikas'),
        'image_url', NULLIF(trim(COALESCE(_image_url, '')), '')
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_send_global_notification(_title_lt text, _title_en text, _body_lt text, _body_en text, _url text DEFAULT '/grafikas'::text, _dedupe_key text DEFAULT NULL::text, _send_push boolean DEFAULT true, _exclude_laura boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  queued_count integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF _send_push THEN
    FOR r IN
      SELECT p.id
      FROM public.profiles p
      WHERE (NOT _exclude_laura OR lower(btrim(coalesce(p.full_name,''))) <> 'laura')
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

      queued_count := queued_count + 1;
    END LOOP;
  END IF;

  RETURN queued_count;
END;
$function$
;
