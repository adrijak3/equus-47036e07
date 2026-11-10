-- A missed make-up is one subscription lesson, not a resurrected cancelled booking.
-- Only the subscription attached to the ORIGINAL booking may be charged.
-- Unmatched requests remain open for administrative review.

ALTER TABLE public.cancellation_requests
  ADD COLUMN IF NOT EXISTS original_subscription_id uuid REFERENCES public.subscriptions(id),
  ADD COLUMN IF NOT EXISTS makeup_resolution text,
  ADD COLUMN IF NOT EXISTS makeup_replacement_booking_id uuid REFERENCES public.bookings(id);

ALTER TABLE public.subscription_manual_lessons
  ADD COLUMN IF NOT EXISTS makeup_request_id uuid UNIQUE REFERENCES public.cancellation_requests(id);

CREATE UNIQUE INDEX IF NOT EXISTS one_makeup_request_per_replacement_booking
  ON public.cancellation_requests(makeup_replacement_booking_id)
  WHERE makeup_replacement_booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.capture_makeup_original_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.original_subscription_id IS NULL THEN
    SELECT b.subscription_id INTO NEW.original_subscription_id
    FROM public.bookings b WHERE b.id = NEW.booking_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_makeup_subscription_on_request ON public.cancellation_requests;
CREATE TRIGGER capture_makeup_subscription_on_request
BEFORE INSERT ON public.cancellation_requests FOR EACH ROW
EXECUTE FUNCTION public.capture_makeup_original_subscription();

REVOKE ALL ON FUNCTION public.capture_makeup_original_subscription() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_makeup_cancellations()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_hour integer := extract(hour FROM now() AT TIME ZONE 'Europe/Vilnius');
  v_req record;
  v_replacement uuid;
  v_sub public.subscriptions%ROWTYPE;
  v_processed integer := 0;
BEGIN
  -- pg_cron runs the worker hourly. Process the current Sunday only from 20:00;
  -- a later invocation also catches up safely if the scheduled run was missed.
  FOR v_req IN
    SELECT cr.id, cr.user_id, cr.booking_id, cr.makeup_deadline,
           cr.original_subscription_id, b.slot_date, b.slot_time
    FROM public.cancellation_requests cr
    JOIN public.bookings b ON b.id = cr.booking_id
    WHERE cr.status = 'approved'
      AND cr.admin_decision_counts = false
      AND cr.makeup_deadline IS NOT NULL
      AND cr.makeup_resolution IS NULL
      AND (cr.makeup_deadline < v_today OR
           (cr.makeup_deadline = v_today AND extract(isodow FROM v_today) = 7 AND v_hour >= 20))
    ORDER BY cr.makeup_deadline, cr.id
    FOR UPDATE OF cr SKIP LOCKED
  LOOP
    -- An attended replacement in the permitted period is already accounted for
    -- through the normal completed-booking path: never debit a second lesson.
    SELECT b.id INTO v_replacement
    FROM public.bookings b
    WHERE b.user_id = v_req.user_id
      AND b.id <> v_req.booking_id
      AND b.status = 'completed'
      AND (b.slot_date, b.slot_time) > (v_req.slot_date, v_req.slot_time)
      AND b.slot_date <= v_req.makeup_deadline
      AND (b.slot_date < v_req.makeup_deadline OR b.slot_time <= TIME '20:00')
      AND NOT EXISTS (
        SELECT 1 FROM public.cancellation_requests already
        WHERE already.makeup_replacement_booking_id = b.id
      )
    ORDER BY b.slot_date, b.slot_time, b.id
    LIMIT 1;

    IF v_replacement IS NOT NULL THEN
      UPDATE public.cancellation_requests
      SET makeup_resolution = 'made_up', makeup_replacement_booking_id = v_replacement
      WHERE id = v_req.id;
      v_processed := v_processed + 1;
      CONTINUE;
    END IF;

    -- Never infer a package from a later purchase. The original attachment
    -- must exist, belong to this rider and cover the original lesson date.
    SELECT * INTO v_sub FROM public.subscriptions s
    WHERE s.id = v_req.original_subscription_id
      AND s.user_id = v_req.user_id
      AND s.cancelled_at IS NULL
      AND v_req.slot_date BETWEEN coalesce(s.start_from_date, s.purchase_date) - 30 AND s.expires_at
    FOR UPDATE;

    IF NOT FOUND OR public.subscription_auto_used(v_sub.id) + coalesce(v_sub.manual_used_adjustment, 0) >= v_sub.lessons_total THEN
      UPDATE public.cancellation_requests SET makeup_resolution = 'needs_review'
      WHERE id = v_req.id;
      CONTINUE;
    END IF;

    INSERT INTO public.subscription_manual_lessons(subscription_id, note, makeup_request_id)
    VALUES (v_sub.id, 'Neatidirbta pamoka iki savaitės pabaigos (' || v_req.slot_date::text || ')', v_req.id)
    ON CONFLICT (makeup_request_id) DO NOTHING;

    PERFORM public.reconcile_subscription_usage(v_sub.id);

    UPDATE public.cancellation_requests
    SET admin_decision_counts = true, makeup_resolution = 'charged'
    WHERE id = v_req.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_makeup_cancellations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_makeup_cancellations() TO service_role;

-- The previous frontend used toISOString() on Lithuania-local Sunday midnight,
-- which turned Sunday into Saturday. Correct only still-open future deadlines.
UPDATE public.cancellation_requests
SET makeup_deadline = makeup_deadline + 1
WHERE status = 'approved'
  AND admin_decision_counts = false
  AND makeup_deadline >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  AND extract(isodow FROM makeup_deadline) = 6;

-- Existing historical rows lack a reliable original subscription. Preserve
-- them as-is financially; expose their status for an administrator to review.
UPDATE public.cancellation_requests cr
SET makeup_resolution = 'needs_review'
WHERE cr.makeup_deadline IS NOT NULL
  AND cr.admin_decision_counts = true
  AND cr.makeup_resolution IS NULL
  AND cr.original_subscription_id IS NULL;
