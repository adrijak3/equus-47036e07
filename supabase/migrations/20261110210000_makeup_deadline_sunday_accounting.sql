-- Makeup accounting: a completed replacement counts once; otherwise charge only
-- the identifiable package covering the original lesson. Never use a later purchase.
ALTER TABLE public.cancellation_requests
  ADD COLUMN IF NOT EXISTS original_subscription_id uuid REFERENCES public.subscriptions(id),
  ADD COLUMN IF NOT EXISTS makeup_resolution text,
  ADD COLUMN IF NOT EXISTS makeup_replacement_booking_id uuid REFERENCES public.bookings(id);

ALTER TABLE public.subscription_manual_lessons
  ADD COLUMN IF NOT EXISTS makeup_request_id uuid UNIQUE REFERENCES public.cancellation_requests(id);

CREATE UNIQUE INDEX IF NOT EXISTS one_makeup_request_per_replacement_booking
  ON public.cancellation_requests(makeup_replacement_booking_id)
  WHERE makeup_replacement_booking_id IS NOT NULL;

-- Capture the package at admin approval, *before* expiry. A cancelled booking
-- frequently has a null subscription_id. Only accept a single unambiguous
-- eligible package purchased no later than the original lesson.
CREATE OR REPLACE FUNCTION public.capture_makeup_original_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_candidate uuid;
  v_number integer;
BEGIN
  IF NEW.makeup_deadline IS NULL OR NEW.original_subscription_id IS NOT NULL
     OR NEW.makeup_resolution IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = NEW.booking_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  -- Prefer a genuine original attachment if it still exists and is eligible.
  IF v_booking.subscription_id IS NOT NULL THEN
    SELECT s.id INTO v_candidate FROM public.subscriptions s
    WHERE s.id = v_booking.subscription_id AND s.user_id = NEW.user_id
      AND s.paid AND s.cancelled_at IS NULL
      AND s.purchase_date <= v_booking.slot_date
      AND v_booking.slot_date BETWEEN coalesce(s.start_from_date,s.purchase_date) AND s.expires_at
      AND public.booking_matches_subscription_package(v_booking.id,
          coalesce(s.package_type, CASE WHEN s.lesson_type='sportine_po2' THEN 'po2' ELSE 'group' END));
    IF v_candidate IS NOT NULL THEN
      NEW.original_subscription_id := v_candidate;
      RETURN NEW;
    END IF;
  END IF;
  SELECT count(*), min(s.id)
  INTO v_number, v_candidate
  FROM public.subscriptions s
  WHERE s.user_id = NEW.user_id AND s.paid AND s.cancelled_at IS NULL
    AND s.start_pending IS FALSE
    AND s.purchase_date <= v_booking.slot_date
    AND v_booking.slot_date BETWEEN coalesce(s.start_from_date,s.purchase_date) AND s.expires_at
    AND public.booking_matches_subscription_package(v_booking.id,
        coalesce(s.package_type, CASE WHEN s.lesson_type='sportine_po2' THEN 'po2' ELSE 'group' END));
  IF v_number = 1 THEN NEW.original_subscription_id := v_candidate; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capture_makeup_subscription_on_request ON public.cancellation_requests;
CREATE TRIGGER capture_makeup_subscription_on_request
BEFORE INSERT OR UPDATE OF makeup_deadline ON public.cancellation_requests
FOR EACH ROW EXECUTE FUNCTION public.capture_makeup_original_subscription();
REVOKE ALL ON FUNCTION public.capture_makeup_original_subscription() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.expire_makeup_cancellations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_hour integer := extract(hour FROM now() AT TIME ZONE 'Europe/Vilnius');
  v_req record;
  v_replacement uuid;
  v_sub public.subscriptions%ROWTYPE;
  v_processed integer := 0;
BEGIN
  FOR v_req IN
    SELECT cr.id,cr.user_id,cr.booking_id,cr.makeup_deadline,
           cr.original_subscription_id,b.slot_date,b.slot_time
    FROM public.cancellation_requests cr
    JOIN public.bookings b ON b.id=cr.booking_id
    WHERE cr.status='approved' AND cr.admin_decision_counts=false
      AND cr.makeup_deadline IS NOT NULL AND cr.makeup_resolution IS NULL
      AND (cr.makeup_deadline<v_today OR
        (cr.makeup_deadline=v_today AND extract(isodow FROM v_today)=7 AND v_hour>=20))
    ORDER BY cr.makeup_deadline,cr.id
    FOR UPDATE OF cr SKIP LOCKED
  LOOP
    v_replacement := NULL;
    SELECT b.id INTO v_replacement
    FROM public.bookings b
    WHERE b.user_id=v_req.user_id AND b.id<>v_req.booking_id
      AND b.status='completed'
      AND (b.slot_date,b.slot_time)>(v_req.slot_date,v_req.slot_time)
      AND b.slot_date<=v_req.makeup_deadline
      AND (b.slot_date<v_req.makeup_deadline OR b.slot_time<=time '20:00')
      AND NOT EXISTS (
        SELECT 1 FROM public.cancellation_requests old
        WHERE old.makeup_replacement_booking_id=b.id
      )
    ORDER BY b.slot_date,b.slot_time,b.id LIMIT 1;
    IF v_replacement IS NOT NULL THEN
      UPDATE public.cancellation_requests SET makeup_resolution='made_up',
        makeup_replacement_booking_id=v_replacement WHERE id=v_req.id;
      v_processed := v_processed+1;
      CONTINUE;
    END IF;
    -- No later package, no ambiguous attribution, and no second debit.
    IF v_req.original_subscription_id IS NULL THEN
      UPDATE public.cancellation_requests SET makeup_resolution='needs_review'
      WHERE id=v_req.id;
      v_processed := v_processed+1;
      CONTINUE;
    END IF;
    SELECT * INTO v_sub FROM public.subscriptions s
    WHERE s.id=v_req.original_subscription_id AND s.user_id=v_req.user_id
      AND s.paid AND s.cancelled_at IS NULL
      AND s.purchase_date<=v_req.slot_date
      AND v_req.slot_date BETWEEN coalesce(s.start_from_date,s.purchase_date) AND s.expires_at
      AND public.booking_matches_subscription_package(v_req.booking_id,
        coalesce(s.package_type, CASE WHEN s.lesson_type='sportine_po2' THEN 'po2' ELSE 'group' END))
    FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.cancellation_requests SET makeup_resolution='needs_review'
      WHERE id=v_req.id;
      v_processed := v_processed+1;
      CONTINUE;
    END IF;
    IF coalesce(v_sub.lessons_used,0)>=v_sub.lessons_total
       OR public.subscription_committed_lessons(v_sub.id)>=v_sub.lessons_total THEN
      UPDATE public.cancellation_requests SET makeup_resolution='needs_review'
      WHERE id=v_req.id;
      v_processed := v_processed+1;
      CONTINUE;
    END IF;
    INSERT INTO public.subscription_manual_lessons(subscription_id,note,makeup_request_id)
    VALUES(v_sub.id,'Neatidirbta pamoka iki savaitės pabaigos ('||v_req.slot_date::text||')',v_req.id)
    ON CONFLICT (makeup_request_id) DO NOTHING;
    PERFORM public.reconcile_subscription_usage(v_sub.id);
    UPDATE public.cancellation_requests SET admin_decision_counts=true,
      makeup_resolution='charged' WHERE id=v_req.id;
    v_processed := v_processed+1;
  END LOOP;
  RETURN v_processed;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_makeup_cancellations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_makeup_cancellations() TO service_role;

-- Existing future dates were accidentally saved as Saturday by UTC formatting.
-- Extend only unresolved, currently-open Saturday deadlines to Sunday.
UPDATE public.cancellation_requests
SET makeup_deadline=makeup_deadline+1
WHERE status='approved' AND admin_decision_counts=false
  AND makeup_deadline >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  AND extract(isodow FROM makeup_deadline)=6;

-- Old expired records have no verified original package: do not charge anew.
UPDATE public.cancellation_requests
SET makeup_resolution='needs_review'
WHERE makeup_deadline IS NOT NULL AND admin_decision_counts=true
  AND original_subscription_id IS NULL AND makeup_resolution IS NULL;
