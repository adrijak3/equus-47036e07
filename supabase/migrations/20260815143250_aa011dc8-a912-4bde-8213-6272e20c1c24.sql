-- 1. Appearance preferences on profiles (theme column already exists)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS appearance_mode text,
  ADD COLUMN IF NOT EXISTS reduced_effects boolean NOT NULL DEFAULT false;

-- 2. Guest riders (people without an Equus account)
CREATE TABLE IF NOT EXISTS public.guest_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  notes text,
  is_newcomer boolean NOT NULL DEFAULT true,
  linked_user_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_riders TO authenticated;
GRANT ALL ON public.guest_riders TO service_role;

ALTER TABLE public.guest_riders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view guest riders" ON public.guest_riders;
CREATE POLICY "Staff can view guest riders" ON public.guest_riders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer') OR linked_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff can create guest riders" ON public.guest_riders;
CREATE POLICY "Staff can create guest riders" ON public.guest_riders
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "Staff can update guest riders" ON public.guest_riders;
CREATE POLICY "Staff can update guest riders" ON public.guest_riders
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "Admins can delete guest riders" ON public.guest_riders;
CREATE POLICY "Admins can delete guest riders" ON public.guest_riders
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_guest_riders_updated_at ON public.guest_riders;
CREATE TRIGGER update_guest_riders_updated_at
  BEFORE UPDATE ON public.guest_riders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Bookings can belong to a guest rider, and record their trainer
ALTER TABLE public.bookings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guest_rider_id uuid REFERENCES public.guest_riders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS trainer_name text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS bookings_guest_rider_idx ON public.bookings (guest_rider_id);
CREATE INDEX IF NOT EXISTS bookings_slot_trainer_idx ON public.bookings (slot_date, slot_time, trainer_name);

DROP POLICY IF EXISTS "Staff can view guest bookings" ON public.bookings;
CREATE POLICY "Staff can view guest bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (guest_rider_id IS NOT NULL);

-- Cancellation log must tolerate guest bookings
ALTER TABLE public.booking_cancellations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.booking_cancellations
  ADD COLUMN IF NOT EXISTS guest_rider_id uuid;

CREATE OR REPLACE FUNCTION public.log_booking_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  role_label text;
  last_reason text;
  guest_label text;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF caller IS NULL THEN
      role_label := 'system';
    ELSIF public.has_role(caller, 'admin') THEN
      role_label := 'admin';
    ELSIF public.has_role(caller, 'trainer') THEN
      role_label := 'trainer';
    ELSE
      role_label := 'client';
    END IF;

    SELECT cr.reason INTO last_reason
      FROM public.cancellation_requests cr
     WHERE cr.booking_id = NEW.id
     ORDER BY cr.created_at DESC
     LIMIT 1;

    guest_label := NULL;
    IF NEW.guest_rider_id IS NOT NULL THEN
      SELECT btrim(g.first_name || ' ' || g.last_name) INTO guest_label
        FROM public.guest_riders g WHERE g.id = NEW.guest_rider_id;
    ELSIF NEW.is_guest THEN
      guest_label := NEW.guest_name;
    END IF;

    INSERT INTO public.booking_cancellations (
      booking_id, user_id, guest_rider_id, slot_date, slot_time, guest_name,
      cancelled_by, cancelled_by_role, reason
    ) VALUES (
      NEW.id, NEW.user_id, NEW.guest_rider_id, NEW.slot_date, NEW.slot_time,
      guest_label, caller, role_label, last_reason
    );
  END IF;

  IF NEW.status = 'active' AND OLD.status = 'cancelled' THEN
    UPDATE public.booking_cancellations
       SET restored_at = now()
     WHERE booking_id = NEW.id AND restored_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- Subscriptions may belong to a guest rider too
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS guest_rider_id uuid REFERENCES public.guest_riders(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS "Staff can view guest subscriptions" ON public.subscriptions;
CREATE POLICY "Staff can view guest subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (guest_rider_id IS NOT NULL AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'trainer')));

-- 4. Trainer rider roster with internal levels
CREATE TABLE IF NOT EXISTS public.trainer_riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_user_id uuid NOT NULL,
  rider_user_id uuid,
  guest_rider_id uuid REFERENCES public.guest_riders(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'beginner',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trainer_riders_level_chk CHECK (level IN ('beginner','independent')),
  CONSTRAINT trainer_riders_target_chk CHECK (num_nonnulls(rider_user_id, guest_rider_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS trainer_riders_user_uniq
  ON public.trainer_riders (trainer_user_id, rider_user_id) WHERE rider_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS trainer_riders_guest_uniq
  ON public.trainer_riders (trainer_user_id, guest_rider_id) WHERE guest_rider_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_riders TO authenticated;
GRANT ALL ON public.trainer_riders TO service_role;

ALTER TABLE public.trainer_riders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff and own rider can view roster" ON public.trainer_riders;
CREATE POLICY "Staff and own rider can view roster" ON public.trainer_riders
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'trainer')
    OR rider_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Trainer manages own roster insert" ON public.trainer_riders;
CREATE POLICY "Trainer manages own roster insert" ON public.trainer_riders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'trainer') AND trainer_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Trainer manages own roster update" ON public.trainer_riders;
CREATE POLICY "Trainer manages own roster update" ON public.trainer_riders
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'trainer') AND trainer_user_id = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'trainer') AND trainer_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Trainer manages own roster delete" ON public.trainer_riders;
CREATE POLICY "Trainer manages own roster delete" ON public.trainer_riders
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'trainer') AND trainer_user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS update_trainer_riders_updated_at ON public.trainer_riders;
CREATE TRIGGER update_trainer_riders_updated_at
  BEFORE UPDATE ON public.trainer_riders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Jolita's roster from the levels already stored on profiles (non-destructive)
INSERT INTO public.trainer_riders (trainer_user_id, rider_user_id, level)
SELECT ur.user_id, p.id, CASE WHEN p.riding_level = 'independent' THEN 'independent' ELSE 'beginner' END
FROM public.user_roles ur
JOIN public.profiles p ON p.riding_level IS NOT NULL
WHERE ur.role = 'trainer'
ON CONFLICT DO NOTHING;

-- 5. Trainer-aware capacity: same time, different trainer = different lesson
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
     AND b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name
     AND (TG_OP = 'INSERT' OR b.id <> NEW.id);

  IF taken >= cap THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 6. Jolita-only dynamic group rules, driven by her own roster
CREATE OR REPLACE FUNCTION public.trainer_rider_level(_trainer_name text, _user_id uuid, _guest_rider_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT tr.level
    FROM public.trainer_riders tr
    JOIN public.profiles tp ON tp.id = tr.trainer_user_id
    WHERE (
        (_user_id IS NOT NULL AND tr.rider_user_id = _user_id)
        OR (_guest_rider_id IS NOT NULL AND tr.guest_rider_id = _guest_rider_id)
      )
      AND (_trainer_name IS NULL OR tp.full_name ILIKE '%' || _trainer_name || '%')
    LIMIT 1
  ), 'beginner');
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

-- 7. Safe, explicit guest -> account linking (admin only)
CREATE OR REPLACE FUNCTION public.link_guest_rider_to_account(_guest_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  moved_bookings int := 0;
  moved_subs int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.guest_riders WHERE id = _guest_id) THEN
    RAISE EXCEPTION 'GUEST_NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  WITH u AS (
    UPDATE public.bookings
       SET user_id = _user_id, guest_rider_id = NULL, is_guest = false, guest_name = NULL
     WHERE guest_rider_id = _guest_id
    RETURNING 1
  ) SELECT count(*) INTO moved_bookings FROM u;

  WITH s AS (
    UPDATE public.subscriptions SET user_id = _user_id, guest_rider_id = NULL
     WHERE guest_rider_id = _guest_id
    RETURNING 1
  ) SELECT count(*) INTO moved_subs FROM s;

  UPDATE public.booking_cancellations SET user_id = _user_id WHERE guest_rider_id = _guest_id;
  UPDATE public.horse_assignments SET user_id = _user_id
   WHERE booking_id IN (SELECT id FROM public.bookings WHERE user_id = _user_id);
  UPDATE public.trainer_riders SET rider_user_id = _user_id, guest_rider_id = NULL
   WHERE guest_rider_id = _guest_id
     AND NOT EXISTS (
       SELECT 1 FROM public.trainer_riders t2
        WHERE t2.trainer_user_id = trainer_riders.trainer_user_id AND t2.rider_user_id = _user_id
     );
  DELETE FROM public.trainer_riders WHERE guest_rider_id = _guest_id;

  UPDATE public.guest_riders SET linked_user_id = _user_id, updated_at = now() WHERE id = _guest_id;

  RETURN jsonb_build_object('ok', true, 'bookings_moved', moved_bookings, 'subscriptions_moved', moved_subs);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.link_guest_rider_to_account(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_guest_rider_to_account(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.trainer_rider_level(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_rider_level(text, uuid, uuid) TO authenticated;