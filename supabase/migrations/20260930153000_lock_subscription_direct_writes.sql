-- Lock subscription financial records to SECURITY DEFINER admin RPCs.
-- Clients may still read subscriptions allowed by existing SELECT policies.
-- Direct INSERT/UPDATE/DELETE from browser roles are intentionally removed.

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Remove every known client/staff direct-write policy from the subscription table.
DROP POLICY IF EXISTS "Users create own subs" ON public.subscriptions;
DROP POLICY IF EXISTS "Admins create subs for anyone" ON public.subscriptions;
DROP POLICY IF EXISTS "Trainer create subs for anyone" ON public.subscriptions;
DROP POLICY IF EXISTS "Users/admin update subs" ON public.subscriptions;
DROP POLICY IF EXISTS "Users update own subs" ON public.subscriptions;
DROP POLICY IF EXISTS "Admin delete subs" ON public.subscriptions;
DROP POLICY IF EXISTS "Users delete own subs" ON public.subscriptions;

-- Keep subscription visibility policies intact.
-- Defense in depth: browser roles cannot directly mutate the table even if
-- another permissive policy is accidentally added later.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscriptions FROM anon, authenticated;

-- SELECT is still required by the existing RLS policies used by the app.
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

COMMENT ON TABLE public.subscriptions IS
  'Subscription financial records. Browser roles are read-only; writes must go through SECURITY DEFINER admin RPCs.';
