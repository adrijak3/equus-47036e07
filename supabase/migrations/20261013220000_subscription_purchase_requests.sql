-- Equus: rider-submitted abonemento requests with optional cash QR.
-- This is additive. Existing booking eligibility, allocation and the 20:00
-- completed-lesson reconciliation flow remain unchanged.

CREATE TABLE public.subscription_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lessons_total smallint NOT NULL CHECK (lessons_total BETWEEN 1 AND 12),
  package_type text NOT NULL CHECK (package_type IN ('group', 'po2')),
  horse_type text NOT NULL CHECK (horse_type IN ('school', 'own')),
  payment_method text NOT NULL CHECK (payment_method IN ('bank_transfer', 'cash')),
  price_eur numeric(10,2) NOT NULL CHECK (price_eur >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text
);

CREATE INDEX subscription_purchase_requests_status_created_idx
  ON public.subscription_purchase_requests(status, created_at DESC);

CREATE INDEX subscription_purchase_requests_user_created_idx
  ON public.subscription_purchase_requests(user_id, created_at DESC);

CREATE UNIQUE INDEX subscription_purchase_requests_one_pending_per_user
  ON public.subscription_purchase_requests(user_id)
  WHERE status = 'pending';

CREATE TABLE public.subscription_purchase_request_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL
    REFERENCES public.subscription_purchase_requests(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL
    REFERENCES public.bookings(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, booking_id)
);

CREATE INDEX subscription_purchase_request_lessons_request_idx
  ON public.subscription_purchase_request_lessons(request_id);

CREATE INDEX subscription_purchase_request_lessons_booking_idx
  ON public.subscription_purchase_request_lessons(booking_id);

ALTER TABLE public.subscription_purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_purchase_request_lessons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.subscription_purchase_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.subscription_purchase_request_lessons FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_purchase_requests TO authenticated;
GRANT SELECT ON TABLE public.subscription_purchase_request_lessons TO authenticated;

CREATE POLICY "Owners and staff can view subscription purchase requests"
ON public.subscription_purchase_requests
FOR SELECT TO authenticated
USING (
  public.owns_profile(auth.uid(), user_id)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'trainer'::public.app_role)
  OR public.has_role(auth.uid(), 'half_admin'::public.app_role)
);

CREATE POLICY "Owners and staff can view selected purchase lessons"
ON public.subscription_purchase_request_lessons
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subscription_purchase_requests r
    WHERE r.id = subscription_purchase_request_lessons.request_id
      AND (
        public.owns_profile(auth.uid(), r.user_id)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'trainer'::public.app_role)
        OR public.has_role(auth.uid(), 'half_admin'::public.app_role)
      )
  )
);

-- Private JSON formatter shared by the narrowly-authorized RPCs below.
CREATE OR REPLACE FUNCTION public.subscription_purchase_request_payload(
  _request_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $request_payload$
  SELECT jsonb_build_object(
    'id', r.id,
    'user_id', r.user_id,
    'rider_name', p.full_name,
    'lessons_total', r.lessons_total,
    'package_type', r.package_type,
    'horse_type', r.horse_type,
    'payment_method', r.payment_method,
    'price_eur', r.price_eur,
    'status', r.status,
    'created_at', r.created_at,
    'approved_at', r.approved_at,
    'rejected_at', r.rejected_at,
    'rejection_reason', r.rejection_reason,
    'subscription_id', r.subscription_id,
    'selected_past_lessons',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'slot_date', b.slot_date,
            'slot_time', b.slot_time
          )
          ORDER BY b.slot_date DESC, b.slot_time DESC
        )
        FROM public.subscription_purchase_request_lessons rl
        JOIN public.bookings b ON b.id = rl.booking_id
        WHERE rl.request_id = r.id
      ), '[]'::jsonb)
  )
  FROM public.subscription_purchase_requests r
  JOIN public.profiles p ON p.id = r.user_id
  WHERE r.id = _request_id;
$request_payload$;

REVOKE ALL
ON FUNCTION public.subscription_purchase_request_payload(uuid)
FROM PUBLIC, anon, authenticated;

-- Return completed, not-yet-assigned lessons from the previous 14 calendar
-- dates in Europe/Vilnius, including today. Lessons that an existing paid
-- subscription could still consume are intentionally excluded to avoid
-- counting the same booking twice.
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
          AND b.slot_date BETWEEN v_today - 13 AND v_today
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

-- Create either a bank-transfer request (goes directly to the staff queue) or
-- a cash request whose request UUID is encoded in a URL QR shown to the rider.
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
      AND b.slot_date BETWEEN v_today - 13 AND v_today
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

CREATE OR REPLACE FUNCTION public.get_my_subscription_purchase_requests(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $my_purchase_requests$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL OR NOT public.owns_profile(v_actor, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requests', COALESCE((
      SELECT jsonb_agg(
        public.subscription_purchase_request_payload(q.id)
        ORDER BY q.created_at DESC
      )
      FROM (
        SELECT r.id, r.created_at
        FROM public.subscription_purchase_requests r
        WHERE r.user_id = _user_id
        ORDER BY r.created_at DESC
        LIMIT 10
      ) q
    ), '[]'::jsonb)
  );
END;
$my_purchase_requests$;

REVOKE ALL
ON FUNCTION public.get_my_subscription_purchase_requests(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.get_my_subscription_purchase_requests(uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.list_subscription_purchase_requests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $list_purchase_requests$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
    OR public.has_role(v_actor, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'requests', COALESCE((
      SELECT jsonb_agg(
        public.subscription_purchase_request_payload(q.id)
        ORDER BY CASE WHEN q.status = 'pending' THEN 0 ELSE 1 END,
                 q.created_at DESC
      )
      FROM (
        SELECT r.id, r.status, r.created_at
        FROM public.subscription_purchase_requests r
        ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
                 r.created_at DESC
        LIMIT 100
      ) q
    ), '[]'::jsonb)
  );
END;
$list_purchase_requests$;

REVOKE ALL
ON FUNCTION public.list_subscription_purchase_requests()
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.list_subscription_purchase_requests()
TO authenticated;

CREATE OR REPLACE FUNCTION public.get_subscription_purchase_request_for_staff(
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $staff_purchase_request$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
    OR public.has_role(v_actor, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY';
  END IF;

  v_result := public.subscription_purchase_request_payload(_request_id);

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  RETURN v_result;
END;
$staff_purchase_request$;

REVOKE ALL
ON FUNCTION public.get_subscription_purchase_request_for_staff(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.get_subscription_purchase_request_for_staff(uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_subscription_purchase_request(
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $approve_purchase_request$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.subscription_purchase_requests%ROWTYPE;
  v_current_price numeric(10,2);
  v_selected_count integer := 0;
  v_valid_count integer := 0;
  v_purchase jsonb;
  v_subscription_id uuid;
  v_lessons_used smallint;
  v_manual_adjustment smallint;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
    OR public.has_role(v_actor, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY';
  END IF;

  SELECT *
    INTO v_request
  FROM public.subscription_purchase_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_PROCESSED';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-user-purchase:' || v_request.user_id::text, 0)
  );

  SELECT sp.price_eur
    INTO v_current_price
  FROM public.subscription_prices sp
  WHERE sp.lessons_total = v_request.lessons_total
    AND sp.package_type = v_request.package_type
    AND sp.horse_type = v_request.horse_type
    AND sp.active IS TRUE;

  IF v_current_price IS NULL OR v_current_price IS DISTINCT FROM v_request.price_eur THEN
    RAISE EXCEPTION 'REQUEST_PRICE_CHANGED';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_selected_count
  FROM public.subscription_purchase_request_lessons rl
  WHERE rl.request_id = v_request.id;

  IF v_selected_count > v_request.lessons_total THEN
    RAISE EXCEPTION 'TOO_MANY_PAST_LESSONS';
  END IF;

  -- A selected lesson can age out of the 14-day picker while Laura reviews
  -- the request, so approval rechecks completion and ownership but not the
  -- rolling date window. It must still be unassigned and not claimed by an
  -- older active subscription or another approved request.
  SELECT COUNT(*)::integer
    INTO v_valid_count
  FROM public.subscription_purchase_request_lessons rl
  JOIN public.bookings b ON b.id = rl.booking_id
  WHERE rl.request_id = v_request.id
    AND b.user_id = v_request.user_id
    AND b.status = 'completed'
    AND b.subscription_id IS NULL
    AND b.counts_in_subscription IS TRUE
    AND b.is_paused_for_subscription IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.subscription_purchase_request_lessons other_rl
      JOIN public.subscription_purchase_requests other_r ON other_r.id = other_rl.request_id
      WHERE other_rl.booking_id = b.id
        AND other_r.id <> v_request.id
        AND other_r.status IN ('pending', 'approved')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.subscriptions s
      WHERE s.user_id = b.user_id
        AND s.id IS DISTINCT FROM v_request.subscription_id
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

  IF v_valid_count <> v_selected_count THEN
    RAISE EXCEPTION 'PAST_LESSON_NO_LONGER_ELIGIBLE';
  END IF;

  -- Reuse the existing purchase system for pricing, payments, audit history,
  -- queued starts, e-mail events and future booking processing. "none" keeps
  -- upcoming ordinary bookings unattached until the existing completion flow.
  v_purchase := public.admin_purchase_subscription(
    v_request.user_id,
    v_request.lessons_total,
    v_request.package_type,
    v_request.horse_type,
    'none',
    v_request.payment_method
  );

  IF COALESCE(v_purchase->>'ok', 'false') <> 'true'
     OR NULLIF(v_purchase->>'subscription_id', '') IS NULL
  THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PURCHASE_FAILED';
  END IF;

  v_subscription_id := (v_purchase->>'subscription_id')::uuid;

  -- Keep the historical selections linked to the approved request, but do
  -- not rewrite old booking rows or make them eligible for future auto-allocation.
  -- The permanent manual offset makes each selected completed lesson count as
  -- used immediately and remain counted after the daily 20:00 reconciliation.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET manual_used_adjustment = (
    COALESCE(manual_used_adjustment, 0) + v_selected_count
  )::smallint
  WHERE id = v_subscription_id
  RETURNING manual_used_adjustment INTO v_manual_adjustment;

  PERFORM public.reconcile_subscription_usage(v_subscription_id);

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config(
      'equus.allow_subscription_financial_update',
      'true',
      true
    );
  ELSE
    PERFORM set_config(
      'equus.allow_subscription_financial_update',
      'false',
      true
    );
  END IF;

  SELECT lessons_used
    INTO v_lessons_used
  FROM public.subscriptions
  WHERE id = v_subscription_id;

  UPDATE public.subscription_purchase_requests
  SET
    status = 'approved',
    subscription_id = v_subscription_id,
    approved_at = now(),
    approved_by = v_actor
  WHERE id = v_request.id
    AND status = 'pending';

  INSERT INTO public.subscription_audit_log (
    actor_user_id,
    target_user_id,
    subscription_id,
    action,
    old_value,
    new_value,
    metadata
  )
  VALUES (
    v_actor,
    v_request.user_id,
    v_subscription_id,
    'subscription_purchase_request_approved',
    NULL,
    jsonb_build_object(
      'request_id', v_request.id,
      'payment_method', v_request.payment_method,
      'price_eur', v_request.price_eur,
      'selected_past_lessons', v_selected_count,
      'manual_used_adjustment', v_manual_adjustment,
      'lessons_used', v_lessons_used
    ),
    jsonb_build_object(
      'package_type', v_request.package_type,
      'horse_type', v_request.horse_type,
      'lessons_total', v_request.lessons_total
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'request_id', v_request.id,
    'subscription_id', v_subscription_id,
    'price_eur', v_request.price_eur,
    'selected_past_lessons', v_selected_count,
    'lessons_used', v_lessons_used
  );
END;
$approve_purchase_request$;

REVOKE ALL
ON FUNCTION public.approve_subscription_purchase_request(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.approve_subscription_purchase_request(uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_subscription_purchase_request(
  _request_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reject_purchase_request$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.subscription_purchase_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
    OR public.has_role(v_actor, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY';
  END IF;

  SELECT *
    INTO v_request
  FROM public.subscription_purchase_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'REQUEST_ALREADY_PROCESSED';
  END IF;

  UPDATE public.subscription_purchase_requests
  SET
    status = 'rejected',
    rejected_at = now(),
    rejected_by = v_actor,
    rejection_reason = NULLIF(left(btrim(COALESCE(_reason, '')), 1000), '')
  WHERE id = v_request.id
    AND status = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'rejected',
    'request_id', v_request.id
  );
END;
$reject_purchase_request$;

REVOKE ALL
ON FUNCTION public.reject_subscription_purchase_request(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE
ON FUNCTION public.reject_subscription_purchase_request(uuid, text)
TO authenticated;