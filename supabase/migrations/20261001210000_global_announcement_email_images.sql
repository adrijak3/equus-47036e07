-- EQUUS — GLOBAL ANNOUNCEMENT EMAIL IMAGES
-- Adds an admin-uploaded image to global announcement emails.
-- Images are public because email clients must be able to fetch the embedded image
-- when the message is opened. Only admins can upload/delete files.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'global-announcement-images',
  'global-announcement-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif'];

DROP POLICY IF EXISTS "Admins upload global announcement images" ON storage.objects;
CREATE POLICY "Admins upload global announcement images"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'global-announcement-images'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admins delete global announcement images" ON storage.objects;
CREATE POLICY "Admins delete global announcement images"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'global-announcement-images'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE OR REPLACE FUNCTION public.admin_send_global_email(
  _title_lt text,
  _title_en text,
  _body_lt text,
  _body_en text,
  _url text DEFAULT '/grafikas',
  _dedupe_key text DEFAULT NULL,
  _image_url text DEFAULT NULL
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
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_global_email(text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_global_email(text,text,text,text,text,text,text) TO authenticated;
