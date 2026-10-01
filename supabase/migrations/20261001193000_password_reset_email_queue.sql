-- EQUUS — PASSWORD RESET EMAIL QUEUE SUPPORT

ALTER TABLE public.email_events
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS email_events_password_reset_idx
  ON public.email_events (event_type, created_at DESC);

COMMENT ON COLUMN public.email_events.payload IS
  'Event-specific payload. Password reset events contain the one-time recovery URL and are consumed only by the server email worker.';
