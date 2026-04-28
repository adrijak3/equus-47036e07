
-- Add one-off date support to time_slots (so admins can add a slot for a single week only)
ALTER TABLE public.time_slots
  ADD COLUMN IF NOT EXISTS one_off_date date;

CREATE INDEX IF NOT EXISTS idx_time_slots_one_off_date ON public.time_slots(one_off_date) WHERE one_off_date IS NOT NULL;

-- Add display_name to profiles so users can control how they appear in the schedule
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text;
