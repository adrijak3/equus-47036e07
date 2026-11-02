-- Lock permanent-slot management to administrators and calculate po2 upgrades
-- from the actual subscription unit price on the server.

DROP POLICY IF EXISTS "Users add own permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "Users or admin remove permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "users create own permanent requests" ON public.permanent_slot_requests;

DROP POLICY IF EXISTS "Admins add permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins add permanent slots"
  ON public.permanent_slots FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins remove permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins remove permanent slots"
  ON public.permanent_slots FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON FUNCTION public.request_or_create_permanent_slot(int, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_or_create_permanent_slot(int, time) TO service_role;

-- Keep the established safeguards: capacity lock, duplicate protection,
-- subscription eligibility/remaining-credit check, allocation history and
-- reconciliation. The optional client fee argument remains for compatibility
-- but is deliberately ignored.
CREATE OR REPLACE FUNCTION public.book_po2_with_subscription(
  _slot_date date,
  _slot_time time,
  _subscription_id uuid,
  _extra_fee_eur numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_booking uuid;
  v_trainer_name text;
  v_capacity integer;
  v_booked_count integer;
  v_committed smallint;
  v_package_type text;
  v_extra_fee numeric(10,2);
  v_allocation_number smallint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-slot:' || _slot_date::text || ':' || _slot_time::text, 0)
  );

  SELECT COALESCE(
    (SELECT so.max_capacity FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date AND so.slot_time = _slot_time LIMIT 1),
    (SELECT ts.max_capacity FROM public.time_slots ts
      WHERE ts.active = true
        AND (ts.one_off_date = _slot_date OR
             (ts.one_off_date IS NULL AND ts.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer))
        AND ts.slot_time = _slot_time
      ORDER BY ts.max_capacity DESC LIMIT 1),
    0
  ) INTO v_capacity;

  IF v_capacity <> 2 THEN RAISE EXCEPTION 'NOT_PO2_SLOT'; END IF;

  SELECT count(*)::integer INTO v_booked_count
  FROM public.bookings b
  WHERE b.slot_date = _slot_date AND b.slot_time = _slot_time
    AND b.status IN ('active', 'pending_cancel');

  IF v_booked_count >= v_capacity THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.user_id = v_user AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time AND b.status IN ('active', 'pending_cancel')
  ) THEN RAISE EXCEPTION 'DUPLICATE_BOOKING'; END IF;

  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF NOT COALESCE(v_sub.paid, false) THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_PAID'; END IF;
  IF v_sub.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'SUBSCRIPTION_CANCELLED'; END IF;
  IF COALESCE(v_sub.start_pending, false) THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED'; END IF;
  IF COALESCE(v_sub.start_from_date, v_sub.purchase_date) > _slot_date THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED'; END IF;
  IF v_sub.expires_at < _slot_date THEN RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED'; END IF;
  IF COALESCE(v_sub.lessons_total, 0) <= 0 THEN RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT'; END IF;

  v_committed := public.subscription_committed_lessons(v_sub.id);
  IF v_committed >= v_sub.lessons_total THEN RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT'; END IF;

  v_package_type := COALESCE(
    v_sub.package_type,
    CASE WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
  );
  IF v_package_type NOT IN ('group', 'po2') THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
  END IF;

  IF v_package_type = 'po2' THEN
    v_extra_fee := 0;
  ELSE
    v_extra_fee := GREATEST(0, ROUND(45 - (v_sub.price / v_sub.lessons_total), 2));
  END IF;

  SELECT trainer_name INTO v_trainer_name
  FROM public.time_slots
  WHERE active = true
    AND (one_off_date = _slot_date OR
         (one_off_date IS NULL AND day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer))
    AND slot_time = _slot_time
  ORDER BY id LIMIT 1;

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, subscription_id,
    counts_in_subscription, extra_fee_eur, extra_fee_paid, trainer_name
  ) VALUES (
    v_user, _slot_date, _slot_time, 'active', _subscription_id,
    true, v_extra_fee, false, v_trainer_name
  ) RETURNING id INTO v_booking;

  SELECT COALESCE(MAX(sa.allocation_number), 0) + 1
    INTO v_allocation_number
  FROM public.subscription_allocations sa
  WHERE sa.subscription_id = _subscription_id;

  INSERT INTO public.subscription_allocations(
    subscription_id, booking_id, allocation_number, status
  ) VALUES (_subscription_id, v_booking, v_allocation_number, 'allocated')
  ON CONFLICT (subscription_id, booking_id) DO NOTHING;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  RETURN jsonb_build_object(
    'ok', true, 'booking_id', v_booking,
    'subscription_id', _subscription_id, 'extra_fee_eur', v_extra_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric) TO authenticated, service_role;
