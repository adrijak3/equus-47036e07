-- Allow admins to insert bookings for any user (force-add from Grafikas dialog)
CREATE POLICY "Admins create bookings for anyone"
ON public.bookings
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));