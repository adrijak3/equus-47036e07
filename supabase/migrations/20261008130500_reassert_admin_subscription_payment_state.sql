-- Equus: re-assert the existing admin subscription payment-state path.
--
-- This intentionally preserves the existing protection model:
-- direct subscription payment-state writes remain blocked; admins use the
-- authorized Equus payment-system RPCs below.
--
-- No unrelated subscription, booking, eligibility or recurring logic is changed.

-- Fix admin payment-state toggle for subscriptions.
-- The UI already uses these trusted admin RPCs. Direct UPDATEs to
-- subscriptions.paid remain blocked by the subscription protection trigger.
-- These RPCs are the authorized Equus payment-system path.

CREATE OR REPLACE FUNCTION public.admin_mark_subscription_paid(
  _subscription_id uuid,
  _reason text DEFAULT 'Pakeitė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $admin_paid$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
  v_payment_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  -- Both markers are transaction-local. The payment marker authorizes the
  -- paid-state transition; the financial marker keeps the subscription
  -- protection chain compatible with the admin purchase/edit paths.
  PERFORM set_config('equus.allow_subscription_payment_update', 'true', true);
  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  UPDATE public.subscriptions
  SET
    paid = true,
    purchase_method = COALESCE(purchase_method, 'cash'),
    purchased_by = COALESCE(purchased_by, v_actor),
    purchased_at = COALESCE(purchased_at, now())
  WHERE id = _subscription_id;

  -- A paid subscription should have its payment record. Reuse the
  -- subscription price/payment method and make the admin the recorder.
  INSERT INTO public.subscription_payments (
    subscription_id,
    user_id,
    amount_eur,
    payment_method,
    paid_at,
    recorded_by
  )
  VALUES (
    v_sub.id,
    v_sub.user_id,
    COALESCE(v_sub.price, 0),
    CASE
      WHEN v_sub.purchase_method IN ('cash', 'bank_transfer', 'other')
        THEN v_sub.purchase_method
      ELSE 'cash'
    END,
    now(),
    v_actor
  )
  ON CONFLICT (subscription_id) DO UPDATE
    SET amount_eur = EXCLUDED.amount_eur,
        payment_method = EXCLUDED.payment_method,
        paid_at = EXCLUDED.paid_at,
        recorded_by = EXCLUDED.recorded_by;

  PERFORM public.restore_paused_bookings_for_subscription(v_sub.id);

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
    'subscription_payment_state_changed',
    jsonb_build_object('paid', COALESCE(v_sub.paid, false)),
    jsonb_build_object('paid', true),
    jsonb_build_object(
      'reason', COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija'),
      'payment_id', (
        SELECT id
        FROM public.subscription_payments
        WHERE subscription_id = v_sub.id
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'paid', true
  );
END;
$admin_paid$;


CREATE OR REPLACE FUNCTION public.admin_mark_subscription_unpaid(
  _subscription_id uuid,
  _reason text DEFAULT 'Pakeitė administracija'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $admin_unpaid$
DECLARE
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT *
    INTO v_sub
  FROM public.subscriptions
  WHERE id = _subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND';
  END IF;

  PERFORM set_config('equus.allow_subscription_payment_update', 'true', true);
  PERFORM set_config('equus.allow_subscription_financial_update', 'true', true);

  DELETE FROM public.subscription_payments
  WHERE subscription_id = v_sub.id;

  UPDATE public.subscriptions
  SET paid = false
  WHERE id = v_sub.id;

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
    'subscription_payment_state_changed',
    jsonb_build_object('paid', COALESCE(v_sub.paid, false)),
    jsonb_build_object('paid', false),
    jsonb_build_object(
      'reason', COALESCE(NULLIF(trim(_reason), ''), 'Pakeitė administracija')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub.id,
    'paid', false
  );
END;
$admin_unpaid$;

REVOKE ALL
ON FUNCTION public.admin_mark_subscription_paid(uuid,text)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.admin_mark_subscription_unpaid(uuid,text)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_mark_subscription_paid(uuid,text)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_mark_subscription_unpaid(uuid,text)
TO authenticated;
