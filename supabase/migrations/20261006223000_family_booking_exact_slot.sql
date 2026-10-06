-- Fix family booking to target the exact schedule slot.
-- The visible schedule is slot/trainer specific, while the legacy effective
-- capacity helper is time-wide. Family booking must therefore validate and
-- insert against the exact slot the rider clicked.

BEGIN;

DROP FUNCTION IF EXISTS public.create_family_booking(
  date,
  time without time zone,
  uuid,
  uuid,
  boolean
);

CREATE OR REPLACE FUNCTION public.create_family_booking(
  _slot_date date,
  _slot_time time without time zone,
  _family_rider_id uuid,
  _subscription_id uuid DEFAULT NULL,
  _force_separate boolean DEFAULT false,
  _slot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_family_booking$
DECLARE
  v_actor uuid := auth.uid();
  v_child public.family_riders%ROWTYPE;
  v_capacity integer;
  v_occupied integer;
  v_trainer_name text;
  v_package_type text;
  v_sub public.subscriptions%ROWTYPE;
  v_child_counts boolean := false;
  v_primary_counts boolean := true;
  v_primary_sub uuid := NULL;
  v_group uuid := gen_random_uuid();
  v_primary uuid;
  v_child_booking uuid;
  v_eligibility jsonb;
  v_requested_slot public.time_slots%ROWTYPE;
  v_extra_fee numeric(10,2) := 0;
  v_per_lesson numeric(10,2);
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _family_rider_id IS NULL THEN RAISE EXCEPTION 'FAMILY_RIDER_REQUIRED'; END IF;

  SELECT *
    INTO v_child
  FROM public.family_riders
  WHERE id = _family_rider_id
    AND parent_user_id = v_actor;

  IF NOT FOUND THEN RAISE EXCEPTION 'FAMILY_RIDER_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-family-booking:' || v_actor::text, 0)
  );

  IF _slot_id IS NOT NULL THEN
    SELECT *
      INTO v_requested_slot
    FROM public.time_slots t
    WHERE t.id = _slot_id
      AND t.slot_time = _slot_time
      AND t.active = true
      AND (
        t.one_off_date = _slot_date
        OR (
          t.one_off_date IS NULL
          AND t.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
        )
      )
    FOR UPDATE;
  ELSE
    SELECT *
      INTO v_requested_slot
    FROM public.time_slots t
    WHERE t.active = true
      AND t.slot_time = _slot_time
      AND (
        t.one_off_date = _slot_date
        OR (
          t.one_off_date IS NULL
          AND t.day_of_week = EXTRACT(ISODOW FROM _slot_date)::integer
        )
      )
    ORDER BY t.max_capacity DESC, t.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE';
  END IF;

  v_trainer_name := v_requested_slot.trainer_name;

  SELECT COALESCE(
    (
      SELECT so.max_capacity::integer
      FROM public.slot_overrides so
      WHERE so.slot_date = _slot_date
        AND so.slot_time = _slot_time
      LIMIT 1
    ),
    v_requested_slot.max_capacity::integer,
    0
  )
  INTO v_capacity;

  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE';
  END IF;

  SELECT count(*)::integer INTO v_occupied
  FROM public.bookings b
  WHERE b.slot_date = _slot_date
    AND b.slot_time = _slot_time
    AND b.status IN ('active','pending_cancel')
    AND b.trainer_name IS NOT DISTINCT FROM v_trainer_name
    AND b.is_paused_for_subscription IS NOT TRUE;

  IF v_occupied + 2 > v_capacity THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CAPACITY_FOR_TWO_RIDERS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.user_id = v_actor
      AND b.slot_date = _slot_date
      AND b.slot_time = _slot_time
      AND b.status IN ('active','pending_cancel')
  ) THEN
    RAISE EXCEPTION 'PRIMARY_RIDER_ALREADY_BOOKED';
  END IF;

  v_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  v_eligibility := public.check_booking_eligibility(
    v_actor,
    _slot_date,
    _slot_time,
    false
  );

  IF COALESCE((v_eligibility ->> 'ok')::boolean, false) = false THEN
    -- check_booking_eligibility uses the legacy time-wide capacity helper.
    -- Family bookings are slot-specific, so a global SLOT_FULL result may be
    -- ignored when this exact trainer slot still has two seats.
    IF COALESCE(v_eligibility ->> 'code', '') = 'SLOT_FULL'
       AND v_occupied + 2 <= v_capacity
    THEN
      NULL;
    ELSIF NOT (
      v_capacity = 2
      AND EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = v_actor
          AND s.paid = true
          AND s.cancelled_at IS NULL
          AND s.start_pending = false
          AND s.start_from_date IS NOT NULL
          AND s.expires_at IS NOT NULL
          AND _slot_date BETWEEN s.start_from_date AND s.expires_at
          AND COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) IN ('group','po2')
          AND public.subscription_committed_lessons(s.id) < s.lessons_total
      )
    ) THEN
      RAISE EXCEPTION '%', COALESCE(v_eligibility ->> 'message', 'Registracija negalima.');
    END IF;
  END IF;

  IF NOT _force_separate THEN
    IF _subscription_id IS NOT NULL THEN
      SELECT s.*
        INTO v_sub
      FROM public.subscriptions s
      WHERE s.id = _subscription_id
        AND s.user_id = v_actor
        AND s.paid = true
        AND s.cancelled_at IS NULL
        AND (
          s.start_pending = true
          OR (
            s.start_pending = false
            AND s.start_from_date IS NOT NULL
            AND s.expires_at IS NOT NULL
            AND _slot_date BETWEEN s.start_from_date AND s.expires_at
            AND public.subscription_committed_lessons(s.id) < s.lessons_total
          )
        )
        AND (
          (v_package_type = 'group'
            AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'group')
          OR
          (v_package_type = 'po2'
            AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) IN ('group','po2'))
        )
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
      END IF;
    ELSE
      SELECT s.*
        INTO v_sub
      FROM public.subscriptions s
      WHERE s.user_id = v_actor
        AND s.paid = true
        AND s.cancelled_at IS NULL
        AND s.start_pending = false
        AND s.start_from_date IS NOT NULL
        AND s.expires_at IS NOT NULL
        AND _slot_date BETWEEN s.start_from_date AND s.expires_at
        AND public.subscription_committed_lessons(s.id) < s.lessons_total
        AND (
          (v_package_type = 'group'
            AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) = 'group')
          OR
          (v_package_type = 'po2'
            AND COALESCE(s.package_type, CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END) IN ('group','po2'))
        )
      ORDER BY
        COALESCE(s.start_from_date, s.purchase_date),
        s.purchase_date,
        s.purchased_at,
        s.id
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_sub.id IS NULL THEN
      -- A queued subscription can cover the pair after the normal
      -- first-lesson activation runs.
      SELECT s.*
        INTO v_sub
      FROM public.subscriptions s
      WHERE s.user_id = v_actor
        AND s.paid = true
        AND s.cancelled_at IS NULL
        AND s.start_pending = true
        AND COALESCE(s.covered_riders,1) IN (1,2)
        AND COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) IN ('group','po2')
      ORDER BY s.purchased_at, s.purchase_date, s.id
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_sub.id IS NOT NULL THEN
      v_primary_sub := CASE WHEN v_sub.start_pending = false THEN v_sub.id ELSE NULL END;

      IF COALESCE(v_sub.covered_riders,1) = 2 THEN
        IF v_sub.start_pending = false
           AND public.subscription_committed_lessons(v_sub.id) > v_sub.lessons_total - 2
        THEN
          RAISE EXCEPTION 'NOT_ENOUGH_SUBSCRIPTION_LESSONS_FOR_TWO_RIDERS';
        END IF;

        v_child_counts := true;
      END IF;

      IF v_capacity = 2 THEN
        v_per_lesson := v_sub.price / GREATEST(1, v_sub.lessons_total);
        v_extra_fee := GREATEST(
          0,
          ROUND(
            (45 - v_per_lesson) * CASE WHEN v_child_counts THEN 2 ELSE 1 END,
            2
          )
        );
      END IF;
    END IF;
  ELSE
    v_primary_counts := false;
  END IF;

  PERFORM set_config('equus.allow_family_booking_insert', 'true', true);

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, trainer_name,
    subscription_id, counts_in_subscription, extra_fee_eur, extra_fee_paid,
    family_group_id
  )
  VALUES (
    v_actor, _slot_date, _slot_time, 'active', v_trainer_name,
    v_primary_sub, v_primary_counts, v_extra_fee, false,
    v_group
  )
  RETURNING id INTO v_primary;

  INSERT INTO public.bookings (
    user_id, slot_date, slot_time, status, trainer_name,
    subscription_id, counts_in_subscription, extra_fee_eur, extra_fee_paid,
    family_rider_id, family_group_id
  )
  VALUES (
    v_actor, _slot_date, _slot_time, 'active', v_trainer_name,
    CASE WHEN v_child_counts THEN v_primary_sub ELSE NULL END,
    v_child_counts, v_extra_fee, false,
    _family_rider_id, v_group
  )
  RETURNING id INTO v_child_booking;

  RETURN jsonb_build_object(
    'ok', true,
    'primary_booking_id', v_primary,
    'family_booking_id', v_child_booking,
    'family_group_id', v_group,
    'family_rider_id', _family_rider_id,
    'covered_riders', CASE WHEN v_child_counts THEN 2 ELSE 1 END,
    'extra_fee_eur', v_extra_fee
  );
END;
$equus_family_booking$;


REVOKE ALL
ON FUNCTION public.create_family_booking(
  date,
  time without time zone,
  uuid,
  uuid,
  boolean,
  uuid
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_family_booking(
  date,
  time without time zone,
  uuid,
  uuid,
  boolean,
  uuid
)
TO authenticated;

COMMIT;
