CREATE POLICY "Admins create subs for anyone" ON public.subscriptions
FOR INSERT TO public
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Trainer create subs for anyone" ON public.subscriptions
FOR INSERT TO public
WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));