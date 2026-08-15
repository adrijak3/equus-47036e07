DROP POLICY IF EXISTS "Staff can view guest bookings" ON public.bookings;
DROP FUNCTION IF EXISTS public.slot_group_state(date, time without time zone);