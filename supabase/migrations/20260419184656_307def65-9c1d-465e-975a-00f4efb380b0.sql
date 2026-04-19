-- 1) Permanent weekly slots
CREATE TABLE public.permanent_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  slot_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_of_week, slot_time)
);

ALTER TABLE public.permanent_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permanent slots publicly readable"
  ON public.permanent_slots FOR SELECT USING (true);

CREATE POLICY "Users add own permanent slot"
  ON public.permanent_slots FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users or admin remove permanent slot"
  ON public.permanent_slots FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- 2) Unique booking constraint (defensive) — only one active booking per user/slot
CREATE UNIQUE INDEX IF NOT EXISTS bookings_user_slot_active_uniq
  ON public.bookings (user_id, slot_date, slot_time)
  WHERE status = 'active';

-- 3) Materialise permanent bookings for a date range (idempotent)
CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(
  _start date,
  _end date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
  ps RECORD;
  d date;
BEGIN
  FOR ps IN SELECT user_id, day_of_week, slot_time FROM public.permanent_slots LOOP
    d := _start;
    WHILE d <= _end LOOP
      -- map Postgres dow (0=Sun..6=Sat) → app dow (1=Mon..7=Sun)
      IF (CASE WHEN EXTRACT(DOW FROM d)::int = 0 THEN 7 ELSE EXTRACT(DOW FROM d)::int END) = ps.day_of_week THEN
        BEGIN
          INSERT INTO public.bookings (user_id, slot_date, slot_time, status)
          VALUES (ps.user_id, d, ps.slot_time, 'active');
          inserted_count := inserted_count + 1;
        EXCEPTION WHEN unique_violation THEN
          -- already booked, skip
          NULL;
        END;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;
  RETURN inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO anon, authenticated;

-- 4) Auto-create permanent bookings when a permanent slot is added (for next 12 weeks)
CREATE OR REPLACE FUNCTION public.on_permanent_slot_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.materialize_permanent_bookings(CURRENT_DATE, CURRENT_DATE + INTERVAL '12 weeks');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_permanent_slot_insert
AFTER INSERT ON public.permanent_slots
FOR EACH ROW EXECUTE FUNCTION public.on_permanent_slot_insert();

-- 5) Sickness credit auto-carryover: when admin approves a sickness cancellation,
-- credit +1 to user's most recent active subscription.
CREATE OR REPLACE FUNCTION public.apply_sickness_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_sub uuid;
BEGIN
  IF NEW.sickness = true
     AND NEW.status = 'approved'
     AND COALESCE(NEW.admin_decision_counts, false) = false
     AND (OLD.status IS DISTINCT FROM 'approved' OR OLD.sickness IS DISTINCT FROM true)
  THEN
    -- find most recent subscription with room or extend latest
    SELECT id INTO target_sub
    FROM public.subscriptions
    WHERE user_id = NEW.user_id
      AND expires_at >= CURRENT_DATE
    ORDER BY purchase_date DESC
    LIMIT 1;

    IF target_sub IS NOT NULL THEN
      UPDATE public.subscriptions
      SET sickness_credits = sickness_credits + 1,
          lessons_total = lessons_total + 1
      WHERE id = target_sub;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_sickness_credit
AFTER UPDATE ON public.cancellation_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_sickness_credit();

-- Same trigger on INSERT (in case sickness cancel is created already-approved)
CREATE TRIGGER trg_apply_sickness_credit_ins
AFTER INSERT ON public.cancellation_requests
FOR EACH ROW
WHEN (NEW.sickness = true AND NEW.status = 'approved')
EXECUTE FUNCTION public.apply_sickness_credit();

-- 6) Promotion trigger needs to be attached (it was defined but never bound)
DROP TRIGGER IF EXISTS trg_promote_after_cancel ON public.bookings;
CREATE TRIGGER trg_promote_after_cancel
AFTER UPDATE OR DELETE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.promote_from_waiting_list();

-- 7) Helper for full user deletion (called from edge function via service role)
CREATE OR REPLACE FUNCTION public.delete_user_data(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.permanent_slots WHERE user_id = _user_id;
  DELETE FROM public.waiting_list WHERE user_id = _user_id;
  DELETE FROM public.cancellation_requests WHERE user_id = _user_id;
  DELETE FROM public.bookings WHERE user_id = _user_id;
  DELETE FROM public.subscriptions WHERE user_id = _user_id;
  DELETE FROM public.messages WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;
END;
$$;