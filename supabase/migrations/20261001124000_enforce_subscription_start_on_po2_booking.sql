-- Do not allow a future subscription to be used before its start date.

CREATE OR REPLACE FUNCTION public.book_po2_with_subscription(
  _slot_date date,
  _slot_time time,
  _subscription_id uuid,
  _extra_fee_eur numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_booking uuid;
  v_trainer_name text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _extra_fee_eur < 0 THEN RAISE EXCEPTION 'INVALID_EXTRA_FEE'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.time_slots ts
    WHERE ts.active = true
      AND (
        ts.one_off_date = _slot_date
        OR (
          ts.one_off_date IS NULL
          AND ts.day_of_week = CASE
            WHEN EXTRACT(DOW FROM _slot_date) = 0 THEN 7
            ELSE EXTRACT(DOW FROM _slot_date)::int
          END
        )
      )
      AND ts.slot_time = _slot_time
      AND ts.max_capacity = 2
  ) AND NOT EXISTS (
    SELECT 1 FROM public.slot_overrides so
    WHERE so.slot_date = _slot_date
      AND so.slot_time = _slot_time
      AND so.max_capacity = 2
  ) THEN
    RAISE EXCEPTION 'NOT_PO2_SLOT';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
    AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF NOT v_sub.paid THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_PAID'; END IF;
  IF COALESCE(v_sub.start_from_date, v_sub.purchase_date) > _slot_date THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_STARTED';
  END IF;
  IF v_sub.expires_at < _slot_date THEN RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED'; END IF;
  IF v_sub.lessons_used >= v_sub.lessons_total THEN RAISE EXCEPTION 'NO_SUBSCRIPTION_LESSONS_LEFT'; END IF;
  IF v_sub.lesson_type NOT IN ('sportine', 'sportine_po2') THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_ELIGIBLE_FOR_PO2';
  END IF;

  SELECT trainer_name
    INTO v_trainer_name
  FROM public.time_slots
  WHERE active = true
    AND (
      one_off_date = _slot_date
      OR (
        one_off_date IS NULL
        AND day_of_week = CASE
          WHEN EXTRACT(DOW FROM _slot_date) = 0 THEN 7
          ELSE EXTRACT(DOW FROM _slot_date)::int
        END
      )
    )
    AND slot_time = _slot_time
  ORDER BY id
  LIMIT 1;

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, subscription_id,
    counts_in_subscription, extra_fee_eur, extra_fee_paid, trainer_name
  ) VALUES (
    v_user, _slot_date, _slot_time, 'active', _subscription_id,
    true, _extra_fee_eur, false, v_trainer_name
  )
  RETURNING id INTO v_booking;

  UPDATE public.subscriptions
  SET lessons_used = (
    SELECT count(*)
    FROM public.bookings b
    WHERE b.subscription_id = _subscription_id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE
  )
  WHERE id = _subscription_id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking,
    'subscription_id', _subscription_id,
    'extra_fee_eur', _extra_fee_eur
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_po2_with_subscription(date, time, uuid, numeric) TO authenticated;
