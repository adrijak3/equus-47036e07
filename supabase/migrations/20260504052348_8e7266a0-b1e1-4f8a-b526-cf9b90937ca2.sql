
ALTER TABLE public.cancellation_requests
  ADD COLUMN IF NOT EXISTS document_url text,
  ADD COLUMN IF NOT EXISTS document_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_deadline date;

-- Storage bucket for cancellation documents (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('cancellation-docs', 'cancellation-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users upload own cancel doc" ON storage.objects;
CREATE POLICY "Users upload own cancel doc" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cancellation-docs' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users read cancel doc" ON storage.objects;
CREATE POLICY "Users read cancel doc" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'trainer'::app_role)
    )
  );

DROP POLICY IF EXISTS "Users delete own cancel doc" ON storage.objects;
CREATE POLICY "Users delete own cancel doc" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- Allow user to update their own cancellation_request to attach the document URL
DROP POLICY IF EXISTS "Users attach doc to own cancel" ON public.cancellation_requests;
CREATE POLICY "Users attach doc to own cancel" ON public.cancellation_requests
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Fix cleanup so it never removes the current month while we're still inside it
CREATE OR REPLACE FUNCTION public.cleanup_old_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  cutoff date;
  removed integer := 0;
BEGIN
  IF EXTRACT(day FROM vilnius_today)::int < 8 THEN
    RETURN 0;
  END IF;
  cutoff := date_trunc('month', vilnius_today)::date;
  WITH del AS (
    DELETE FROM public.bookings WHERE slot_date < cutoff RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$function$;

-- Enforce: max 2 assignments of the same horse on the same date
CREATE OR REPLACE FUNCTION public.enforce_horse_daily_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt
    FROM public.horse_assignments
   WHERE horse_id = NEW.horse_id
     AND slot_date = NEW.slot_date
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF cnt >= 2 THEN
    RAISE EXCEPTION 'HORSE_LIMIT_REACHED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_horse_daily_limit ON public.horse_assignments;
CREATE TRIGGER trg_enforce_horse_daily_limit
  BEFORE INSERT OR UPDATE OF horse_id, slot_date
  ON public.horse_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_horse_daily_limit();
