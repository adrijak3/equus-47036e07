
CREATE TABLE public.vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacations_range_chk CHECK (ends_on >= starts_on)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vacations TO authenticated;
GRANT ALL ON public.vacations TO service_role;

ALTER TABLE public.vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own vacations"
  ON public.vacations FOR SELECT TO authenticated
  USING (public.owns_profile(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Users insert own vacations"
  ON public.vacations FOR INSERT TO authenticated
  WITH CHECK (public.owns_profile(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users update own vacations"
  ON public.vacations FOR UPDATE TO authenticated
  USING (public.owns_profile(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.owns_profile(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users delete own vacations"
  ON public.vacations FOR DELETE TO authenticated
  USING (public.owns_profile(auth.uid(), user_id) OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_vacations_updated_at
  BEFORE UPDATE ON public.vacations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX vacations_user_range_idx ON public.vacations (user_id, starts_on, ends_on);

-- Recurrence on slot_notes for day-level notes
ALTER TABLE public.slot_notes
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS day_of_week int;

ALTER TABLE public.slot_notes
  DROP CONSTRAINT IF EXISTS slot_notes_recurrence_chk;
ALTER TABLE public.slot_notes
  ADD CONSTRAINT slot_notes_recurrence_chk CHECK (recurrence IN ('once','weekly'));

ALTER TABLE public.slot_notes
  DROP CONSTRAINT IF EXISTS slot_notes_weekly_chk;
ALTER TABLE public.slot_notes
  ADD CONSTRAINT slot_notes_weekly_chk CHECK (
    (recurrence = 'once')
    OR (recurrence = 'weekly' AND day_of_week BETWEEN 1 AND 7 AND slot_time IS NULL)
  );

CREATE INDEX IF NOT EXISTS slot_notes_weekly_idx
  ON public.slot_notes (recurrence, day_of_week) WHERE recurrence = 'weekly';
