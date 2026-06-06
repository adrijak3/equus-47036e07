
-- Restore public read on schedule tables
DROP POLICY IF EXISTS "Bookings select" ON public.bookings;
CREATE POLICY "Bookings select" ON public.bookings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permanent slots select" ON public.permanent_slots;
CREATE POLICY "Permanent slots select" ON public.permanent_slots FOR SELECT USING (true);

DROP POLICY IF EXISTS "Waiting list select" ON public.waiting_list;
CREATE POLICY "Waiting list select" ON public.waiting_list FOR SELECT USING (true);

GRANT SELECT ON public.bookings TO anon, authenticated;
GRANT SELECT ON public.permanent_slots TO anon, authenticated;
GRANT SELECT ON public.waiting_list TO anon, authenticated;

-- Allow client to materialize permanent bookings (function is SECURITY DEFINER, safe insert-only)
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO anon, authenticated;
