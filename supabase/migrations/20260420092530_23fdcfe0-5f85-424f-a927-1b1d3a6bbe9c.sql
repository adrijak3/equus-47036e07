-- Restrict permanent_slots INSERT to admins only.
-- Users can still SELECT their own (covered by existing public read policy)
-- and DELETE their own (covered by existing policy).
DROP POLICY IF EXISTS "Users add own permanent slot" ON public.permanent_slots;

CREATE POLICY "Admins add permanent slots"
ON public.permanent_slots
FOR INSERT
TO public
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));