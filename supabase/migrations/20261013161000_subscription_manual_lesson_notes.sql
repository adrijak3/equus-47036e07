-- Equus: add persistent, admin-managed free-text lesson records to subscriptions.
-- This is deliberately additive: booking creation, cancellation, assignment,
-- eligibility, capacity, and the existing 20:00 usage reconciliation rules stay intact.

CREATE TABLE public.subscription_manual_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_manual_lessons_subscription_idx
  ON public.subscription_manual_lessons(subscription_id, created_at DESC);

ALTER TABLE public.subscription_manual_lessons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_manual_lessons FROM anon, authenticated;
GRANT SELECT ON TABLE public.subscription_manual_lessons TO authenticated;

CREATE POLICY "Riders and staff view subscription manual lessons"
ON public.subscription_manual_lessons
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.id = subscription_manual_lessons.subscription_id
      AND (
        (s.user_id IS NOT NULL AND public.owns_profile(auth.uid(), s.user_id))
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'trainer')
        OR public.has_role(auth.uid(), 'half_admin')
      )
  )
);

-- Add the persistent manual lesson count to the existing automatic usage
-- helper. All existing booking-count conditions above remain unchanged.
CREATE OR REPLACE FUNCTION public.subscription_auto_used(_subscription_id uuid)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_used smallint := 0;
  v_manual_used integer := 0;
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

  SELECT COUNT(*)::integer
    INTO v_manual_used
  FROM public.subscription_manual_lessons
  WHERE subscription_id = _subscription_id;

  -- Manual records are always counted until an admin removes them. They are
  -- separate from bookings and therefore do not participate in booking logic.
  RETURN LEAST(32767, COALESCE(v_used, 0)::integer + v_manual_used)::smallint;
END;
$function$;

REVOKE ALL ON FUNCTION public.subscription_auto_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_auto_used(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_add_subscription_manual_lesson(
  _subscription_id uuid,
  _note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_lesson public.subscription_manual_lessons%ROWTYPE;
  v_auto smallint;
  v_effective_used integer;
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

  v_auto := public.subscription_auto_used(_subscription_id);
  v_effective_used := GREATEST(
    0,
    LEAST(v_sub.lessons_total, v_auto::integer + COALESCE(v_sub.manual_used_adjustment, 0))
  );

  IF v_effective_used >= v_sub.lessons_total THEN
    RAISE EXCEPTION 'SUBSCRIPTION_HAS_NO_REMAINING_LESSONS';
  END IF;

  INSERT INTO public.subscription_manual_lessons (
    subscription_id, note, created_by
  )
  VALUES (
    _subscription_id, btrim(_note), v_actor
  )
  RETURNING * INTO v_lesson;

  v_new_used := public.reconcile_subscription_usage(_subscription_id);

  INSERT INTO public.subscription_audit_log (
    actor_user_id, target_user_id, subscription_id, action, old_value, new_value, metadata
  )
  VALUES (
    v_actor, v_sub.user_id, v_sub.id, 'subscription_manual_lesson_added', NULL,
    jsonb_build_object('id', v_lesson.id, 'note', v_lesson.note, 'created_at', v_lesson.created_at),
    jsonb_build_object('lessons_used', v_new_used, 'reason', 'Rankiniu būdu įrašyta papildoma pamoka')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_lesson.id,
    'subscription_id', v_sub.id,
    'lessons_used', v_new_used
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_add_subscription_manual_lesson(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_subscription_manual_lesson(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_remove_subscription_manual_lesson(
  _manual_lesson_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_subscription_id uuid;
  v_sub public.subscriptions%ROWTYPE;
  v_lesson public.subscription_manual_lessons%ROWTYPE;
  v_new_used smallint;
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

  DELETE FROM public.subscription_manual_lessons
  WHERE id = _manual_lesson_id;

  v_new_used := public.reconcile_subscription_usage(v_sub.id);

  INSERT INTO public.subscription_audit_log (
    actor_user_id, target_user_id, subscription_id, action, old_value, new_value, metadata
  )
  VALUES (
    v_actor, v_sub.user_id, v_sub.id, 'subscription_manual_lesson_removed',
    jsonb_build_object('id', v_lesson.id, 'note', v_lesson.note, 'created_at', v_lesson.created_at),
    NULL,
    jsonb_build_object('lessons_used', v_new_used, 'reason', 'Administratorius pašalino rankiniu būdu įrašytą pamoką')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'lessons_used', v_new_used
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_remove_subscription_manual_lesson(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_subscription_manual_lesson(uuid) TO authenticated, service_role;
