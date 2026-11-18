-- A resolution action is silent. Only a separate, explicit administrator action sends a bell notice.
-- Reuse the existing important_notifications inbox; no extra email or push queue.
CREATE OR REPLACE FUNCTION public.admin_send_bug_report_notice(
  _report_id uuid,
  _message text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recipient uuid;
  msg text;
  inserted_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Tik administratorius gali siųsti atsakymą' USING ERRCODE='42501';
  END IF;
  SELECT user_id INTO recipient
  FROM public.bug_reports WHERE id = _report_id;
  IF recipient IS NULL THEN
    RAISE EXCEPTION 'Šiam klaidos pranešimui nėra prisijungusio gavėjo';
  END IF;
  IF length(coalesce(_message,'')) > 500 THEN
    RAISE EXCEPTION 'Žinutė per ilga (daugiausia 500 simbolių)';
  END IF;
  msg := nullif(btrim(coalesce(_message,'')), '');
  IF msg IS NULL THEN
    msg := 'Jūsų pranešta problema išspręsta. Galite pabandyti dar kartą. Ačiū, kad pranešėte!';
  END IF;

  INSERT INTO public.important_notifications(
    user_id, notification_type,
    title_lt, title_en, body_lt, body_en, url, dedupe_key
  ) VALUES (
    recipient, 'bug_report_feedback',
    'Equus: atsakymas dėl Jūsų pranešimo',
    'Equus: update on your report',
    msg,
    CASE WHEN nullif(btrim(coalesce(_message,'')), '') IS NULL
       THEN 'The problem you reported has been fixed. Please try again. Thank you for reporting it!'
       ELSE msg
    END,
    NULL, 'bug-report-feedback:' || _report_id::text
  )
  ON CONFLICT (user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO inserted_id;

  RETURN inserted_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_send_bug_report_notice(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_bug_report_notice(uuid,text) TO authenticated;