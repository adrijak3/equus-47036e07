-- Equus: half-admin add-on role.
-- Additive role: it does not replace user/admin/trainer.
-- Half-admin may scan QR, view subscriptions and purchase subscriptions.
-- It may not update/delete subscription records or enter the full Admin area.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'half_admin';

DROP POLICY IF EXISTS "Users view own subs" ON public.subscriptions;
CREATE POLICY "Users view own subs" ON public.subscriptions
  FOR SELECT
  USING (
    owns_profile(auth.uid(), user_id)
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'trainer')
    OR has_role(auth.uid(), 'half_admin')
  );

CREATE OR REPLACE FUNCTION public.resolve_client_qr(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _caller uuid := auth.uid();
  _user_id uuid;
  _profile public.profiles%ROWTYPE;
  _current_sub jsonb;
  _next_sub jsonb;
  _reservations jsonb;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.has_role(_caller, 'admin'::public.app_role)
    OR public.has_role(_caller, 'trainer'::public.app_role)
    OR public.has_role(_caller, 'half_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY' USING ERRCODE = 'P0001';
  END IF;

  IF _token IS NULL OR length(trim(_token)) < 32 OR length(trim(_token)) > 200 THEN
    RAISE EXCEPTION 'INVALID_QR' USING ERRCODE = 'P0001';
  END IF;

  SELECT q.user_id INTO _user_id
  FROM public.client_qr_tokens q
  WHERE q.token_hash = encode(extensions.digest(trim(_token), 'sha256'), 'hex')
    AND q.token = trim(_token)
    AND q.revoked_at IS NULL;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'QR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _profile FROM public.profiles WHERE id = _user_id;

  SELECT to_jsonb(s) INTO _current_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND COALESCE(s.paid, false) = true
    AND s.expires_at >= current_date
    AND COALESCE(s.start_from_date, s.purchase_date) <= current_date
    AND COALESCE(s.cancelled_at IS NULL, true)
    AND s.lessons_used < s.lessons_total
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date DESC
  LIMIT 1;

  SELECT to_jsonb(s) INTO _next_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND COALESCE(s.paid, false) = true
    AND COALESCE(s.start_from_date, s.purchase_date) > current_date
    AND COALESCE(s.cancelled_at IS NULL, true)
    AND s.lessons_used < s.lessons_total
  ORDER BY COALESCE(s.start_from_date, s.purchase_date), s.purchase_date DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.slot_date, b.slot_time), '[]'::jsonb)
    INTO _reservations
  FROM (
    SELECT *
    FROM public.bookings b
    WHERE b.user_id = _user_id
      AND b.status = 'active'
      AND (b.slot_date::date + b.slot_time::time) >= now()
    ORDER BY b.slot_date, b.slot_time
    LIMIT 10
  ) b;

  RETURN jsonb_build_object(
    'ok', true,
    'client', jsonb_build_object(
      'id', _profile.id,
      'full_name', _profile.full_name,
      'email', (SELECT email FROM auth.users WHERE id = _user_id),
      'phone', _profile.phone
    ),
    'subscription', COALESCE(_current_sub, 'null'::jsonb),
    'next_subscription', COALESCE(_next_sub, 'null'::jsonb),
    'reservations', _reservations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_client_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_client_qr(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.half_admin_purchase_subscription(
  _user_id uuid,
  _lessons_total smallint,
  _package_type text,
  _horse_type text,
  _allocation_mode text DEFAULT 'none',
  _payment_method text DEFAULT 'cash'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_actor, 'half_admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  -- Reuse the exact existing purchase system. The called function remains
  -- responsible for price validation, allocation, payment recording and email.
  RETURN public.admin_purchase_subscription(
    _user_id,
    _lessons_total,
    _package_type,
    _horse_type,
    _allocation_mode,
    _payment_method
  );
END;
$$;

REVOKE ALL ON FUNCTION public.half_admin_purchase_subscription(uuid,smallint,text,text,text,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.half_admin_purchase_subscription(uuid,smallint,text,text,text,text)
TO authenticated;
