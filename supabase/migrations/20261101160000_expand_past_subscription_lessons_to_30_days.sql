-- Expand the selectable historical lesson window from 14 to 30 calendar days.
-- This lets riders include eligible, unassigned completed lessons before the
-- subscription purchase date (for example, 20 September when purchasing 6 October).
CREATE OR REPLACE FUNCTION public.get_subscription_request_past_lessons(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $past_lessons$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL OR NOT public.owns_profile(v_actor, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'lessons', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', eligible.id,
          'slot_date', eligible.slot_date,
          'slot_time', eligible.slot_time
        )
        ORDER BY eligible.slot_date DESC, eligible.slot_time DESC
      )
      FROM (
        SELECT b.id, b.slot_date, b.slot_time
        FROM public.bookings b
        WHERE b.user_id = _user_id
          AND b.status = 'completed'
          AND b.slot_date BETWEEN v_today - 29 AND v_today
          AND b.subscription_id IS NULL
          AND b.counts_in_subscription IS TRUE
          AND b.is_paused_for_subscription IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1
            FROM public.subscription_purchase_request_lessons rl
            JOIN public.subscription_purchase_requests r ON r.id = rl.request_id
            WHERE rl.booking_id = b.id
              AND r.status IN ('pending', 'approved')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.subscriptions s
            WHERE s.user_id = b.user_id
              AND s.paid IS TRUE
              AND s.cancelled_at IS NULL
              AND s.start_pending IS FALSE
              AND s.start_from_date IS NOT NULL
              AND s.expires_at IS NOT NULL
              AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
              AND s.lessons_used < s.lessons_total
              AND public.subscription_committed_lessons(s.id) < s.lessons_total
              AND public.booking_matches_subscription_package(
                b.id,
                COALESCE(
                  s.package_type,
                  CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
                )
              )
          )
        ORDER BY b.slot_date DESC, b.slot_time DESC
      ) eligible
    ), '[]'::jsonb)
  );
END;
$past_lessons$;


REVOKE ALL
ON FUNCTION public.get_subscription_request_past_lessons(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.get_subscription_request_past_lessons(uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.create_subscription_purchase_request(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _payment_method text,
  _booking_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $create_purchase_request$
DECLARE
  v_actor uuid := auth.uid();
  v_price numeric(10,2);
  v_today date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
  v_ids uuid[] := COALESCE(_booking_ids, ARRAY[]::uuid[]);
  v_selected_count integer := COALESCE(cardinality(_booking_ids), 0);
  v_valid_count integer := 0;
  v_request_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL OR NOT public.owns_profile(v_actor, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _lessons_total IS NULL OR _lessons_total < 1 OR _lessons_total > 12 THEN
    RAISE EXCEPTION 'INVALID_LESSON_COUNT';
  END IF;

  IF _package_type NOT IN ('group', 'po2') THEN
    RAISE EXCEPTION 'INVALID_PACKAGE_TYPE';
  END IF;

  IF _horse_type NOT IN ('school', 'own') THEN
    RAISE EXCEPTION 'INVALID_HORSE_TYPE';
  END IF;

  IF _payment_method NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;

  IF v_selected_count > _lessons_total THEN
    RAISE EXCEPTION 'TOO_MANY_PAST_LESSONS';
  END IF;

  IF array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PAST_LESSON_SELECTION';
  END IF;

  -- Prevent duplicate submissions from the same rider and serialize checks
  -- against another request or purchase for that rider.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-subscription-request:' || _user_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.subscription_purchase_requests r
    WHERE r.user_id = _user_id
      AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_REQUEST_EXISTS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid IS TRUE
      AND s.cancelled_at IS NULL
      AND s.start_pending IS TRUE
  ) THEN
    RAISE EXCEPTION 'PENDING_SUBSCRIPTION_ALREADY_EXISTS';
  END IF;

  SELECT sp.price_eur
    INTO v_price
  FROM public.subscription_prices sp
  WHERE sp.lessons_total = _lessons_total
    AND sp.package_type = _package_type
    AND sp.horse_type = _horse_type
    AND sp.active IS TRUE;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'PRICE_NOT_CONFIGURED';
  END IF;

  IF v_selected_count > 0 THEN
    SELECT COUNT(*)::integer
      INTO v_valid_count
    FROM public.bookings b
    WHERE b.id = ANY(v_ids)
      AND b.user_id = _user_id
      AND b.status = 'completed'
      AND b.slot_date BETWEEN v_today - 29 AND v_today
      AND b.subscription_id IS NULL
      AND b.counts_in_subscription IS TRUE
      AND b.is_paused_for_subscription IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscription_purchase_request_lessons rl
        JOIN public.subscription_purchase_requests r ON r.id = rl.request_id
        WHERE rl.booking_id = b.id
          AND r.status IN ('pending', 'approved')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = b.user_id
          AND s.paid IS TRUE
          AND s.cancelled_at IS NULL
          AND s.start_pending IS FALSE
          AND s.start_from_date IS NOT NULL
          AND s.expires_at IS NOT NULL
          AND b.slot_date BETWEEN s.start_from_date AND s.expires_at
          AND s.lessons_used < s.lessons_total
          AND public.subscription_committed_lessons(s.id) < s.lessons_total
          AND public.booking_matches_subscription_package(
            b.id,
            COALESCE(
              s.package_type,
              CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
            )
          )
      );

    -- This comparison also rejects duplicated IDs supplied by a modified client.
    IF v_valid_count <> v_selected_count THEN
      RAISE EXCEPTION 'PAST_LESSON_NOT_ELIGIBLE';
    END IF;
  END IF;

  INSERT INTO public.subscription_purchase_requests (
    user_id, lessons_total, package_type, horse_type,
    payment_method, price_eur, status
  )
  VALUES (
    _user_id, _lessons_total, _package_type, _horse_type,
    _payment_method, v_price, 'pending'
  )
  RETURNING id INTO v_request_id;

  IF v_selected_count > 0 THEN
    INSERT INTO public.subscription_purchase_request_lessons(request_id, booking_id)
    SELECT v_request_id, x.booking_id
    FROM unnest(v_ids) AS x(booking_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'price_eur', v_price,
    'payment_method', _payment_method,
    'selected_lesson_count', v_selected_count,
    'status', 'pending'
  );
END;
$create_purchase_request$;

REVOKE ALL
ON FUNCTION public.create_subscription_purchase_request(uuid,smallint,text,text,text,uuid[])
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.create_subscription_purchase_request(uuid,smallint,text,text,text,uuid[])
TO authenticated;

