CREATE TABLE public.user_hidden_subscriptions (
  viewer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_hidden_subscriptions_pkey PRIMARY KEY (viewer_user_id, subscription_id)
);
ALTER TABLE public.user_hidden_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own hidden subscription preferences" ON public.user_hidden_subscriptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = viewer_user_id);
CREATE POLICY "Hide subscription in own account" ON public.user_hidden_subscriptions
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = viewer_user_id);
CREATE POLICY "Restore subscription in own account" ON public.user_hidden_subscriptions
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = viewer_user_id);
GRANT SELECT, INSERT, DELETE ON public.user_hidden_subscriptions TO authenticated;
COMMENT ON TABLE public.user_hidden_subscriptions IS 'Per-login display preferences only; does not alter lessons, payments, or subscription records.';
