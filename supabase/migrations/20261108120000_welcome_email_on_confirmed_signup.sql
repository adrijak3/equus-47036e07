-- Queue a single welcome email when a new rider verifies their email.
-- Existing confirmed users are not backfilled, and the email worker remains
-- responsible for sending through the existing Gmail OAuth integration.
CREATE OR REPLACE FUNCTION public.queue_welcome_email_on_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.email IS NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Updating an already-confirmed account must never queue another welcome.
  IF TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Staff accounts are not riding-school newcomers.
  IF lower(NEW.email) IN ('adrija.kalikaite3@gmail.com', 'jojimomokykla@gmail.com') THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.email_events (event_key, event_type, user_id, email, status)
    VALUES ('welcome_new_rider:' || NEW.id::text, 'welcome_new_rider', NEW.id, NEW.email, 'pending')
    ON CONFLICT (event_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- An email-queue outage must never block a user's signup/confirmation.
    RAISE WARNING 'Unable to queue Equus welcome email for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_welcome_email_on_confirmation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS z_queue_welcome_on_confirmed_signup ON auth.users;
CREATE TRIGGER z_queue_welcome_on_confirmed_signup
AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.queue_welcome_email_on_confirmation();
