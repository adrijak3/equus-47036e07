-- Lock permanent-slot management to administrators and calculate po2 upgrades
-- from the actual subscription unit price on the server.

DROP POLICY IF EXISTS "Users add own permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "Users or admin remove permanent slot" ON public.permanent_slots;
DROP POLICY IF EXISTS "Admins add permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins add permanent slots"
  ON public.permanent_slots FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Admins remove permanent slots" ON public.permanent_slots;
CREATE POLICY "Admins remove permanent slots"
  ON public.permanent_slots FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "users create own permanent requests" ON public.permanent_slot_requests;
REVOKE ALL ON FUNCTION public.request_or_create_permanent_slot(int, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_or_create_permanent_slot(int, time) TO service_role;

-- Pair lessons using a group package consume one lesson and charge the
-- difference between the normal pair price (€45) and the package unit price.
-- Pair packages retain a zero upgrade. The client cannot choose the fee.
CREATE OR REPLACE FUNCTION public.book_po2_with_subscription(
  _slot_date date,
  _slot_time time,
  _subscription_id uuid,
  _extra_fee_eur numeric DEFAULT NULL
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
  v_package_type text;
  v_unit_price numeric(10,2);
  v_extra_fee numeric(10,2) := 0;
  v_capacity integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);
  IF v_capacity <> 2 THEN RAISE EXCEPTION 'NOT_PO2_SLOT'; END IF;

  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
    AND user_id = v_user
    AND paid = true
    AND cancelled_at IS NULL
    AND start_pending = false
    AND COALESCE(start_from_date, purchase_date) <= _slot_date
    AND expires_at >= _slot_date
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE'; END IF;

  v_package_type := COALESCE(
    v_sub.package_type,
    CASE WHEN v_sub.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
  );

  IF v_package_type NOT IN ('group', 'po2') THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
  END IF;

  IF public.subscription_committed_lessons(v_sub.id) >= v_sub.lessons_total THEN
    RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT';
  END IF;

  IF v_package_type = 'group' THEN
    v_unit_price := CASE
      WHEN COALESCE(v_sub.lessons_total, 0) > 0
        THEN v_sub.price / v_sub.lessons_total
      ELSE 0
    END;
    v_extra_fee := GREATEST(45 - v_unit_price, 0);
  END IF;

  SELECT trainer_name INTO v_trainer_name
  FROM public.time_slots
  WHERE active = true
    AND one_off_date IS NULL
    AND day_of_week = EXTRACT(ISODOW FROM _slot_date)::int
    AND slot_time = _slot_time
  ORDER BY id
  LIMIT 1;

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, subscription_id,
    counts_in_subscription, extra_fee_eur, extra_fee_paid, trainer_name
  ) VALUES (
    v_user, _slot_date, _slot_time, 'active', _subscription_id,
    true, v_extra_fee, false, v_trainer_name
  ) RETURNING id INTO v_booking;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking,
    'subscription_id', _subscription_id,
    'extra_fee_eur', v_extra_fee
  );
END;
$$;

REVOKE ALL ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric) TO authenticated, service_role;
