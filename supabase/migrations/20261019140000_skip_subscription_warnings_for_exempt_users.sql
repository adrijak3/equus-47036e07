-- Do not send subscription-requirement warning emails to clients exempt
-- from the subscription requirement. Keep a distinct terminal queue status.
ALTER TABLE public.email_events
  DROP CONSTRAINT IF EXISTS email_events_status_check;

ALTER TABLE public.email_events
  ADD CONSTRAINT email_events_status_check
  CHECK (status IN ('pending','processing','sent','delivered','bounced','complained','failed','skipped'));

-- Suppress warnings already queued before a client was added to the exemption list.
UPDATE public.email_events e
SET status = 'skipped',
    last_error = 'Skipped: user is exempt from subscription requirements.',
    processing_started_at = NULL,
    updated_at = now()
WHERE e.event_type = 'subscription_requirement_warning'
  AND e.status IN ('pending', 'processing')
  AND e.user_id IS NOT NULL
  AND public.is_subscription_rule_exempt(e.user_id);
