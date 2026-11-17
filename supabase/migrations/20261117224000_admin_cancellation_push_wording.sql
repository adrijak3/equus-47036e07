CREATE OR REPLACE FUNCTION public.queue_booking_push_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  display_name text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Equus')
    INTO display_name
    FROM public.profiles p
   WHERE p.id = NEW.user_id;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'admin'::public.app_role) THEN
      PERFORM public.queue_push_notification(
        NEW.user_id,'admin_cancelled','Administracija atšaukė treniruotę',
        'Your lesson was cancelled by the school',
        format('Administracija atšaukė Jūsų %s d. %s val. treniruotę.',NEW.slot_date,to_char(NEW.slot_time,'HH24:MI')),
        format('The school cancelled your lesson on %s at %s.',NEW.slot_date,to_char(NEW.slot_time,'HH24:MI')),
        '/grafikas','booking-cancelled:' || NEW.id
      );
    ELSE
      PERFORM public.queue_push_notification(
        NEW.user_id,'training_cancelled','Treniruotė atšaukta','Training cancelled',
        format('%s · %s atšaukta.',NEW.slot_date,to_char(NEW.slot_time,'HH24:MI')),
        format('%s · %s was cancelled.',NEW.slot_date,to_char(NEW.slot_time,'HH24:MI')),
        '/grafikas','booking-cancelled:' || NEW.id
      );
    END IF;
  ELSIF NEW.status = 'active'
        AND (OLD.slot_date IS DISTINCT FROM NEW.slot_date OR OLD.slot_time IS DISTINCT FROM NEW.slot_time) THEN
    PERFORM public.queue_push_notification(
      NEW.user_id,
      'training_time_changed',
      'Treniruotės laikas pakeistas',
      'Training time changed',
      format('Jūsų treniruotė perkelta į %s · %s.', NEW.slot_date, to_char(NEW.slot_time, 'HH24:MI')),
      format('Your training was moved to %s · %s.', NEW.slot_date, to_char(NEW.slot_time, 'HH24:MI')),
      '/grafikas',
      'booking-moved:' || NEW.id || ':' || NEW.slot_date::text || ':' || NEW.slot_time::text
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_booking_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_user uuid;
BEGIN
  target_user := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;

  IF target_user IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN
      PERFORM public.queue_equus_notification(
        target_user,
        'BOOKING_CANCELLED',
        'Treniruotė atšaukta',
        'Training cancelled',
        format('Jūsų treniruotė %s %s buvo atšaukta.', to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI')),
        format('Your training on %s at %s was cancelled.', to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI')),
        '/grafikas',
        format('booking-cancelled:%s', OLD.id)
      );
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.status = 'active' AND NEW.status = 'cancelled'
     AND NOT (auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'admin'::public.app_role))
  THEN
    PERFORM public.queue_equus_notification(
      target_user,
      'BOOKING_CANCELLED',
      'Treniruotė atšaukta',
      'Training cancelled',
      format('Jūsų treniruotė %s %s buvo atšaukta.', to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI')),
      format('Your training on %s at %s was cancelled.', to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI')),
      '/grafikas',
      format('booking-cancelled:%s:%s', OLD.id, NEW.updated_at)
    );
  ELSIF OLD.status = 'active'
        AND NEW.status = 'active'
        AND (
          OLD.slot_date IS DISTINCT FROM NEW.slot_date
          OR OLD.slot_time IS DISTINCT FROM NEW.slot_time
        )
  THEN
    PERFORM public.queue_equus_notification(
      target_user,
      'BOOKING_MOVED',
      'Treniruotė perkelta',
      'Training moved',
      format(
        'Jūsų treniruotė perkelta iš %s %s į %s %s.',
        to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI'),
        to_char(NEW.slot_date, 'DD.MM'), to_char(NEW.slot_time, 'HH24:MI')
      ),
      format(
        'Your training was moved from %s at %s to %s at %s.',
        to_char(OLD.slot_date, 'DD.MM'), to_char(OLD.slot_time, 'HH24:MI'),
        to_char(NEW.slot_date, 'DD.MM'), to_char(NEW.slot_time, 'HH24:MI')
      ),
      '/grafikas',
      format('booking-moved:%s:%s:%s:%s', NEW.id, NEW.slot_date, NEW.slot_time, NEW.updated_at)
    );
  END IF;

  RETURN NULL;
END;
$function$;