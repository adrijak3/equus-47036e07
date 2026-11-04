-- Keep automatic subscription reminders accurate after removing automatic pausing.
BEGIN;
CREATE OR REPLACE FUNCTION public.queue_subscription_requirement_warning(_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_deadline_local timestamp;
  v_deadline_tz timestamptz;
  v_email text;
  v_name text;
  v_notification_id uuid;
  v_event_id uuid;
BEGIN
  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR SHARE;

  IF NOT FOUND
     OR v_booking.user_id IS NULL
     OR v_booking.status <> 'active'
     OR v_booking.subscription_id IS NOT NULL
     OR v_booking.counts_in_subscription IS FALSE
     OR v_booking.is_paused_for_subscription
     OR v_booking.slot_date < DATE '2026-10-18'
     OR public.booking_is_permanent(v_booking.id)
  THEN
    RETURN NULL;
  END IF;

  IF public.has_role(v_booking.user_id, 'admin')
     OR public.is_subscription_rule_exempt(v_booking.user_id)
  THEN
    RETURN NULL;
  END IF;

  IF public.booking_subscription_is_usable_for_slot(
    v_booking.user_id,
    v_booking.slot_date,
    v_booking.slot_time
  ) THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = v_booking.user_id
      AND b.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
      AND b.status = 'active'
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS NOT FALSE
      AND b.is_paused_for_subscription = false
      AND NOT public.booking_is_permanent(b.id)
      AND (
        b.slot_date < v_booking.slot_date
        OR (b.slot_date = v_booking.slot_date AND b.slot_time < v_booking.slot_time)
        OR (
          b.slot_date = v_booking.slot_date
          AND b.slot_time = v_booking.slot_time
          AND b.id < v_booking.id
        )
      )
  ) THEN
    RETURN NULL;
  END IF;

  v_deadline_local := (v_booking.slot_date - 2) + time '20:00';
  v_deadline_tz := v_deadline_local AT TIME ZONE 'Europe/Vilnius';

  SELECT u.email
    INTO v_email
  FROM auth.users u
  WHERE u.id = v_booking.user_id;

  SELECT p.full_name
    INTO v_name
  FROM public.profiles p
  WHERE p.id = v_booking.user_id;

  IF v_email IS NOT NULL THEN
    INSERT INTO public.email_events(
      event_key,
      event_type,
      user_id,
      email,
      booking_id,
      payload,
      status
    )
    VALUES(
      'subscription_requirement_warning:' || v_booking.id::text,
      'subscription_requirement_warning',
      v_booking.user_id,
      v_email,
      v_booking.id,
      jsonb_build_object(
        'booking_date', v_booking.slot_date,
        'booking_time', v_booking.slot_time,
        'deadline', v_deadline_tz,
        'client_name', COALESCE(v_name, '')
      ),
      'pending'
    )
    ON CONFLICT(event_key) DO NOTHING
    RETURNING id INTO v_event_id;
  END IF;

  SELECT public.queue_equus_notification(
    v_booking.user_id,
    'SUBSCRIPTION_REQUIRED',
    'Abonementas reikalingas būsimoms treniruotėms',
    'A subscription is required for future training',
    format(
      'Jūsų artimiausia treniruotė yra %s %s. Abonementą reikia įsigyti iki %s 20:00 val. Esamos rezervacijos nebus ištrintos, tačiau naujoms registracijoms reikės galiojančio abonemento.',
      to_char(v_booking.slot_date, 'DD.MM'),
      to_char(v_booking.slot_time, 'HH24:MI'),
      to_char(v_booking.slot_date - 2, 'DD.MM')
    ),
    format(
      'Your next training is on %s at %s. A subscription is required by %s at 20:00. Existing reservations will not be deleted, but a valid subscription will be required for new bookings.',
      to_char(v_booking.slot_date, 'DD.MM'),
      to_char(v_booking.slot_time, 'HH24:MI'),
      to_char(v_booking.slot_date - 2, 'DD.MM')
    ),
    '/grafikas',
    'subscription-requirement:' || v_booking.id::text
  )
  INTO v_notification_id;

  RETURN COALESCE(v_event_id, v_notification_id);
END;
$function$;
COMMIT;