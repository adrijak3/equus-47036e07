-- Only administrators may create, remove, or request recurring permanent times.
-- Clients can continue to read their own permanent-slot display, but cannot
-- mutate permanent_slots or create self-service permanent-slot requests.

DROP POLICY IF EXISTS "Users add own permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "Users or admin remove permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "users create own permanent requests" ON public.permanent_slot_requests;

DROP POLICY IF EXISTS "Admins add permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins add permanent slots"
  ON public.permanent_slots FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins remove permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins remove permanent slots"
  ON public.permanent_slots FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.request_or_create_permanent_slot(int, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_or_create_permanent_slot(int, time) TO service_role;
