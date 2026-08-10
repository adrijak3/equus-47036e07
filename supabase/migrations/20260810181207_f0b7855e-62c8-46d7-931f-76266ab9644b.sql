CREATE TABLE IF NOT EXISTS public.booking_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid,
  user_id uuid NOT NULL,
  slot_date date NOT NULL,
  slot_time time without time zone NOT NULL,
  guest_name text,
  cancelled_by uuid,
  cancelled_by_role text NOT NULL DEFAULT 'system',
  reason text,
  restored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.booking_cancellations TO authenticated;
GRANT ALL ON public.booking_cancellations TO service_role;

ALTER TABLE public.booking_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cancellation log readable by staff and owner" ON public.booking_cancellations;
CREATE POLICY "cancellation log readable by staff and owner"
ON public.booking_cancellations FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'trainer')
  OR public.owns_profile(auth.uid(), user_id)
);

DROP POLICY IF EXISTS "cancellation log update by staff" ON public.booking_cancellations;
CREATE POLICY "cancellation log update by staff"
ON public.booking_cancellations FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'trainer'));

CREATE INDEX IF NOT EXISTS booking_cancellations_created_idx ON public.booking_cancellations (created_at DESC);
CREATE INDEX IF NOT EXISTS booking_cancellations_user_idx ON public.booking_cancellations (user_id);

CREATE OR REPLACE FUNCTION public.log_booking_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller uuid := auth.uid();
  role_label text;
  last_reason text;
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

    INSERT INTO public.booking_cancellations (
      booking_id, user_id, slot_date, slot_time, guest_name,
      cancelled_by, cancelled_by_role, reason
    ) VALUES (
      NEW.id, NEW.user_id, NEW.slot_date, NEW.slot_time,
      CASE WHEN NEW.is_guest THEN NEW.guest_name ELSE NULL END,
      caller, role_label, last_reason
    );
  END IF;

  IF NEW.status = 'active' AND OLD.status = 'cancelled' THEN
    UPDATE public.booking_cancellations
       SET restored_at = now()
     WHERE booking_id = NEW.id AND restored_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_booking_cancellation_trg ON public.bookings;
CREATE TRIGGER log_booking_cancellation_trg
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.log_booking_cancellation();