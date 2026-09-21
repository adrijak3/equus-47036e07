-- Equus notification preferences, important updates and reliable waiting-list promotion.
-- This migration is intentionally additive and keeps trainer notifications disabled.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_lesson_reminder_hours smallint NOT NULL DEFAULT 24;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_notify_lesson_reminder_hours_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_notify_lesson_reminder_hours_check
  CHECK (notify_lesson_reminder_hours IN (5, 24));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences_version integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_dedupe_key_uniq
  ON public.notification_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Central queue helper. Important Equus updates do not consult the rider's
-- optional reminder preference.
CREATE OR REPLACE FUNCTION public.queue_equus_notification(
  _user_id uuid,
  _kind text,
  _title_lt text,
  _title_en text,
  _body_lt text,
  _body_en text,
  _url text DEFAULT '/grafikas',
  _dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notification_queue (
    user_id, kind, title_lt, title_en, body_lt, body_en, url, dedupe_key
  )
  VALUES (
    _user_id, _kind, _title_lt, _title_en, _body_lt, _body_en,
    COALESCE(_url, '/grafikas'), _dedupe_key
  )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO queued_id;

  RETURN queued_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_equus_notification(
  uuid, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;

-- Optional training reminders: 5h or 24h. Runs from the scheduled
-- push-notifications worker and is idempotent through dedupe_key.
CREATE OR REPLACE FUNCTION public.queue_training_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local_now timestamp := (now() AT TIME ZONE 'Europe/Vilnius');
  queued_count integer := 0;
  r record;
  booking_local timestamp;
  hours_before integer;
  queued_id uuid;
BEGIN
  FOR r IN
    SELECT
      b.id,
      b.user_id,
      b.slot_date,
      b.slot_time,
      p.notify_lesson_reminders,
      p.notify_lesson_reminder_hours
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.user_id
    WHERE b.user_id IS NOT NULL
      AND b.status = 'active'
      AND p.notify_lesson_reminders = true
      AND p.notify_lesson_reminder_hours IN (5, 24)
      AND b.slot_date >= (local_now::date)
  LOOP
    booking_local := r.slot_date + r.slot_time;
    hours_before := r.notify_lesson_reminder_hours;

    IF booking_local BETWEEN
         local_now + make_interval(hours => hours_before) - interval '3 minutes'
         AND
         local_now + make_interval(hours => hours_before) + interval '3 minutes'
    THEN
      SELECT public.queue_equus_notification(
        r.user_id,
        'TRAINING_REMINDER',
        'Primename apie treniruotę 🐴',
        'Training reminder 🐴',
        format('Jūsų treniruotė %s %s.', to_char(booking_local, 'DD.MM'), to_char(booking_local, 'HH24:MI')),
        format('Your training is on %s at %s.', to_char(booking_local, 'DD.MM'), to_char(booking_local, 'HH24:MI')),
        '/grafikas',
        format('training-reminder:%s:%s', r.id, hours_before)
      ) INTO queued_id;

      IF queued_id IS NOT NULL THEN
        queued_count := queued_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN queued_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_training_reminders() FROM PUBLIC, anon, authenticated;

-- Important booking updates: cancellation and movement are always queued.
CREATE OR REPLACE FUNCTION public.notify_booking_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF OLD.status = 'active' AND NEW.status = 'cancelled' THEN
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
$$;

DROP TRIGGER IF EXISTS trg_equus_booking_notifications ON public.bookings;
CREATE TRIGGER trg_equus_booking_notifications
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.notify_booking_change();

REVOKE EXECUTE ON FUNCTION public.notify_booking_change() FROM PUBLIC, anon, authenticated;

-- Reliable waiting-list promotion.
-- The old implementation could race when multiple cancellations touched the
-- same slot and it did not notify the promoted rider. This version locks the
-- slot for the transaction, respects slot capacity/overrides, and queues the
-- promotion notification only after a booking is actually created.
CREATE OR REPLACE FUNCTION public.promote_from_waiting_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slot_date_value date;
  slot_time_value time;
  capacity integer;
  active_count integer;
  next_id uuid;
  next_user uuid;
  promoted_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active' THEN
    slot_date_value := OLD.slot_date;
    slot_time_value := OLD.slot_time;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    slot_date_value := OLD.slot_date;
    slot_time_value := OLD.slot_time;
  ELSE
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(slot_date_value::text || '|' || slot_time_value::text)
  );

  SELECT COALESCE(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = slot_date_value
        AND so.slot_time = slot_time_value
      LIMIT 1
    ),
    (
      SELECT ts.max_capacity
      FROM public.time_slots ts
      WHERE ts.slot_time = slot_time_value
        AND ts.active = true
        AND (ts.one_off_date = slot_date_value OR ts.one_off_date IS NULL)
      ORDER BY (ts.one_off_date IS NULL), ts.one_off_date DESC
      LIMIT 1
    ),
    1
  ) INTO capacity;

  SELECT count(*) INTO active_count
  FROM public.bookings b
  WHERE b.slot_date = slot_date_value
    AND b.slot_time = slot_time_value
    AND b.status IN ('active', 'pending_cancel');

  WHILE active_count < capacity LOOP
    next_id := NULL;
    next_user := NULL;

    SELECT wl.id, wl.user_id
      INTO next_id, next_user
    FROM public.waiting_list wl
    WHERE wl.slot_date = slot_date_value
      AND wl.slot_time = slot_time_value
    ORDER BY wl.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    EXIT WHEN next_id IS NULL;

    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.user_id = next_user
        AND b.slot_date = slot_date_value
        AND b.slot_time = slot_time_value
        AND b.status IN ('active', 'pending_cancel')
    ) THEN
      DELETE FROM public.waiting_list WHERE id = next_id;
      CONTINUE;
    END IF;

    promoted_id := NULL;

    INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
    VALUES (next_user, slot_date_value, slot_time_value, 'active')
    ON CONFLICT DO NOTHING
    RETURNING id INTO promoted_id;

    IF promoted_id IS NOT NULL THEN
      DELETE FROM public.waiting_list WHERE id = next_id;

      PERFORM public.queue_equus_notification(
        next_user,
        'WAITLIST_PROMOTED',
        'Atsirado vieta treniruotei 🐴',
        'A training place opened 🐴',
        format('Jūs automatiškai perkelti iš laukiančiųjų sąrašo į %s %s.', to_char(slot_date_value, 'DD.MM'), to_char(slot_time_value, 'HH24:MI')),
        format('You were automatically moved from the waiting list into the %s %s training.', to_char(slot_date_value, 'DD.MM'), to_char(slot_time_value, 'HH24:MI')),
        '/grafikas',
        format('waitlist-promoted:%s:%s:%s', next_user, slot_date_value, slot_time_value)
      );

      active_count := active_count + 1;
    ELSE
      DELETE FROM public.waiting_list WHERE id = next_id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_after_cancel ON public.bookings;
DROP TRIGGER IF EXISTS trg_promote_from_waiting_list ON public.bookings;
CREATE TRIGGER trg_promote_after_cancel
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.promote_from_waiting_list();

REVOKE EXECUTE ON FUNCTION public.promote_from_waiting_list() FROM PUBLIC, anon, authenticated;

-- Trainer day cancellation: notify affected booked riders as an important update.
-- The existing UI intentionally stores day cancellations separately from booking
-- rows, so this does not mutate bookings or accidentally promote waitlisted riders.
CREATE OR REPLACE FUNCTION public.notify_day_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT b.user_id
    FROM public.bookings b
    WHERE b.user_id IS NOT NULL
      AND b.slot_date = NEW.note_date
      AND b.status IN ('active', 'pending_cancel')
      AND (NEW.trainer_name IS NULL OR b.trainer_name = NEW.trainer_name)
  LOOP
    PERFORM public.queue_equus_notification(
      r.user_id,
      'DAY_CANCELLED',
      'Treniruotės šią dieną atšauktos',
      'Training cancelled for this day',
      CASE
        WHEN NEW.trainer_name IS NULL
          THEN format('Jūsų treniruotėms %s dieną taikomas atšaukimas.', to_char(NEW.note_date, 'DD.MM'))
        ELSE format('Trenerės %s treniruotės %s dieną atšauktos.', NEW.trainer_name, to_char(NEW.note_date, 'DD.MM'))
      END,
      CASE
        WHEN NEW.trainer_name IS NULL
          THEN format('Your training on %s has been cancelled.', to_char(NEW.note_date, 'DD.MM'))
        ELSE format('Trainer %s has cancelled training on %s.', NEW.trainer_name, to_char(NEW.note_date, 'DD.MM'))
      END,
      '/grafikas',
      format('day-cancelled:%s:%s:%s', NEW.note_date, COALESCE(NEW.trainer_name, '*'), r.user_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equus_day_cancellation_notification ON public.day_cancellations;
CREATE TRIGGER trg_equus_day_cancellation_notification
AFTER INSERT ON public.day_cancellations
FOR EACH ROW
EXECUTE FUNCTION public.notify_day_cancellation();

REVOKE EXECUTE ON FUNCTION public.notify_day_cancellation() FROM PUBLIC, anon, authenticated;

-- New registered users -> notify admins only. Use the role insert trigger
-- because handle_new_user creates the profile before its user role.
CREATE OR REPLACE FUNCTION public.notify_admin_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_user uuid;
  new_name text;
BEGIN
  IF NEW.role <> 'user'::app_role THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO new_name
  FROM public.profiles p
  WHERE p.id = NEW.user_id;

  FOR admin_user IN
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'admin'::app_role
      AND ur.user_id <> NEW.user_id
  LOOP
    PERFORM public.queue_equus_notification(
      admin_user,
      'NEW_USER_REGISTERED',
      'Naujas Equus vartotojas',
      'New Equus user',
      format('Užsiregistravo naujas vartotojas: %s.', COALESCE(new_name, 'Naujas vartotojas')),
      format('A new user registered: %s.', COALESCE(new_name, 'New user')),
      '/admin',
      format('new-user-registered:%s:%s', NEW.user_id, admin_user)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equus_new_user_notification ON public.profiles;
DROP TRIGGER IF EXISTS trg_equus_new_user_role_notification ON public.user_roles;
CREATE TRIGGER trg_equus_new_user_role_notification
AFTER INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_new_user_role();

REVOKE EXECUTE ON FUNCTION public.notify_admin_new_user_role() FROM PUBLIC, anon, authenticated;
