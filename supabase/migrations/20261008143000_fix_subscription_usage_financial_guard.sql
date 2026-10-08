-- Equus: keep subscription usage reconciliation compatible with the
-- protected subscription financial-field path.
--
-- reconcile_subscription_usage is an internal trusted accounting writer
-- (service_role only). Its lessons_used UPDATE must be authorized for the
-- exact duration of that UPDATE, while preserving any existing trusted
-- purchase/admin marker held by the surrounding transaction.

CREATE OR REPLACE FUNCTION public.reconcile_subscription_usage(
  _subscription_id uuid
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reconcile_subscription_usage_v2$
DECLARE
  v_used smallint := 0;
  v_total smallint;
  v_previous_financial_setting text := current_setting(
    'equus.allow_subscription_financial_update',
    true
  );
BEGIN
  IF _subscription_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lessons_total
    INTO v_total
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
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
    AND public.booking_matches_subscription_package(
      b.id,
      COALESCE(
        s.package_type,
        CASE WHEN s.lesson_type = 'sportine_po2' THEN 'po2' ELSE 'group' END
      )
    );

  -- This function is the trusted internal accounting writer. Authorize only
  -- its own lessons_used UPDATE, then restore the surrounding transaction's
  -- previous marker so admin/purchase paths keep their full bypass afterward.
  PERFORM set_config(
    'equus.allow_subscription_financial_update',
    'true',
    true
  );

  UPDATE public.subscriptions
  SET lessons_used = LEAST(v_total, v_used)
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

  RETURN LEAST(v_total, v_used);
END;
$reconcile_subscription_usage_v2$;

REVOKE ALL
ON FUNCTION public.reconcile_subscription_usage(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reconcile_subscription_usage(uuid)
TO service_role;
