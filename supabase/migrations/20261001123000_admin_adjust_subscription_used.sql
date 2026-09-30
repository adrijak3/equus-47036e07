-- Equus: allow staff to correct the number of used lessons on a subscription.

CREATE OR REPLACE FUNCTION public.admin_adjust_subscription_used(
  _subscription_id uuid,
  _new_lessons_used smallint,
  _reason text DEFAULT 'Pakeitė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_old smallint;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
  ) THEN
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

  IF _new_lessons_used IS NULL OR _new_lessons_used < 0 THEN
    RAISE EXCEPTION 'INVALID_LESSONS_USED';
  END IF;

  IF _new_lessons_used > v_sub.lessons_total THEN
    RAISE EXCEPTION 'LESSONS_USED_EXCEEDS_TOTAL';
  END IF;

  v_old := v_sub.lessons_used;

  UPDATE public.subscriptions
  SET lessons_used = _new_lessons_used
  WHERE id = _subscription_id;

  INSERT INTO public.subscription_audit_log(
    actor_user_id,
    target_user_id,
    subscription_id,
    action,
    old_value,
    new_value,
    metadata
  )
  VALUES(
    v_actor,
    v_sub.user_id,
    v_sub.id,
    'subscription_lessons_used_adjusted',
    jsonb_build_object('lessons_used', v_old),
    jsonb_build_object('lessons_used', _new_lessons_used),
    jsonb_build_object('reason', COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija'))
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

REVOKE ALL ON FUNCTION public.admin_adjust_subscription_used(uuid,smallint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_subscription_used(uuid,smallint,text) TO authenticated;
