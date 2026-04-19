
-- ========== ENUMS ==========
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.booking_status AS ENUM ('active', 'cancelled', 'completed', 'pending_cancel');
CREATE TYPE public.cancel_status AS ENUM ('pending', 'approved', 'declined');

-- ========== TIMESTAMP TRIGGER FN ==========
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ========== PROFILES ==========
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (needed to show booked names in schedule)
CREATE POLICY "Profiles are publicly readable" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== USER ROLES ==========
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Roles readable by everyone" ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== AUTO PROFILE + ROLE ON SIGNUP ==========
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone'
  );

  -- Adrija = admin, everyone else = user
  IF NEW.email = 'adrija.kalikaite3@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== TIME SLOTS (weekly template) ==========
-- day_of_week: 1=Mon, 2=Tue, ..., 7=Sun
CREATE TABLE public.time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  slot_time TIME NOT NULL,
  max_capacity SMALLINT NOT NULL DEFAULT 5,
  is_permanent_for UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(day_of_week, slot_time)
);
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Time slots publicly readable" ON public.time_slots FOR SELECT USING (true);
CREATE POLICY "Admins manage time slots" ON public.time_slots FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== SLOT OVERRIDES (admin can extend capacity for specific date) ==========
CREATE TABLE public.slot_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  max_capacity SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(slot_date, slot_time)
);
ALTER TABLE public.slot_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Overrides publicly readable" ON public.slot_overrides FOR SELECT USING (true);
CREATE POLICY "Admins manage overrides" ON public.slot_overrides FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ========== BOOKINGS ==========
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'active',
  subscription_id UUID, -- linked when consumed
  counts_in_subscription BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_date_time ON public.bookings(slot_date, slot_time) WHERE status = 'active';
CREATE INDEX idx_bookings_user ON public.bookings(user_id);
-- Prevent user from double-booking same slot
CREATE UNIQUE INDEX uniq_active_booking_per_user_slot ON public.bookings(user_id, slot_date, slot_time)
  WHERE status IN ('active', 'pending_cancel');

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bookings publicly readable" ON public.bookings FOR SELECT USING (true);
CREATE POLICY "Users create own bookings" ON public.bookings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bookings" ON public.bookings FOR UPDATE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete bookings" ON public.bookings FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== WAITING LIST ==========
CREATE TABLE public.waiting_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, slot_date, slot_time)
);
CREATE INDEX idx_waiting_list_slot ON public.waiting_list(slot_date, slot_time, created_at);
ALTER TABLE public.waiting_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Waiting list readable" ON public.waiting_list FOR SELECT USING (true);
CREATE POLICY "Users join own waiting" ON public.waiting_list FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users leave own waiting" ON public.waiting_list FOR DELETE USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ========== SUBSCRIPTIONS ==========
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lessons_total SMALLINT NOT NULL CHECK (lessons_total > 0),
  lessons_used SMALLINT NOT NULL DEFAULT 0,
  sickness_credits SMALLINT NOT NULL DEFAULT 0,
  price NUMERIC(10,2) NOT NULL,
  purchase_date DATE NOT NULL,
  expires_at DATE NOT NULL,
  paid BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own subs" ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own subs" ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users/admin update subs" ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete subs" ON public.subscriptions FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_subs_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== CANCELLATION REQUESTS ==========
CREATE TABLE public.cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  sickness BOOLEAN NOT NULL DEFAULT false,
  status public.cancel_status NOT NULL DEFAULT 'pending',
  admin_decision_counts BOOLEAN, -- whether the lesson should still count
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
ALTER TABLE public.cancellation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own cancel reqs" ON public.cancellation_requests FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own cancel reqs" ON public.cancellation_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins update cancel reqs" ON public.cancellation_requests FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- ========== MESSAGES (user → admin) ==========
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  read_by_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own messages" ON public.messages FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users send own messages" ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins update messages" ON public.messages FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- ========== AUTO-PROMOTE FROM WAITING LIST ==========
CREATE OR REPLACE FUNCTION public.promote_from_waiting_list()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  next_user UUID;
  next_id UUID;
BEGIN
  -- Only act when an active booking is being cancelled/deleted
  IF (TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active')
     OR (TG_OP = 'DELETE' AND OLD.status = 'active') THEN

    SELECT id, user_id INTO next_id, next_user
    FROM public.waiting_list
    WHERE slot_date = OLD.slot_date AND slot_time = OLD.slot_time
    ORDER BY created_at ASC
    LIMIT 1;

    IF next_user IS NOT NULL THEN
      -- Only promote if user doesn't already have an active booking on this slot
      IF NOT EXISTS (
        SELECT 1 FROM public.bookings
        WHERE user_id = next_user AND slot_date = OLD.slot_date AND slot_time = OLD.slot_time
          AND status IN ('active', 'pending_cancel')
      ) THEN
        INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
        VALUES (next_user, OLD.slot_date, OLD.slot_time, 'active');
      END IF;
      DELETE FROM public.waiting_list WHERE id = next_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_promote_after_cancel
  AFTER UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.promote_from_waiting_list();

-- ========== SEED DEFAULT TIME SLOTS ==========
INSERT INTO public.time_slots (day_of_week, slot_time) VALUES
  -- Monday
  (1, '16:00'), (1, '17:00'), (1, '18:00'), (1, '18:45'),
  -- Tuesday
  (2, '16:00'), (2, '17:15'), (2, '18:00'), (2, '18:45'),
  -- Wednesday
  (3, '16:00'), (3, '17:00'), (3, '18:00'), (3, '18:45'),
  -- Thursday
  (4, '17:15'), (4, '18:00'), (4, '18:45'),
  -- Friday
  (5, '16:00'), (5, '17:00'), (5, '17:45'), (5, '18:30'),
  -- Saturday
  (6, '12:00'), (6, '13:00');
  -- Sunday left empty
