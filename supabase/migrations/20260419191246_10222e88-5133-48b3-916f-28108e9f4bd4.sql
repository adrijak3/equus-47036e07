
-- 1) Messages: add parent_id, from_admin, read_by_user
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS from_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_by_user boolean NOT NULL DEFAULT true;

-- Allow admins to insert messages for any user (replies)
DROP POLICY IF EXISTS "Admins send replies" ON public.messages;
CREATE POLICY "Admins send replies"
ON public.messages
FOR INSERT
TO public
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Users can mark admin replies as read on their own thread
DROP POLICY IF EXISTS "Users update own messages" ON public.messages;
CREATE POLICY "Users update own messages"
ON public.messages
FOR UPDATE
TO public
USING (auth.uid() = user_id);

-- 2) Improved sickness credit trigger: prefer newer subscription
CREATE OR REPLACE FUNCTION public.apply_sickness_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_sub uuid;
  cancel_date date;
BEGIN
  IF NEW.sickness = true
     AND NEW.status = 'approved'
     AND COALESCE(NEW.admin_decision_counts, false) = false
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved' OR OLD.sickness IS DISTINCT FROM true)
  THEN
    -- Get the date of the cancelled booking (the "lost" lesson date)
    SELECT slot_date INTO cancel_date FROM public.bookings WHERE id = NEW.booking_id;

    -- Prefer a NEWER subscription purchased on/after the cancellation date
    SELECT id INTO target_sub
    FROM public.subscriptions
    WHERE user_id = NEW.user_id
      AND purchase_date >= COALESCE(cancel_date, CURRENT_DATE)
      AND expires_at >= CURRENT_DATE
    ORDER BY purchase_date ASC
    LIMIT 1;

    -- Fallback: latest active sub
    IF target_sub IS NULL THEN
      SELECT id INTO target_sub
      FROM public.subscriptions
      WHERE user_id = NEW.user_id
        AND expires_at >= CURRENT_DATE
      ORDER BY purchase_date DESC
      LIMIT 1;
    END IF;

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

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_apply_sickness_credit ON public.cancellation_requests;
CREATE TRIGGER trg_apply_sickness_credit
AFTER INSERT OR UPDATE ON public.cancellation_requests
FOR EACH ROW EXECUTE FUNCTION public.apply_sickness_credit();
