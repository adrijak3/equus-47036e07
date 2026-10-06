-- Keep every capacity layer consistent with the visible schedule.
-- Subscription-paused bookings do not consume seats and must not affect
-- trainer group limits.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_booking_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cap    int;
  taken  int;
  caller uuid := auth.uid();
  dow    int  := CASE WHEN EXTRACT(DOW FROM NEW.slot_date)::int = 0
                      THEN 7 ELSE EXTRACT(DOW FROM NEW.slot_date)::int END;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  SELECT o.max_capacity INTO cap
    FROM public.slot_overrides o
   WHERE o.slot_date = NEW.slot_date AND o.slot_time = NEW.slot_time
   LIMIT 1;

  IF cap IS NULL THEN
    SELECT ts.max_capacity INTO cap
      FROM public.time_slots ts
     WHERE ts.slot_time = NEW.slot_time
       AND ts.day_of_week = dow
       AND ts.active = true
       AND (NEW.trainer_name IS NULL OR ts.trainer_name IS NOT DISTINCT FROM NEW.trainer_name)
     ORDER BY ts.max_capacity DESC
     LIMIT 1;
  END IF;

  IF cap IS NULL THEN cap := 5; END IF;

  SELECT count(*) INTO taken
    FROM public.bookings b
   WHERE b.slot_date = NEW.slot_date
     AND b.slot_time = NEW.slot_time
     AND b.status = 'active'
     AND b.is_paused_for_subscription IS NOT TRUE
     AND b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name
     AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

  IF taken >= cap THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.enforce_trainer_group_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  dow int := CASE WHEN extract(dow FROM NEW.slot_date)::int = 0 THEN 7 ELSE extract(dow FROM NEW.slot_date)::int END;
  trainer text;
  new_lvl text;
  total int := 0;
  beginners int := 0;
  max_allowed int;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  trainer := NEW.trainer_name;
  IF trainer IS NULL THEN
    SELECT t.trainer_name INTO trainer
      FROM public.time_slots t
     WHERE t.active
       AND t.slot_time = NEW.slot_time
       AND t.trainer_name IS NOT NULL
       AND ((t.one_off_date IS NULL AND t.day_of_week = dow) OR t.one_off_date = NEW.slot_date)
     LIMIT 1;
  END IF;

  -- Dynamic level rules apply only to Jolita's lessons.
  IF trainer IS NULL OR trainer NOT ILIKE '%Jolita%' THEN RETURN NEW; END IF;

  new_lvl := public.trainer_rider_level(trainer, NEW.user_id, NEW.guest_rider_id);

  SELECT count(*), count(*) FILTER (WHERE lvl = 'beginner')
    INTO total, beginners
    FROM (
      SELECT public.trainer_rider_level(trainer, b.user_id, b.guest_rider_id) AS lvl
        FROM public.bookings b
       WHERE b.slot_date = NEW.slot_date
         AND b.slot_time = NEW.slot_time
         AND b.status = 'active'
         AND b.is_paused_for_subscription IS NOT TRUE
         AND b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name
         AND b.id <> NEW.id
    ) x;

  IF new_lvl = 'beginner' THEN beginners := beginners + 1; END IF;
  total := total + 1;

  IF beginners > 2 THEN
    RAISE EXCEPTION 'Šioje treniruotėje jau yra 2 pradedantieji, todėl daugiau pradedančiųjų registruoti negalima.'
      USING ERRCODE = 'check_violation';
  END IF;

  max_allowed := CASE WHEN beginners >= 2 THEN 2 WHEN beginners = 1 THEN 3 ELSE 4 END;

  IF total > max_allowed THEN
    RAISE EXCEPTION 'Grupė pilna — maksimalus dalyvių skaičius yra %.', max_allowed USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.slot_group_state(_slot_date date, _slot_time time without time zone, _trainer_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  dow int := CASE WHEN extract(dow FROM _slot_date)::int = 0 THEN 7 ELSE extract(dow FROM _slot_date)::int END;
  trainer text;
  base_cap int;
  total int := 0;
  beginners int := 0;
  max_allowed int;
BEGIN
  SELECT t.trainer_name, t.max_capacity INTO trainer, base_cap
    FROM public.time_slots t
   WHERE t.active
     AND t.slot_time = _slot_time
     AND ((t.one_off_date IS NULL AND t.day_of_week = dow) OR t.one_off_date = _slot_date)
     AND (_trainer_name IS NULL OR t.trainer_name IS NOT DISTINCT FROM _trainer_name)
   ORDER BY (t.trainer_name IS NULL), t.max_capacity DESC
   LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE lvl = 'beginner')
    INTO total, beginners
    FROM (
      SELECT public.trainer_rider_level(trainer, b.user_id, b.guest_rider_id) AS lvl
        FROM public.bookings b
       WHERE b.slot_date = _slot_date
         AND b.slot_time = _slot_time
         AND b.status = 'active'
         AND b.is_paused_for_subscription IS NOT TRUE
         AND (_trainer_name IS NULL OR b.trainer_name IS NOT DISTINCT FROM _trainer_name)
    ) x;

  IF trainer IS NULL OR trainer NOT ILIKE '%Jolita%' THEN
    max_allowed := COALESCE(base_cap, 5);
    beginners := 0;
  ELSIF beginners >= 2 THEN
    max_allowed := 2;
  ELSIF beginners = 1 THEN
    max_allowed := 3;
  ELSE
    max_allowed := LEAST(4, COALESCE(base_cap, 4));
  END IF;

  RETURN jsonb_build_object(
    'trainer', trainer,
    'total', total,
    'beginners', beginners,
    'max_allowed', max_allowed,
    'base_capacity', COALESCE(base_cap, 5)
  );
END;
$function$;


COMMIT;
