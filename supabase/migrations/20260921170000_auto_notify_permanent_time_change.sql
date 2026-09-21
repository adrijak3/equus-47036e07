-- Automatically notify a rider when their permanent training time is changed by admin.

CREATE OR REPLACE FUNCTION public.notify_permanent_slot_time_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_day_lt text;
  new_day_lt text;
  old_time text;
  new_time text;
BEGIN
  IF OLD.day_of_week IS NOT DISTINCT FROM NEW.day_of_week
     AND OLD.slot_time IS NOT DISTINCT FROM NEW.slot_time THEN
    RETURN NEW;
  END IF;

  old_day_lt := CASE OLD.day_of_week
    WHEN 1 THEN 'Pirmadienis' WHEN 2 THEN 'Antradienis'
    WHEN 3 THEN 'Trečiadienis' WHEN 4 THEN 'Ketvirtadienis'
    WHEN 5 THEN 'Penktadienis' WHEN 6 THEN 'Šeštadienis'
    WHEN 7 THEN 'Sekmadienis'
  END;

  new_day_lt := CASE NEW.day_of_week
    WHEN 1 THEN 'Pirmadienis' WHEN 2 THEN 'Antradienis'
    WHEN 3 THEN 'Trečiadienis' WHEN 4 THEN 'Ketvirtadienis'
    WHEN 5 THEN 'Penktadienis' WHEN 6 THEN 'Šeštadienis'
    WHEN 7 THEN 'Sekmadienis'
  END;

  old_time := to_char(OLD.slot_time, 'HH24:MI');
  new_time := to_char(NEW.slot_time, 'HH24:MI');

  INSERT INTO public.important_notifications (
    user_id, notification_type, title_lt, title_en, body_lt, body_en, url, dedupe_key
  )
  VALUES (
    NEW.user_id,
    'RECURRING_TIME_CHANGED',
    'Pasikeitė Jūsų nuolatinės treniruotės laikas',
    'Your recurring training time changed',
    format('Jūsų nuolatinės treniruotės laikas pasikeitė: %s %s → %s %s.', old_day_lt, old_time, new_day_lt, new_time),
    format('Your recurring training time changed: %s %s → %s %s.', old_day_lt, old_time, new_day_lt, new_time),
    '/grafikas',
    format('recurring-time-auto:%s:%s:%s:%s:%s:%s', NEW.id, OLD.day_of_week, OLD.slot_time, NEW.day_of_week, NEW.slot_time, extract(epoch from clock_timestamp())::bigint)
  );

  PERFORM public.queue_equus_notification(
    NEW.user_id,
    'RECURRING_TIME_CHANGED',
    'Pasikeitė Jūsų nuolatinės treniruotės laikas',
    'Your recurring training time changed',
    format('Jūsų nuolatinės treniruotės laikas pasikeitė: %s %s → %s %s.', old_day_lt, old_time, new_day_lt, new_time),
    format('Your recurring training time changed: %s %s → %s %s.', old_day_lt, old_time, new_day_lt, new_time),
    '/grafikas',
    format('recurring-time-auto-push:%s:%s:%s:%s:%s:%s', NEW.id, OLD.day_of_week, OLD.slot_time, NEW.day_of_week, NEW.slot_time, extract(epoch from clock_timestamp())::bigint)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_permanent_slot_time_change ON public.permanent_slots;

CREATE TRIGGER trg_notify_permanent_slot_time_change
AFTER UPDATE OF day_of_week, slot_time ON public.permanent_slots
FOR EACH ROW
EXECUTE FUNCTION public.notify_permanent_slot_time_change();

REVOKE EXECUTE ON FUNCTION public.notify_permanent_slot_time_change() FROM PUBLIC, anon, authenticated;
