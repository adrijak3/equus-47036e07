-- One-click, user-consented Equus error reports.
-- The existing admin-only read/update policies are retained.
ALTER TABLE public.bug_reports ADD COLUMN IF NOT EXISTS action_context text;
ALTER TABLE public.bug_reports ADD COLUMN IF NOT EXISTS user_notes text;
ALTER TABLE public.bug_reports ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.bug_reports ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();

DROP POLICY IF EXISTS "Anyone can submit bug reports" ON public.bug_reports;
CREATE POLICY "Anyone can submit bug reports"
ON public.bug_reports FOR INSERT TO anon, authenticated
WITH CHECK (
  length(fingerprint) BETWEEN 1 AND 500
  AND length(error_name) BETWEEN 1 AND 120
  AND length(error_message) BETWEEN 1 AND 1500
  AND length(page_path) BETWEEN 1 AND 300
  AND occurrence_count BETWEEN 1 AND 100000
  AND (user_id IS NULL OR user_id = (select auth.uid()))
  AND (error_code IS NULL OR length(error_code) <= 120)
  AND (action_context IS NULL OR length(action_context) <= 240)
  AND (user_notes IS NULL OR length(user_notes) <= 500)
  AND (contact_email IS NULL OR length(contact_email) <= 254)
  AND (user_agent IS NULL OR length(user_agent) <= 500)
  AND occurred_at <= now() + interval '1 day'
  AND occurred_at >= now() - interval '30 days'
);
