-- Drop the absolute unique and replace with a partial one (active rows + non-one-off)
ALTER TABLE public.time_slots DROP CONSTRAINT IF EXISTS time_slots_day_of_week_slot_time_key;

-- Recurring (no one_off_date) active rows must be unique per (day, time)
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_slots_active_recurring
  ON public.time_slots (day_of_week, slot_time)
  WHERE active = true AND one_off_date IS NULL;

-- One-off active rows unique per (date, time)
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_slots_active_oneoff
  ON public.time_slots (one_off_date, slot_time)
  WHERE active = true AND one_off_date IS NOT NULL;
