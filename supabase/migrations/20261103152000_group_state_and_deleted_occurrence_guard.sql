-- Equus: use the same configured capacity when returning the lesson status.
-- This fixes mismatches between the settings, calendar, and availability RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.slot_group_state(
  _slot_date date,
  _slot_time time without time zone,
  _trainer_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $equus_group_state$
DECLARE
  dow integer := EXTRACT(ISODOW FROM _slot_date)::integer;
  trainer text;
  base_cap integer;
  overridden_cap integer;
  total integer := 0;
  beginners integer := 0;
  max_allowed integer;
BEGIN
  SELECT t.trainer_name, t.max_capacity
  INTO trainer, base_cap
  FROM public.time_slots t
  WHERE t.active
    AND t.slot_time = _slot_time
    AND (t.one_off_date = _slot_date OR
         (t.one_off_date IS NULL AND t.day_of_week = dow))
    AND (_trainer_name IS NULL OR t.trainer_name IS NOT DISTINCT FROM _trainer_name)
  ORDER BY
    (t.one_off_date IS NOT NULL) DESC,
    (t.trainer_name IS NOT DISTINCT FROM _trainer_name) DESC,
    t.max_capacity ASC,
    t.id
  LIMIT 1;

  SELECT o.max_capacity INTO overridden_cap
  FROM public.slot_overrides o
  WHERE o.slot_date = _slot_date AND o.slot_time = _slot_time
  LIMIT 1;

  base_cap := COALESCE(overridden_cap, base_cap, 0);

  SELECT count(*)::integer, count(*) FILTER (WHERE lvl = 'beginner')::integer
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
    max_allowed := base_cap;
    beginners := 0;
  ELSIF beginners >= 2 THEN
    max_allowed := LEAST(2, base_cap);
  ELSIF beginners = 1 THEN
    max_allowed := LEAST(3, base_cap);
  ELSE
    max_allowed := LEAST(4, base_cap);
  END IF;

  RETURN jsonb_build_object(
    'trainer', trainer,
    'total', total,
    'beginners', beginners,
    'max_allowed', max_allowed,
    'base_capacity', base_cap
  );
END;
$equus_group_state$;

-- Preserve one-off cancellations if any legacy staff workflow deletes an
-- active recurring occurrence instead of marking it cancelled. Existing
-- sync_permanent_booking_exception() already handles status changes.
CREATE OR REPLACE FUNCTION public.preserve_deleted_permanent_booking_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_deleted_exception$
BEGIN
  IF OLD.status IN ('active', 'pending_cancel')
     AND OLD.user_id IS NOT NULL
     AND OLD.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
     AND EXISTS (
       SELECT 1 FROM public.permanent_slots ps
       WHERE ps.user_id = OLD.user_id
         AND ps.day_of_week = EXTRACT(ISODOW FROM OLD.slot_date)::integer
         AND ps.slot_time = OLD.slot_time
     ) THEN
    INSERT INTO public.permanent_booking_exceptions(user_id, slot_date, slot_time)
    VALUES (OLD.user_id, OLD.slot_date, OLD.slot_time)
    ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$equus_deleted_exception$;

DROP TRIGGER IF EXISTS trg_preserve_deleted_permanent_booking_exception ON public.bookings;
CREATE TRIGGER trg_preserve_deleted_permanent_booking_exception
AFTER DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.preserve_deleted_permanent_booking_exception();

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
  configured_cap int;
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

  -- The normal maximum is set by admin, not fixed to four.
  SELECT COALESCE(
    (SELECT o.max_capacity FROM public.slot_overrides o
     WHERE o.slot_date = NEW.slot_date AND o.slot_time = NEW.slot_time LIMIT 1),
    (SELECT t.max_capacity FROM public.time_slots t
     WHERE t.active
       AND t.slot_time = NEW.slot_time
       AND (t.one_off_date = NEW.slot_date OR
            (t.one_off_date IS NULL AND t.day_of_week = dow))
       AND (NEW.trainer_name IS NULL OR t.trainer_name IS NOT DISTINCT FROM NEW.trainer_name)
     ORDER BY (t.one_off_date IS NOT NULL) DESC,
              (t.trainer_name IS NOT DISTINCT FROM NEW.trainer_name) DESC,
              t.max_capacity ASC, t.id
     LIMIT 1),
    4
  ) INTO configured_cap;

  max_allowed := LEAST(
    configured_cap,
    CASE WHEN beginners >= 2 THEN 2 WHEN beginners = 1 THEN 3 ELSE configured_cap END
  );

  IF total > max_allowed THEN
    RAISE EXCEPTION 'Grupė pilna — maksimalus dalyvių skaičius yra %.', max_allowed USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;



REVOKE ALL ON FUNCTION public.preserve_deleted_permanent_booking_exception()
  FROM PUBLIC, anon, authenticated;
COMMIT;
