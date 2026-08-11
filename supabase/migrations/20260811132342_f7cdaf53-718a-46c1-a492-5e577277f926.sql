
-- 1. Internal rider skill level
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS riding_level text;
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_riding_level_chk
    CHECK (riding_level IS NULL OR riding_level IN ('beginner','independent')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trainers may update rider levels (admins already can update any profile)
DROP POLICY IF EXISTS "Trainers update profiles" ON public.profiles;
CREATE POLICY "Trainers update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (public.has_role(auth.uid(), 'trainer'));

-- 2. Trainer assigned to a weekly lesson slot
ALTER TABLE public.time_slots ADD COLUMN IF NOT EXISTS trainer_name text;

-- 3. Group-state helper for trainer lessons
CREATE OR REPLACE FUNCTION public.slot_group_state(_slot_date date, _slot_time time without time zone)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
   ORDER BY (t.trainer_name IS NULL), t.max_capacity DESC
   LIMIT 1;

  SELECT count(*),
         count(*) FILTER (WHERE lvl = 'beginner')
    INTO total, beginners
    FROM (
      SELECT CASE WHEN b.is_guest THEN 'beginner' ELSE COALESCE(p.riding_level, 'beginner') END AS lvl
        FROM public.bookings b
        LEFT JOIN public.profiles p ON p.id = b.user_id
       WHERE b.slot_date = _slot_date
         AND b.slot_time = _slot_time
         AND b.status = 'active'
    ) x;

  IF trainer IS NULL THEN
    max_allowed := COALESCE(base_cap, 5);
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
$$;

-- 4. Enforce dynamic trainer-group rules on booking writes
CREATE OR REPLACE FUNCTION public.enforce_trainer_group_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Staff may deliberately force an unsafe combination
  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  SELECT t.trainer_name INTO trainer
    FROM public.time_slots t
   WHERE t.active
     AND t.slot_time = NEW.slot_time
     AND t.trainer_name IS NOT NULL
     AND ((t.one_off_date IS NULL AND t.day_of_week = dow) OR t.one_off_date = NEW.slot_date)
   LIMIT 1;

  IF trainer IS NULL THEN RETURN NEW; END IF;

  IF NEW.is_guest THEN
    new_lvl := 'beginner';
  ELSE
    SELECT COALESCE(p.riding_level, 'beginner') INTO new_lvl FROM public.profiles p WHERE p.id = NEW.user_id;
    new_lvl := COALESCE(new_lvl, 'beginner');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE lvl = 'beginner')
    INTO total, beginners
    FROM (
      SELECT CASE WHEN b.is_guest THEN 'beginner' ELSE COALESCE(p.riding_level, 'beginner') END AS lvl
        FROM public.bookings b
        LEFT JOIN public.profiles p ON p.id = b.user_id
       WHERE b.slot_date = NEW.slot_date
         AND b.slot_time = NEW.slot_time
         AND b.status = 'active'
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
    IF beginners >= 2 THEN
      RAISE EXCEPTION 'Šioje treniruotėje jau yra 2 pradedantieji, todėl grupės limitas yra 2.' USING ERRCODE = 'check_violation';
    ELSIF beginners = 1 THEN
      RAISE EXCEPTION 'Grupėje yra 1 pradedantysis, todėl maksimalus dalyvių skaičius yra 3.' USING ERRCODE = 'check_violation';
    ELSE
      RAISE EXCEPTION 'Grupė pilna — maksimalus dalyvių skaičius yra 4.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_trainer_group_rules_trg ON public.bookings;
CREATE TRIGGER enforce_trainer_group_rules_trg
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.enforce_trainer_group_rules();

-- 5. Cancellation audit history cleanup (audit table only)
CREATE OR REPLACE FUNCTION public.cleanup_old_cancellations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  vilnius_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  week_start date := (date_trunc('week', vilnius_today::timestamp))::date;
  removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.booking_cancellations
     WHERE created_at < (now() - INTERVAL '14 days')
       AND slot_date < week_start
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;

-- 6. Admin: attach / detach a lesson to an abonementas with recalculation
CREATE OR REPLACE FUNCTION public.admin_set_booking_subscription(_booking_id uuid, _subscription_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  old_sub uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT subscription_id INTO old_sub FROM public.bookings WHERE id = _booking_id;

  UPDATE public.bookings
     SET subscription_id = _subscription_id,
         counts_in_subscription = (_subscription_id IS NOT NULL)
   WHERE id = _booking_id;

  UPDATE public.subscriptions s
     SET lessons_used = (
       SELECT count(*) FROM public.bookings b
        WHERE b.subscription_id = s.id
          AND b.status <> 'cancelled'
          AND b.counts_in_subscription IS NOT FALSE
     )
   WHERE s.id IN (old_sub, _subscription_id);

  RETURN jsonb_build_object('ok', true, 'previous_subscription', old_sub, 'subscription', _subscription_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.slot_group_state(date, time without time zone) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_booking_subscription(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_cancellations() TO service_role;
