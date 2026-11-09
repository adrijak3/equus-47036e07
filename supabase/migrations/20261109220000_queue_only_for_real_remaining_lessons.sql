-- Queue only if the earlier subscription genuinely has uncommitted lessons.
CREATE OR REPLACE FUNCTION public.queue_subscription_behind_current_package()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.paid IS TRUE
     AND NEW.cancelled_at IS NULL
     AND COALESCE(NEW.start_pending, false) IS NOT TRUE
     AND EXISTS (
       SELECT 1
       FROM public.subscriptions current_sub
       WHERE current_sub.user_id = NEW.user_id
         AND current_sub.id IS DISTINCT FROM NEW.id
         AND current_sub.paid IS TRUE
         AND current_sub.cancelled_at IS NULL
         AND COALESCE(current_sub.start_pending, false) IS FALSE
         AND current_sub.start_from_date IS NOT NULL
         AND current_sub.expires_at IS NOT NULL
         AND public.subscription_committed_lessons(current_sub.id) < current_sub.lessons_total
     )
  THEN
    NEW.start_pending := true;
    NEW.start_from_date := NULL;
    NEW.expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
