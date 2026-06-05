
-- Restore missing triggers (functions exist but triggers were never attached)
DROP TRIGGER IF EXISTS trg_permanent_slot_insert ON public.permanent_slots;
CREATE TRIGGER trg_permanent_slot_insert
AFTER INSERT ON public.permanent_slots
FOR EACH ROW EXECUTE FUNCTION public.on_permanent_slot_insert();

DROP TRIGGER IF EXISTS trg_apply_sickness_credit ON public.cancellation_requests;
CREATE TRIGGER trg_apply_sickness_credit
AFTER INSERT OR UPDATE ON public.cancellation_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_sickness_credit();

DROP TRIGGER IF EXISTS trg_promote_from_waiting_list ON public.bookings;
CREATE TRIGGER trg_promote_from_waiting_list
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.promote_from_waiting_list();

DROP TRIGGER IF EXISTS trg_enforce_horse_daily_limit ON public.horse_assignments;
CREATE TRIGGER trg_enforce_horse_daily_limit
BEFORE INSERT OR UPDATE ON public.horse_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_horse_daily_limit();

DROP TRIGGER IF EXISTS trg_enforce_day_notes_limit ON public.day_notes;
CREATE TRIGGER trg_enforce_day_notes_limit
BEFORE INSERT ON public.day_notes
FOR EACH ROW EXECUTE FUNCTION public.enforce_day_notes_limit();

-- Allow admins to update any profile (rename users)
DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;
CREATE POLICY "Admins update any profile" ON public.profiles
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Backfill: materialize permanent bookings for next 12 weeks
SELECT public.materialize_permanent_bookings(
  (now() AT TIME ZONE 'Europe/Vilnius')::date,
  ((now() AT TIME ZONE 'Europe/Vilnius')::date + INTERVAL '12 weeks')::date
);
