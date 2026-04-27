CREATE POLICY "Users delete own subs"
ON public.subscriptions FOR DELETE
USING (auth.uid() = user_id);