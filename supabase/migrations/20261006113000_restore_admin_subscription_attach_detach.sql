-- Restore the trusted admin attach/detach path after subscription
-- financial-field protection was hardened.
--
-- Normal client writes remain protected. Only this SECURITY DEFINER admin RPC
-- gets the transaction-local bypass, and it still requires an admin caller.

CREATE OR REPLACE FUNCTION public.admin_set_booking_subscription(
  _booking_id uuid,
  _subscription_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $admin_set_booking_subscription$
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

  UPDATE public.subscriptions s
  SET lessons_used = (
    SELECT count(*)
    FROM public.bookings b
    WHERE b.subscription_id = s.id
      AND b.status <> 'cancelled'
      AND b.counts_in_subscription IS NOT FALSE
  )
  WHERE s.id IN (old_sub, _subscription_id);

  RETURN jsonb_build_object(
    'ok', true,
    'previous_subscription', old_sub,
    'subscription', _subscription_id
  );
END;
$admin_set_booking_subscription$;

REVOKE ALL
ON FUNCTION public.admin_set_booking_subscription(uuid, uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.admin_set_booking_subscription(uuid, uuid)
TO authenticated;
