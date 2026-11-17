-- Equus rider inbox + push events. Never let a notification failure block a booking.
CREATE OR REPLACE FUNCTION public.equus_publish_rider_notice(
  _user_id uuid, _kind text, _title_lt text, _title_en text,
  _body_lt text, _body_en text, _url text, _key text, _push boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user_id IS NULL OR _key IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.important_notifications(
      user_id, notification_type, title_lt, title_en, body_lt, body_en, url, dedupe_key
    ) VALUES (_user_id, _kind, _title_lt, _title_en, _body_lt, _body_en,
              COALESCE(_url,'/grafikas'), _key)
    ON CONFLICT (user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Equus in-app notice %: %', _key, SQLERRM;
  END;
  IF _push THEN
    BEGIN
      PERFORM public.queue_push_notification(
        _user_id,_kind,_title_lt,_title_en,_body_lt,_body_en,COALESCE(_url,'/grafikas'),_key
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Equus push notice %: %', _key, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.equus_publish_rider_notice(uuid,text,text,text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.equus_subscription_notice_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  left_count integer;
BEGIN
  IF NEW.user_id IS NULL OR NEW.cancelled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.paid IS TRUE
     AND (TG_OP='INSERT' OR OLD.paid IS DISTINCT FROM true)
  THEN
    PERFORM public.equus_publish_rider_notice(
      NEW.user_id,'subscription_confirmed',
      'Jūsų abonementas patvirtintas','Your lesson package is confirmed',
      format('Patvirtintas %s treniruočių abonementas. Informaciją rasite paskyroje.',NEW.lessons_total),
      format('Your %s-lesson package is confirmed. Details are in your account.',NEW.lessons_total),
      '/mano-abonementai','subscription-confirmed:'||NEW.id::text
    );
  END IF;
  left_count := GREATEST(0,COALESCE(NEW.lessons_total,0)-COALESCE(NEW.lessons_used,0));
  IF NEW.paid IS TRUE AND left_count = 1
     AND (TG_OP='INSERT' OR COALESCE(OLD.lessons_total,0)-COALESCE(OLD.lessons_used,0)>1)
  THEN
    PERFORM public.equus_publish_rider_notice(
      NEW.user_id,'subscription_ending',
      'Abonemente liko viena treniruotė','One lesson left in your package',
      'Jūsų abonemente liko viena treniruotė. Likutį ir galiojimo datą rasite paskyroje.',
      'You have one lesson left in your package. Check the remaining balance and expiry date in your account.',
      '/mano-abonementai','subscription-ending:'||NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_equus_subscription_rider_notice ON public.subscriptions;
CREATE TRIGGER trg_equus_subscription_rider_notice
AFTER INSERT OR UPDATE OF paid,lessons_used,lessons_total,cancelled_at ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.equus_subscription_notice_trg();

CREATE OR REPLACE FUNCTION public.equus_waitlist_inbox_notice_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('equus.waitlist_promotion',true)='true' AND NEW.status='active' THEN
    PERFORM public.equus_publish_rider_notice(
      NEW.user_id,'waitlist_promoted','Vieta treniruotėje patvirtinta','Your lesson place is confirmed',
      format('Atsilaisvino vieta %s, %s val. Jūsų registracija patvirtinta!',to_char(NEW.slot_date,'YYYY-MM-DD'),to_char(NEW.slot_time,'HH24:MI')),
      format('A place opened on %s at %s. Your lesson is confirmed!',to_char(NEW.slot_date,'YYYY-MM-DD'),to_char(NEW.slot_time,'HH24:MI')),
      '/grafikas','waitlist-promoted:'||NEW.id::text, false
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_equus_waitlist_inbox_notice ON public.bookings;
CREATE TRIGGER trg_equus_waitlist_inbox_notice AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.equus_waitlist_inbox_notice_trg();

CREATE OR REPLACE FUNCTION public.equus_admin_cancel_notice_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status='active' AND NEW.status='cancelled'
     AND auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'admin'::public.app_role)
     AND NEW.user_id IS NOT NULL
  THEN
    PERFORM public.equus_publish_rider_notice(
      NEW.user_id,'admin_cancelled',
      'Administracija atšaukė treniruotę','Your lesson was cancelled by the school',
      format('Administracija atšaukė Jūsų %s d. %s val. treniruotę. Patikrinkite grafiką.',to_char(NEW.slot_date,'YYYY-MM-DD'),to_char(NEW.slot_time,'HH24:MI')),
      format('The school cancelled your lesson on %s at %s. Check the schedule.',to_char(NEW.slot_date,'YYYY-MM-DD'),to_char(NEW.slot_time,'HH24:MI')),
      '/grafikas','admin-cancelled:'||NEW.id::text,false
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_equus_admin_cancel_inbox ON public.bookings;
CREATE TRIGGER trg_equus_admin_cancel_inbox AFTER UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.equus_admin_cancel_notice_trg();

CREATE OR REPLACE FUNCTION public.equus_queue_subscription_expiry_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; total integer := 0;
BEGIN
  FOR r IN
    SELECT s.id,s.user_id,s.expires_at,s.lessons_total,s.lessons_used
    FROM public.subscriptions s
    WHERE s.paid IS TRUE AND s.cancelled_at IS NULL AND s.start_pending IS NOT TRUE
      AND s.expires_at BETWEEN (now() AT TIME ZONE 'Europe/Vilnius')::date
                           AND (now() AT TIME ZONE 'Europe/Vilnius')::date + 5
      AND COALESCE(s.lessons_total,0)>COALESCE(s.lessons_used,0)
  LOOP
    PERFORM public.equus_publish_rider_notice(
      r.user_id,'subscription_expiring',
      'Abonementas netrukus baigsis','Your lesson package expires soon',
      format('Jūsų abonementas galioja iki %s. Liko %s tren.',r.expires_at,GREATEST(0,r.lessons_total-r.lessons_used)),
      format('Your lesson package expires on %s. %s lessons remaining.',r.expires_at,GREATEST(0,r.lessons_total-r.lessons_used)),
      '/mano-abonementai','subscription-expiry:'||r.id::text
    );
    total := total+1;
  END LOOP;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.equus_queue_subscription_expiry_notices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equus_queue_subscription_expiry_notices() TO service_role;
