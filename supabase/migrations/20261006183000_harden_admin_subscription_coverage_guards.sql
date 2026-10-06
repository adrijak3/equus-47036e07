-- Equus: harden admin subscription coverage against booking/subscription guard chains.
-- The coverage RPC may update family bookings; those updates can invoke
-- subscription pause/financial protection triggers. Keep the trusted markers
-- active for the whole transaction, just like the purchase/restore paths.

CREATE OR REPLACE FUNCTION public.admin_set_subscription_coverage(
  _subscription_id uuid,
  _covered_riders smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_sub_coverage_v3$
DECLARE
  v_actor uuid := auth.uid();
  v_user uuid;
  v_lessons_total smallint;
  v_changed integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF _subscription_id IS NULL OR _covered_riders NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_COVERAGE';
  END IF;

  SELECT user_id, lessons_total
    INTO v_user, v_lessons_total
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  IF _covered_riders = 2 AND COALESCE(v_lessons_total, 0) < 2 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_SUBSCRIPTION_LESSONS_FOR_TWO_RIDERS';
  END IF;

  -- This RPC is a trusted Equus admin path. Keep both markers enabled
  -- because changing covered_riders is followed by family-booking updates,
  -- whose triggers may legitimately reconcile subscription state.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  PERFORM set_config(
    'equus.allow_subscription_pause_update',
    'true',
    true
  );

  PERFORM set_config(
    'equus.defer_subscription_restore',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET
    covered_riders = _covered_riders,
    updated_at = now()
  WHERE id = _subscription_id;

  IF _covered_riders = 2 THEN
    UPDATE public.bookings child
    SET
      subscription_id = _subscription_id,
      counts_in_subscription = true
    FROM public.bookings primary_booking
    JOIN public.family_riders fr
      ON fr.id = child.family_rider_id
    WHERE primary_booking.id <> child.id
      AND primary_booking.user_id = v_user
      AND primary_booking.subscription_id = _subscription_id
      AND primary_booking.status IN ('active', 'pending_cancel')
      AND child.user_id = v_user
      AND child.family_group_id IS NOT NULL
      AND child.family_group_id = primary_booking.family_group_id
      AND child.status IN ('active', 'pending_cancel')
      AND fr.parent_user_id = v_user;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    UPDATE public.bookings child
    SET
      subscription_id = NULL,
      counts_in_subscription = false
    FROM public.bookings primary_booking
    WHERE primary_booking.id <> child.id
      AND primary_booking.user_id = v_user
      AND primary_booking.subscription_id = _subscription_id
      AND primary_booking.status IN ('active', 'pending_cancel')
      AND child.user_id = v_user
      AND child.family_rider_id IS NOT NULL
      AND child.family_group_id IS NOT NULL
      AND child.family_group_id = primary_booking.family_group_id
      AND child.status IN ('active', 'pending_cancel');

    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  PERFORM public.reconcile_subscription_usage(_subscription_id);

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', _subscription_id,
    'covered_riders', _covered_riders,
    'family_bookings_updated', v_changed
  );
END;
$equus_sub_coverage_v3$;

REVOKE ALL
ON FUNCTION public.admin_set_subscription_coverage(uuid, smallint)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_subscription_coverage(uuid, smallint)
TO authenticated, service_role;
