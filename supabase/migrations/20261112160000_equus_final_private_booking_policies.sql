-- FINAL STAGE ONLY: do not apply before the revised Cloudflare production
-- frontend calls get_schedule_*_safe RPCs. The first stage already lives in
-- Supabase production; this migration closes the remaining public row access.
--
-- Keeps each rider's own records accessible and retains staff access.
-- Public timetable occupancy continues through sanitized SECURITY DEFINER RPCs.
BEGIN;
DROP POLICY IF EXISTS "Bookings select" ON public.bookings;
DROP POLICY IF EXISTS "Waiting list select" ON public.waiting_list;
DROP POLICY IF EXISTS "Permanent slots select" ON public.permanent_slots;
DROP POLICY IF EXISTS "Horse assigns publicly readable" ON public.horse_assignments;

-- Existing SELECT policies for bookings/waiting_list/permanent_slots
-- already permit owners and authorized staff. Horse assignments need
-- a matching owner policy when the public-read policy disappears.
CREATE POLICY "Riders view own horse assignments"
ON public.horse_assignments
FOR SELECT TO authenticated
USING (
  public.owns_profile(auth.uid(), user_id)
  OR EXISTS (
    SELECT 1 FROM public.bookings AS booking
    WHERE booking.id = horse_assignments.booking_id
      AND public.owns_profile(auth.uid(), booking.user_id)
  )
);
COMMIT;
