-- Equus: make admin corrections to "lessons used" permanent, and make every
-- subscription recount use the same rule.
--
-- WHAT THIS CHANGES
--   1. subscriptions.manual_used_adjustment (new, default 0): an admin offset that
--      reconcile_subscription_usage() adds on top of the automatic count, so an
--      admin's number is no longer erased by the next booking change.
--   2. subscription_auto_used(): the automatic count, moved out of
--      reconcile_subscription_usage() UNCHANGED (completed lessons only, inside the
--      subscription dates, matching the package; today's lessons only at 20:00).
--   3. reconcile_subscription_usage(): automatic count + admin offset (offset = 0
--      gives exactly the previous behaviour).
--   4. admin_adjust_subscription_used(): stores the admin's number as an offset.
--   5. admin_set_booking_subscription(): attach/detach now uses the same recount
--      instead of its own (which counted future and open bookings as used).
--   6. admin_recalculate_subscription_usage() (new): admin button "recalculate",
--      optionally clearing the manual offset.
--
-- WHAT THIS DOES NOT CHANGE
--   Booking creation, cancellation, cutoffs, capacity, waiting list, family
--   bookings, horse rules, purchase logic and the "one lesson left" e-mail rule.
--   Existing stored lessons_used values are NOT rewritten by this migration.
--
-- Statements are separated by the marker line below so the file can be dry-run.

-- @@STATEMENT@@
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS manual_used_adjustment smallint NOT NULL DEFAULT 0;

-- @@STATEMENT@@
COMMENT ON COLUMN public.subscriptions.manual_used_adjustment IS
  'Admin offset added to the automatic used-lessons count. Set by admin_adjust_subscription_used(); cleared by admin_recalculate_subscription_usage(..., true).';

-- @@STATEMENT@@
CREATE OR REPLACE FUNCTION public.subscription_auto_used(_subscription_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_used smallint := 0;
  v_local_date date := (now() AT TIME ZONE 'Europe/Vilnius')::date;
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::smallint
    INTO v_used
  FROM public.bookings b
  JOIN public.subscriptions s
    ON s.id = _subscription_id
  WHERE b.subscription_id = _subscription_id
    AND b.status = 'completed'
    AND b.counts_in_subscription IS NOT FALSE
    AND b.slot_date BETWEEN
      COALESCE(s.start_from_date, s.purchase_date)
      AND s.expires_at
    -- Same-day completion events cannot change the count on their own.
    -- Only the dedicated 20:00 batch sets this transaction-local flag.
    AND (
      b.slot_date < v_local_date
      OR (
        b.slot_date = v_local_date
        AND current_setting('equus.allow_daily_subscription_usage_update', true) = 'true'
      )
    )
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    );

  RETURN COALESCE(v_used, 0);
END;
$function$;

-- @@STATEMENT@@
REVOKE ALL ON FUNCTION public.subscription_auto_used(uuid) FROM PUBLIC, anon, authenticated;

-- @@STATEMENT@@
GRANT EXECUTE ON FUNCTION public.subscription_auto_used(uuid) TO service_role;

-- @@STATEMENT@@
CREATE OR REPLACE FUNCTION public.reconcile_subscription_usage(_subscription_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total smallint;
  v_adjustment smallint;
  v_auto smallint;
  v_result smallint;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lessons_total, COALESCE(manual_used_adjustment, 0)
    INTO v_total, v_adjustment
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_auto := public.subscription_auto_used(_subscription_id);

  -- Automatic count plus the admin's permanent correction, kept inside 0..total.
  v_result := GREATEST(0, LEAST(v_total, v_auto + v_adjustment))::smallint;

  -- This is the trusted internal accounting writer. Authorize only its own
  -- lessons_used UPDATE, then restore the surrounding transaction's marker.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET lessons_used = v_result
  WHERE id = _subscription_id;

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

  RETURN v_result;
END;
$function$;

-- @@STATEMENT@@
CREATE OR REPLACE FUNCTION public.admin_adjust_subscription_used(
  _subscription_id uuid,
  _new_lessons_used smallint,
  _reason text DEFAULT 'Pakeitė administracija'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_old smallint;
  v_auto smallint;
  v_old_adjustment smallint;
  v_new_adjustment integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _subscription_id IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _new_lessons_used IS NULL OR _new_lessons_used < 0 THEN
    RAISE EXCEPTION 'INVALID_LESSONS_USED';
  END IF;

  SELECT *
  INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  IF _new_lessons_used > v_sub.lessons_total THEN
    RAISE EXCEPTION 'LESSONS_USED_EXCEEDS_TOTAL';
  END IF;

  v_old := v_sub.lessons_used;
  v_old_adjustment := COALESCE(v_sub.manual_used_adjustment, 0);
  v_auto := public.subscription_auto_used(_subscription_id);

  -- Remember the admin's number as an offset from the automatic count, so later
  -- booking changes keep it instead of recomputing it away.
  v_new_adjustment := _new_lessons_used - v_auto;

  -- The subscriptions protection trigger requires this trusted
  -- transaction-local marker before financial/package fields change.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET
    manual_used_adjustment = v_new_adjustment::smallint,
    lessons_used = _new_lessons_used
  WHERE id = _subscription_id;

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
    v_sub.user_id,
    v_sub.id,
    'subscription_lessons_used_adjusted',
    jsonb_build_object(
      'lessons_used', v_old,
      'manual_used_adjustment', v_old_adjustment
    ),
    jsonb_build_object(
      'lessons_used', _new_lessons_used,
      'manual_used_adjustment', v_new_adjustment
    ),
    jsonb_build_object(
      'reason',
      COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija'),
      'automatic_used', v_auto
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_lessons_used', v_old,
    'lessons_used', _new_lessons_used,
    'automatic_used', v_auto,
    'manual_used_adjustment', v_new_adjustment,
    'remaining', v_sub.lessons_total - _new_lessons_used
  );
END;
$function$;

-- @@STATEMENT@@
CREATE OR REPLACE FUNCTION public.admin_recalculate_subscription_usage(
  _subscription_id uuid,
  _clear_manual boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_new_used smallint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _subscription_id IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  IF COALESCE(_clear_manual, false) THEN
    UPDATE public.subscriptions
    SET manual_used_adjustment = 0
    WHERE id = _subscription_id;
  END IF;

  v_new_used := public.reconcile_subscription_usage(_subscription_id);

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
    v_sub.user_id,
    v_sub.id,
    'subscription_lessons_used_adjusted',
    jsonb_build_object(
      'lessons_used', v_sub.lessons_used,
      'manual_used_adjustment', COALESCE(v_sub.manual_used_adjustment, 0)
    ),
    jsonb_build_object(
      'lessons_used', v_new_used,
      'manual_used_adjustment',
        CASE WHEN COALESCE(_clear_manual, false) THEN 0
             ELSE COALESCE(v_sub.manual_used_adjustment, 0) END
    ),
    jsonb_build_object(
      'reason',
      CASE WHEN COALESCE(_clear_manual, false)
           THEN 'Perskaičiuota pagal įvykusias pamokas (rankinis pakeitimas pašalintas)'
           ELSE 'Perskaičiuota pagal įvykusias pamokas' END
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_lessons_used', v_sub.lessons_used,
    'lessons_used', v_new_used,
    'manual_used_adjustment',
      CASE WHEN COALESCE(_clear_manual, false) THEN 0
           ELSE COALESCE(v_sub.manual_used_adjustment, 0) END
  );
END;
$function$;

-- @@STATEMENT@@
REVOKE ALL ON FUNCTION public.admin_recalculate_subscription_usage(uuid, boolean) FROM PUBLIC, anon;

-- @@STATEMENT@@
GRANT EXECUTE ON FUNCTION public.admin_recalculate_subscription_usage(uuid, boolean) TO authenticated, service_role;

-- @@STATEMENT@@
CREATE OR REPLACE FUNCTION public.admin_set_booking_subscription(
  _booking_id uuid,
  _subscription_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_sub uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT subscription_id
    INTO old_sub
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  -- This is the trusted admin path. The setting is transaction-local, so
  -- ordinary client UPDATEs remain blocked by the subscription protection
  -- trigger.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.bookings
  SET
    subscription_id = _subscription_id,
    counts_in_subscription = (_subscription_id IS NOT NULL),
    updated_at = now()
  WHERE id = _booking_id;

  -- Use the single shared recount (completed lessons + admin offset). The old
  -- inline recount here counted every non-cancelled booking, including future
  -- and still-open ones, as "used".
  IF old_sub IS NOT NULL THEN
    PERFORM public.reconcile_subscription_usage(old_sub);
  END IF;

  IF _subscription_id IS NOT NULL
     AND _subscription_id IS DISTINCT FROM old_sub THEN
    PERFORM public.reconcile_subscription_usage(_subscription_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'previous_subscription', old_sub,
    'subscription', _subscription_id
  );
END;
$function$;
