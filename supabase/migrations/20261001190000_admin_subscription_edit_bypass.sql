-- ============================================================
-- EQUUS — ADMIN SUBSCRIPTION EDIT BYPASS
--
-- Admins may directly correct subscription lesson totals/used
-- values. This is an administrative correction path and does
-- not represent a new purchase or payment.
--
-- IMPORTANT:
-- subscriptions has BEFORE UPDATE protection triggers which
-- require the transaction-local setting
-- equus.allow_subscription_financial_update = true.
-- SECURITY DEFINER alone does NOT bypass those triggers.
-- These admin RPCs explicitly set that marker for their update.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_adjust_subscription_total(
  _subscription_id uuid,
  _new_lessons_total smallint,
  _reason text DEFAULT 'Pakeitė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_old smallint;
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

  IF _new_lessons_total IS NULL OR _new_lessons_total < 1 THEN
    RAISE EXCEPTION 'INVALID_LESSONS_TOTAL';
  END IF;

  SELECT *
  INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  v_old := v_sub.lessons_total;

  -- The subscriptions protection trigger requires this trusted
  -- transaction-local marker before financial/package fields change.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET lessons_total = _new_lessons_total
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
    'subscription_lessons_total_adjusted',
    jsonb_build_object('lessons_total', v_old),
    jsonb_build_object('lessons_total', _new_lessons_total),
    jsonb_build_object(
      'reason',
      COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_lessons_total', v_old,
    'lessons_total', _new_lessons_total,
    'lessons_used', v_sub.lessons_used,
    'remaining', _new_lessons_total - v_sub.lessons_used
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_adjust_subscription_used(
  _subscription_id uuid,
  _new_lessons_used smallint,
  _reason text DEFAULT 'Pakeitė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_old smallint;
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

  -- The subscriptions protection trigger requires this trusted
  -- transaction-local marker before financial/package fields change.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET lessons_used = _new_lessons_used
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
    jsonb_build_object('lessons_used', v_old),
    jsonb_build_object('lessons_used', _new_lessons_used),
    jsonb_build_object(
      'reason',
      COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_lessons_used', v_old,
    'lessons_used', _new_lessons_used,
    'remaining', v_sub.lessons_total - _new_lessons_used
  );
END;
$$;


REVOKE ALL ON FUNCTION public.admin_adjust_subscription_total(uuid,smallint,text)
FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_adjust_subscription_used(uuid,smallint,text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_adjust_subscription_total(uuid,smallint,text)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_adjust_subscription_used(uuid,smallint,text)
TO authenticated;
