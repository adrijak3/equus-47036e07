-- Immediate nonbreaking protection deployed 2026-11-12.
-- Stops unrestricted access to historical rider bookings while the client migrates.
-- PUBLIC retains a short current booking window until the sanitized RPC is deployed to production.
ALTER POLICY "Bookings select" ON public.bookings USING (
  slot_date BETWEEN (CURRENT_DATE - 14) AND (CURRENT_DATE + 21)
  OR public.owns_profile(auth.uid(), user_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'trainer'::public.app_role)
);
ALTER POLICY "Waiting list select" ON public.waiting_list USING (
  slot_date BETWEEN (CURRENT_DATE - 14) AND (CURRENT_DATE + 21)
  OR public.owns_profile(auth.uid(), user_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'trainer'::public.app_role)
);
ALTER POLICY "Horse assigns publicly readable" ON public.horse_assignments USING (
  slot_date BETWEEN (CURRENT_DATE - 14) AND (CURRENT_DATE + 21)
  OR public.owns_profile(auth.uid(), user_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'trainer'::public.app_role)
);