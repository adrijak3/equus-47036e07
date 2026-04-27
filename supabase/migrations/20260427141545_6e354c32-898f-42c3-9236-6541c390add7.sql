-- Daily notes (shared WeTransfer-style links) per slot date
CREATE TABLE public.day_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_date DATE NOT NULL,
  link TEXT NOT NULL,
  label TEXT,
  added_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_day_notes_date ON public.day_notes(note_date);

ALTER TABLE public.day_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Day notes publicly readable"
ON public.day_notes FOR SELECT
USING (true);

CREATE POLICY "Logged in users add day notes"
ON public.day_notes FOR INSERT
WITH CHECK (auth.uid() = added_by);

CREATE POLICY "Adder or admin removes day note"
ON public.day_notes FOR DELETE
USING (auth.uid() = added_by OR has_role(auth.uid(), 'admin'::app_role));

-- Enforce max 15 links per date via trigger (CHECK constraint can't COUNT)
CREATE OR REPLACE FUNCTION public.enforce_day_notes_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*) INTO cnt FROM public.day_notes WHERE note_date = NEW.note_date;
  IF cnt >= 15 THEN
    RAISE EXCEPTION 'MAX_15_LINKS_REACHED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_day_notes_limit
BEFORE INSERT ON public.day_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_day_notes_limit();

-- Cleanup: delete notes whose date is older than 2 days ago (Vilnius TZ)
CREATE OR REPLACE FUNCTION public.cleanup_old_day_notes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.day_notes
     WHERE note_date < (vilnius_today - INTERVAL '2 days')
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;