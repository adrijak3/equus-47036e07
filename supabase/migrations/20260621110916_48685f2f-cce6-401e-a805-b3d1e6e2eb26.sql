
CREATE TABLE public.slot_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  note_date DATE NOT NULL,
  slot_time TIME NULL,
  note TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX slot_notes_unique_per_slot ON public.slot_notes (note_date, COALESCE(slot_time, '00:00:00'::time));
CREATE INDEX slot_notes_date_idx ON public.slot_notes (note_date);

GRANT SELECT ON public.slot_notes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_notes TO authenticated;
GRANT ALL ON public.slot_notes TO service_role;

ALTER TABLE public.slot_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view slot notes"
  ON public.slot_notes FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert slot notes"
  ON public.slot_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update slot notes"
  ON public.slot_notes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete slot notes"
  ON public.slot_notes FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_slot_notes_updated_at
  BEFORE UPDATE ON public.slot_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
