CREATE TABLE IF NOT EXISTS public.bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  error_name text NOT NULL,
  error_message text NOT NULL,
  error_code text,
  page_path text NOT NULL,
  stack_trace text,
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_agent text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'investigating', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bug_reports_created_at_idx
  ON public.bug_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx
  ON public.bug_reports (status);

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit bug reports" ON public.bug_reports;
CREATE POLICY "Anyone can submit bug reports"
  ON public.bug_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(fingerprint) BETWEEN 1 AND 500
    AND length(error_name) BETWEEN 1 AND 120
    AND length(error_message) BETWEEN 1 AND 1500
    AND length(page_path) BETWEEN 1 AND 300
    AND occurrence_count >= 3
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can read bug reports" ON public.bug_reports;
CREATE POLICY "Admins can read bug reports"
  ON public.bug_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update bug reports" ON public.bug_reports;
CREATE POLICY "Admins can update bug reports"
  ON public.bug_reports FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT INSERT ON public.bug_reports TO anon, authenticated;
GRANT SELECT, UPDATE ON public.bug_reports TO authenticated;
