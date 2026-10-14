-- Equus: make a manually added/removed lesson change the stored counter by
-- exactly one (unless the package is already full or already at zero).
--
-- The count helper includes completed bookings, manual lesson notes and approved
-- past-lesson selections. A historic manual_used_adjustment can otherwise mask
-- a newly added note when old counted bookings have since become ineligible.
-- Rebase that offset against the new automatic total while preserving the visible
-- counter delta. Only the subscription being edited is changed.
--
-- IMPORTANT: deliberately does not redefine subscription_auto_used() or
-- reconcile_subscription_usage(), so the immediate-counting fix stays intact.

CREATE OR REPLACE FUNCTION public.admin_add_subscription_manual_lesson(
  _subscription_id uuid,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $manual_lesson_add_delta$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_lesson public.subscription_manual_lessons%ROWTYPE;
  v_old_used smallint;
  v_old_adjustment smallint;
  v_auto_used smallint;
  v_target_used integer;
  v_new_adjustment integer;
  v_new_used smallint;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
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

  IF _note IS NULL OR length(btrim(_note)) = 0 OR length(btrim(_note)) > 2000 THEN
    RAISE EXCEPTION 'INVALID_MANUAL_LESSON_NOTE';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  v_old_used := LEAST(
    COALESCE(v_sub.lessons_used, 0),
    COALESCE(v_sub.lessons_total, 0)
  )::smallint;
  v_old_adjustment := COALESCE(v_sub.manual_used_adjustment, 0);

  INSERT INTO public.subscription_manual_lessons (
    subscription_id, note, created_by
  )
  VALUES (
    _subscription_id, btrim(_note), v_actor
  )
  RETURNING * INTO v_lesson;

  -- The saved note is a distinct consumed lesson. Keep existing displayed usage
  -- as the baseline, then add exactly one, capped at this package's total.
  v_target_used := LEAST(COALESCE(v_sub.lessons_total, 0), v_old_used + 1);
  v_auto_used := public.subscription_auto_used(_subscription_id);
  v_new_adjustment := v_target_used - COALESCE(v_auto_used, 0);

  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET manual_used_adjustment = v_new_adjustment::smallint
  WHERE id = _subscription_id;

  v_new_used := public.reconcile_subscription_usage(_subscription_id);

  INSERT INTO public.subscription_audit_log (
    actor_user_id, target_user_id, subscription_id, action,
    old_value, new_value, metadata
  )
  VALUES (
    v_actor,
    v_sub.user_id,
    v_sub.id,
    'subscription_manual_lesson_added',
    jsonb_build_object(
      'lessons_used', v_old_used,
      'manual_used_adjustment', v_old_adjustment
    ),
    jsonb_build_object(
      'id', v_lesson.id,
      'note', v_lesson.note,
      'created_at', v_lesson.created_at,
      'lessons_used', v_new_used,
      'manual_used_adjustment', v_new_adjustment
    ),
    jsonb_build_object(
      'reason', 'Rankiniu būdu įrašyta papildoma pamoka',
      'counter_delta', v_new_used - v_old_used
    )
  );

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
  ELSE
    PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_lesson.id,
    'subscription_id', v_sub.id,
    'old_lessons_used', v_old_used,
    'lessons_used', v_new_used,
    'manual_used_adjustment', v_new_adjustment,
    'remaining', v_sub.lessons_total - v_new_used
  );
END;
$manual_lesson_add_delta$;

CREATE OR REPLACE FUNCTION public.admin_remove_subscription_manual_lesson(
  _manual_lesson_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $manual_lesson_remove_delta$
DECLARE
  v_actor uuid := auth.uid();
  v_subscription_id uuid;
  v_sub public.subscriptions%ROWTYPE;
  v_lesson public.subscription_manual_lessons%ROWTYPE;
  v_old_used smallint;
  v_old_adjustment smallint;
  v_auto_used smallint;
  v_target_used integer;
  v_new_adjustment integer;
  v_new_used smallint;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _manual_lesson_id IS NULL THEN
    RAISE EXCEPTION 'MANUAL_LESSON_NOT_FOUND';
  END IF;

  SELECT subscription_id
    INTO v_subscription_id
  FROM public.subscription_manual_lessons
  WHERE id = _manual_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANUAL_LESSON_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = v_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_lesson
  FROM public.subscription_manual_lessons
  WHERE id = _manual_lesson_id
    AND subscription_id = v_sub.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANUAL_LESSON_NOT_FOUND';
  END IF;

  v_old_used := LEAST(
    COALESCE(v_sub.lessons_used, 0),
    COALESCE(v_sub.lessons_total, 0)
  )::smallint;
  v_old_adjustment := COALESCE(v_sub.manual_used_adjustment, 0);

  DELETE FROM public.subscription_manual_lessons
  WHERE id = _manual_lesson_id;

  -- Removing this note should remove one used lesson, without being masked by
  -- an old offset. The helper is calculated again after the row is deleted.
  v_target_used := GREATEST(0, v_old_used - 1);
  v_auto_used := public.subscription_auto_used(v_sub.id);
  v_new_adjustment := v_target_used - COALESCE(v_auto_used, 0);

  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET manual_used_adjustment = v_new_adjustment::smallint
  WHERE id = v_sub.id;

  v_new_used := public.reconcile_subscription_usage(v_sub.id);

  INSERT INTO public.subscription_audit_log (
    actor_user_id, target_user_id, subscription_id, action,
    old_value, new_value, metadata
  )
  VALUES (
    v_actor,
    v_sub.user_id,
    v_sub.id,
    'subscription_manual_lesson_removed',
    jsonb_build_object(
      'id', v_lesson.id,
      'note', v_lesson.note,
      'created_at', v_lesson.created_at,
      'lessons_used', v_old_used,
      'manual_used_adjustment', v_old_adjustment
    ),
    jsonb_build_object(
      'lessons_used', v_new_used,
      'manual_used_adjustment', v_new_adjustment
    ),
    jsonb_build_object(
      'reason', 'Administratorius pašalino rankiniu būdu įrašytą pamoką',
      'counter_delta', v_new_used - v_old_used
    )
  );

  IF v_previous_financial_setting = 'true' THEN
    PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);
  ELSE
    PERFORM set_config('equus.allow_subscription_financial_update', 'false', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'old_lessons_used', v_old_used,
    'lessons_used', v_new_used,
    'manual_used_adjustment', v_new_adjustment,
    'remaining', v_sub.lessons_total - v_new_used
  );
END;
$manual_lesson_remove_delta$;

REVOKE ALL
ON FUNCTION public.admin_add_subscription_manual_lesson(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.admin_add_subscription_manual_lesson(uuid, text)
TO authenticated, service_role;

REVOKE ALL
ON FUNCTION public.admin_remove_subscription_manual_lesson(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
ON FUNCTION public.admin_remove_subscription_manual_lesson(uuid)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
