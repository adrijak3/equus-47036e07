-- horses
CREATE TABLE IF NOT EXISTS public.horses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.horses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Horses publicly readable" ON public.horses;
CREATE POLICY "Horses publicly readable" ON public.horses FOR SELECT USING (true);
DROP POLICY IF EXISTS "Trainer or admin manage horses" ON public.horses;
CREATE POLICY "Trainer or admin manage horses" ON public.horses
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

-- horse_assignments
CREATE TABLE IF NOT EXISTS public.horse_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  guest_name text,
  booking_id uuid,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  horse_id uuid NOT NULL REFERENCES public.horses(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_horse_assign_lookup ON public.horse_assignments(slot_date, slot_time);
CREATE INDEX IF NOT EXISTS idx_horse_assign_user ON public.horse_assignments(user_id);
ALTER TABLE public.horse_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Horse assigns publicly readable" ON public.horse_assignments;
CREATE POLICY "Horse assigns publicly readable" ON public.horse_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Trainer/admin manage assigns" ON public.horse_assignments;
CREATE POLICY "Trainer/admin manage assigns" ON public.horse_assignments
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

-- horse_requests
CREATE TABLE IF NOT EXISTS public.horse_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slot_date date NOT NULL,
  slot_time time NOT NULL,
  wished_horse text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slot_date, slot_time)
);
ALTER TABLE public.horse_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Horse requests visible to staff and owner" ON public.horse_requests;
CREATE POLICY "Horse requests visible to staff and owner" ON public.horse_requests
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));
DROP POLICY IF EXISTS "User insert own request" ON public.horse_requests;
CREATE POLICY "User insert own request" ON public.horse_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "User update own request" ON public.horse_requests;
CREATE POLICY "User update own request" ON public.horse_requests
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Owner or staff delete request" ON public.horse_requests;
CREATE POLICY "Owner or staff delete request" ON public.horse_requests
  FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

-- subscriptions: lesson_type + start_from_date
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS lesson_type text NOT NULL DEFAULT 'sportine';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS start_from_date date;

-- bookings: is_individual, guest_name, is_guest
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_individual boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- Trainer/admin can insert guest bookings
DROP POLICY IF EXISTS "Trainer manages guest bookings" ON public.bookings;
CREATE POLICY "Trainer manages guest bookings" ON public.bookings
  FOR INSERT WITH CHECK (
    (public.has_role(auth.uid(), 'trainer') OR public.has_role(auth.uid(), 'admin'))
    AND is_guest = true
  );

-- Trainer can delete bookings (for managing guests)
DROP POLICY IF EXISTS "Trainer deletes bookings" ON public.bookings;
CREATE POLICY "Trainer deletes bookings" ON public.bookings
  FOR DELETE USING (public.has_role(auth.uid(), 'trainer'));

-- messages — trainer access
DROP POLICY IF EXISTS "Trainer reads messages" ON public.messages;
CREATE POLICY "Trainer reads messages" ON public.messages
  FOR SELECT USING (public.has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "Trainer sends messages" ON public.messages;
CREATE POLICY "Trainer sends messages" ON public.messages
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'trainer') AND from_admin = true);

DROP POLICY IF EXISTS "Trainer updates messages" ON public.messages;
CREATE POLICY "Trainer updates messages" ON public.messages
  FOR UPDATE USING (public.has_role(auth.uid(), 'trainer'));

DROP POLICY IF EXISTS "User deletes own conversation" ON public.messages;
CREATE POLICY "User deletes own conversation" ON public.messages
  FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

-- Trainer reads subs
DROP POLICY IF EXISTS "Trainer reads subs" ON public.subscriptions;
CREATE POLICY "Trainer reads subs" ON public.subscriptions
  FOR SELECT USING (public.has_role(auth.uid(), 'trainer'));

-- Auto-assign trainer role to jojimomokykla@gmail.com if user exists
DO $$
DECLARE
  trainer_uid uuid;
BEGIN
  SELECT id INTO trainer_uid FROM auth.users WHERE email = 'jojimomokykla@gmail.com' LIMIT 1;
  IF trainer_uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = trainer_uid AND role = 'user';
    INSERT INTO public.user_roles (user_id, role)
    VALUES (trainer_uid, 'trainer')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Update handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone'
  );
  IF NEW.email = 'adrija.kalikaite3@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSIF NEW.email = 'jojimomokykla@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'trainer');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$function$;
