ALTER TABLE public.slot_notes DROP CONSTRAINT IF EXISTS slot_notes_weekly_chk;
ALTER TABLE public.slot_notes ADD CONSTRAINT slot_notes_weekly_chk CHECK (
  recurrence = 'once'
  OR (recurrence = 'weekly' AND day_of_week BETWEEN 1 AND 7)
);