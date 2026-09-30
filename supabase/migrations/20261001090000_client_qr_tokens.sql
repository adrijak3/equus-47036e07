-- Client QR identity: opaque random bearer token, hashed for lookup and protected by RLS.
-- The raw token is intentionally non-PII and is only readable by its owner.
CREATE TABLE IF NOT EXISTS public.client_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

ALTER TABLE public.client_qr_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own client QR token" ON public.client_qr_tokens;
CREATE POLICY "Users view own client QR token"
ON public.client_qr_tokens
FOR SELECT
TO authenticated
USING (user_id = (select auth.uid()));

REVOKE ALL ON TABLE public.client_qr_tokens FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.client_qr_tokens FROM authenticated;
GRANT SELECT ON TABLE public.client_qr_tokens TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_client_qr_token()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid uuid := auth.uid();
  _token text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.has_role(_uid, 'admin'::public.app_role)
    OR public.has_role(_uid, 'trainer'::public.app_role)
    OR public.owns_profile(_uid, _uid)
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;

  _token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.client_qr_tokens(user_id, token, token_hash)
  VALUES (
    _uid,
    _token,
    encode(extensions.digest(_token, 'sha256'), 'hex')
  )
  ON CONFLICT (user_id) DO UPDATE
  SET token = EXCLUDED.token,
      token_hash = EXCLUDED.token_hash,
      rotated_at = now(),
      revoked_at = NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'token', _token,
    'rotated_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_client_qr()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.client_qr_tokens%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO _row
  FROM public.client_qr_tokens
  WHERE user_id = _uid
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_QR');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'token', _row.token,
    'created_at', _row.created_at,
    'rotated_at', _row.rotated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.regenerate_client_qr(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid uuid := auth.uid();
  _token text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'ADMIN_ONLY' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  _token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.client_qr_tokens(user_id, token, token_hash)
  VALUES (_user_id, _token, encode(extensions.digest(_token, 'sha256'), 'hex'))
  ON CONFLICT (user_id) DO UPDATE
  SET token = EXCLUDED.token,
      token_hash = EXCLUDED.token_hash,
      rotated_at = now(),
      revoked_at = NULL;

  RETURN jsonb_build_object('ok', true, 'token', _token, 'rotated_at', now());
END;
$$;

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
  _reservations jsonb;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    public.has_role(_caller, 'admin'::public.app_role)
    OR public.has_role(_caller, 'trainer'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAFF_ONLY' USING ERRCODE = 'P0001';
  END IF;

  IF _token IS NULL OR length(trim(_token)) < 32 OR length(trim(_token)) > 200 THEN
    RAISE EXCEPTION 'INVALID_QR' USING ERRCODE = 'P0001';
  END IF;

  SELECT q.user_id
  INTO _user_id
  FROM public.client_qr_tokens q
  WHERE q.token_hash = encode(extensions.digest(trim(_token), 'sha256'), 'hex')
    AND q.token = trim(_token)
    AND q.revoked_at IS NULL;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'QR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO _profile
  FROM public.profiles
  WHERE id = _user_id;

  SELECT to_jsonb(s)
  INTO _current_sub
  FROM public.subscriptions s
  WHERE s.user_id = _user_id
    AND COALESCE(s.paid, false) = true
    AND s.expires_at >= current_date
    AND COALESCE(s.cancelled_at IS NULL, true)
  ORDER BY
    CASE WHEN s.lessons_used < s.lessons_total THEN 0 ELSE 1 END,
    s.expires_at,
    s.purchase_date DESC
  LIMIT 1;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(b) ORDER BY b.slot_date, b.slot_time),
    '[]'::jsonb
  )
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
    'reservations', _reservations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_client_qr_token() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_client_qr() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.regenerate_client_qr(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_client_qr(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.issue_client_qr_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_client_qr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_client_qr(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_client_qr(text) TO authenticated;
