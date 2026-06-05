
-- BOOKINGS: restrict SELECT
DROP POLICY IF EXISTS "Bookings publicly readable" ON public.bookings;
CREATE POLICY "Users view own bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (
    public.owns_profile(auth.uid(), user_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'trainer'::app_role)
  );

-- PROFILES: authenticated only
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
CREATE POLICY "Authenticated read profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (true);

-- PERMANENT_SLOTS: authenticated only
DROP POLICY IF EXISTS "Permanent slots publicly readable" ON public.permanent_slots;
CREATE POLICY "Users view own or staff all permanent_slots" ON public.permanent_slots
  FOR SELECT TO authenticated
  USING (
    public.owns_profile(auth.uid(), user_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'trainer'::app_role)
  );

-- WAITING_LIST: authenticated only
DROP POLICY IF EXISTS "Waiting list readable" ON public.waiting_list;
CREATE POLICY "Users view own or staff all waiting_list" ON public.waiting_list
  FOR SELECT TO authenticated
  USING (
    public.owns_profile(auth.uid(), user_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'trainer'::app_role)
  );

-- USER_ROLES: restrict SELECT + RESTRICTIVE write
DROP POLICY IF EXISTS "Roles readable by everyone" ON public.user_roles;
CREATE POLICY "Users view own roles, admins all" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins write roles" ON public.user_roles
  AS RESTRICTIVE
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Revoke anon access from tables
REVOKE SELECT ON public.bookings, public.profiles, public.permanent_slots, public.waiting_list, public.user_roles FROM anon;

-- STORAGE: add UPDATE policy for cancellation-docs
DROP POLICY IF EXISTS "Owner updates cancellation docs" ON storage.objects;
CREATE POLICY "Owner updates cancellation docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cancellation-docs' AND split_part(name, '/', 1) = auth.uid()::text)
  WITH CHECK (bucket_id = 'cancellation-docs' AND split_part(name, '/', 1) = auth.uid()::text);

-- Lock down SECURITY DEFINER helpers (keep has_role / owns_profile usable by authenticated for RLS)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.owns_profile(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_bookings() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_day_notes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_subscriptions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_conversations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_makeup_cancellations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM anon, authenticated;
