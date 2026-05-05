
-- 1. Profile linking (joint accounts)
CREATE TABLE IF NOT EXISTS public.profile_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL,
  linked_profile_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_links_parent_idx ON public.profile_links(parent_user_id);

ALTER TABLE public.profile_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parent reads own links" ON public.profile_links
  FOR SELECT USING (auth.uid() = parent_user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manages links" ON public.profile_links
  FOR ALL USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Parent inserts link" ON public.profile_links
  FOR INSERT WITH CHECK (auth.uid() = parent_user_id);

-- Helper: returns true if pid is owned by uid (self or linked)
CREATE OR REPLACE FUNCTION public.owns_profile(_uid uuid, _pid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid = _pid
    OR EXISTS (SELECT 1 FROM public.profile_links WHERE parent_user_id = _uid AND linked_profile_id = _pid);
$$;

-- 2. Update RLS so parent can act on linked profile rows
DROP POLICY IF EXISTS "Users create own bookings" ON public.bookings;
CREATE POLICY "Users create own bookings" ON public.bookings
  FOR INSERT WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users update own bookings" ON public.bookings;
CREATE POLICY "Users update own bookings" ON public.bookings
  FOR UPDATE USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users create own subs" ON public.subscriptions;
CREATE POLICY "Users create own subs" ON public.subscriptions
  FOR INSERT WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users delete own subs" ON public.subscriptions;
CREATE POLICY "Users delete own subs" ON public.subscriptions
  FOR DELETE USING (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users view own subs" ON public.subscriptions;
CREATE POLICY "Users view own subs" ON public.subscriptions
  FOR SELECT USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "Users/admin update subs" ON public.subscriptions;
CREATE POLICY "Users/admin update subs" ON public.subscriptions
  FOR UPDATE USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users create own cancel reqs" ON public.cancellation_requests;
CREATE POLICY "Users create own cancel reqs" ON public.cancellation_requests
  FOR INSERT WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users view own cancel reqs" ON public.cancellation_requests;
CREATE POLICY "Users view own cancel reqs" ON public.cancellation_requests
  FOR SELECT USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users attach doc to own cancel" ON public.cancellation_requests;
CREATE POLICY "Users attach doc to own cancel" ON public.cancellation_requests
  FOR UPDATE USING (owns_profile(auth.uid(), user_id)) WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users join own waiting" ON public.waiting_list;
CREATE POLICY "Users join own waiting" ON public.waiting_list
  FOR INSERT WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Users leave own waiting" ON public.waiting_list;
CREATE POLICY "Users leave own waiting" ON public.waiting_list
  FOR DELETE USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users or admin remove permanent slot" ON public.permanent_slots;
CREATE POLICY "Users or admin remove permanent slot" ON public.permanent_slots
  FOR DELETE USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "User insert own request" ON public.horse_requests;
CREATE POLICY "User insert own request" ON public.horse_requests
  FOR INSERT WITH CHECK (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "User update own request" ON public.horse_requests;
CREATE POLICY "User update own request" ON public.horse_requests
  FOR UPDATE USING (owns_profile(auth.uid(), user_id));

DROP POLICY IF EXISTS "Owner or staff delete request" ON public.horse_requests;
CREATE POLICY "Owner or staff delete request" ON public.horse_requests
  FOR DELETE USING (owns_profile(auth.uid(), user_id) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'trainer'));

-- 3. Messages: remove user delete; only admin/trainer can delete
DROP POLICY IF EXISTS "User deletes own conversation" ON public.messages;
CREATE POLICY "Staff delete conversation" ON public.messages
  FOR DELETE USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'trainer'));

-- 4. Auto cleanup subscriptions older than 3 months past expiration
CREATE OR REPLACE FUNCTION public.cleanup_old_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.subscriptions
     WHERE expires_at < (CURRENT_DATE - INTERVAL '3 months')
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;

-- 5. Trigger on horses: ensure trainer can hard-delete (RLS already allows)
-- nothing to add; just confirm policy exists (already does)
