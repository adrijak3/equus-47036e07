-- Equus subscription history assignment:
-- * allow attaching eligible completed lessons from 30 days before package start;
-- * treat group/po2/individual completed bookings as one subscription lesson;
-- * keep package usage and committed counters aligned with the same 30-day history.
CREATE OR REPLACE FUNCTION public.subscription_auto_used(_subscription_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $subscription_auto_used_immediate$
DECLARE
  v_used integer := 0;
  v_manual_used integer := 0;
  v_selected_used integer := 0;
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Every eligible completed booking counts immediately, including today's.
  -- Do not gate the current date behind the old 20:00-only setting.
  SELECT COUNT(*)::integer
    INTO v_used
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.slot_date BETWEEN
      (COALESCE(s.start_from_date, s.purchase_date) - 30)
      AND s.expires_at
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.subscription_purchase_request_lessons rl
      JOIN public.subscription_purchase_requests r ON r.id = rl.request_id
      WHERE rl.booking_id = b.id
        AND r.status = 'approved'
    );

  -- Keep supporting older installations where the optional notes table was
  -- not present at the time the earlier migration was applied.
  IF to_regclass('public.subscription_manual_lessons') IS NOT NULL THEN
    EXECUTE
      'SELECT COUNT(*)::integer
         FROM public.subscription_manual_lessons
        WHERE subscription_id = $1'
      INTO v_manual_used
      USING _subscription_id;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_selected_used
  FROM public.subscription_purchase_request_lessons rl
  JOIN public.subscription_purchase_requests r
    ON r.id = rl.request_id
  WHERE r.subscription_id = _subscription_id
    AND r.status = 'approved';

  RETURN LEAST(
    32767,
    COALESCE(v_used, 0)
      + COALESCE(v_manual_used, 0)
      + COALESCE(v_selected_used, 0)
  )::smallint;
END;
$subscription_auto_used_immediate$;


REVOKE ALL
ON FUNCTION public.subscription_auto_used(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.subscription_auto_used(uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_committed_lessons(
  _subscription_id uuid
)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $committed_with_request_selections$
  SELECT LEAST(
    32767,
    COALESCE((
      SELECT COUNT(*) FILTER (
        WHERE s.start_pending = false
          AND b.status IN ('active', 'pending_cancel', 'completed')
          AND b.counts_in_subscription IS NOT FALSE
          AND (
            public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 0
            OR public.booking_matches_subscription_package(
              b.id,
              COALESCE(
                s.package_type,
                CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
              )
            ) IS TRUE
          )
          AND b.slot_date BETWEEN (COALESCE(s.start_from_date, s.purchase_date) - 30) AND s.expires_at
          AND NOT EXISTS (
            SELECT 1
            FROM public.subscription_purchase_request_lessons rl
            JOIN public.subscription_purchase_requests r ON r.id = rl.request_id
            WHERE rl.booking_id = b.id
              AND r.status = 'approved'
          )
      )::integer
      FROM public.bookings b
      JOIN public.subscriptions s ON s.id = _subscription_id
      WHERE b.subscription_id = _subscription_id
    ), 0)
    + COALESCE((
      SELECT COUNT(*)::integer
      FROM public.subscription_purchase_requests r
      JOIN public.subscription_purchase_request_lessons rl
        ON rl.request_id = r.id
      WHERE r.subscription_id = _subscription_id
        AND r.status = 'approved'
    ), 0)
  )::smallint;
$committed_with_request_selections$;


CREATE OR REPLACE FUNCTION public.booking_matches_subscription_package(
  _booking_id uuid,
  _package_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id = _booking_id
      AND CASE
        WHEN _package_type = 'individual'
          THEN b.is_individual IS TRUE OR public.equus_effective_slot_capacity(b.slot_date, b.slot_time) = 1
        WHEN _package_type IN ('group', 'po2')
          THEN true
        ELSE false
      END
  );
$$;

REVOKE ALL
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.booking_matches_subscription_package(uuid,text)
TO service_role;


CREATE OR REPLACE FUNCTION public.pending_subscription_can_cover_slot(
  _user_id uuid,
  _slot_date date,
  _slot_time time
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $pending_usable_with_request_selections$
DECLARE
  v_capacity integer;
  v_package_type text;
BEGIN
  v_capacity := public.equus_effective_slot_capacity(_slot_date, _slot_time);

  IF v_capacity <= 0 THEN
    RETURN false;
  END IF;

  v_package_type := CASE
    WHEN v_capacity = 1 THEN 'individual'
    WHEN v_capacity = 2 THEN 'po2'
    ELSE 'group'
  END;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = false
      AND COALESCE(s.lessons_total, 0) > 0
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND s.start_from_date IS NOT NULL
      AND s.expires_at IS NOT NULL
      AND s.expires_at >= (now() AT TIME ZONE 'Europe/Vilnius')::date
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.paid = true
      AND s.cancelled_at IS NULL
      AND s.start_pending = true
      AND s.lessons_used < s.lessons_total
      AND public.subscription_committed_lessons(s.id) < s.lessons_total
      AND (
        COALESCE(
          s.package_type,
          CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
        ) IN ('group', 'po2')
        OR (
          COALESCE(
            s.package_type,
            CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
          ) = 'individual'
          AND v_package_type = 'individual'
        )
      )
  );
END;
$pending_usable_with_request_selections$;

REVOKE ALL
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.pending_subscription_can_cover_slot(uuid,date,time)
TO authenticated, service_role;
