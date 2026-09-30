-- QR attendance confirmation: staff can mark a client's same-day booking as checked in.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS bookings_checked_in_by_idx
  ON public.bookings(checked_in_by);

CREATE OR REPLACE FUNCTION public.confirm_client_qr_attendance(_token text, _booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _caller uuid := auth.uid();
  _user_id uuid;
  _booking public.bookings%ROWTYPE;
  _today date := timezone('Europe/Vilnius', now())::date;
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
  INTO _booking
  FROM public.bookings b
  WHERE b.id = _booking_id
    AND b.user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF _booking.status <> 'active' THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  IF _booking.slot_date::date <> _today THEN
    RAISE EXCEPTION 'BOOKING_NOT_TODAY' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bookings
  SET checked_in_at = COALESCE(checked_in_at, now()),
      checked_in_by = COALESCE(checked_in_by, _caller)
  WHERE id = _booking.id;

  SELECT *
  INTO _booking
  FROM public.bookings
  WHERE id = _booking.id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking.id,
    'checked_in_at', _booking.checked_in_at,
    'checked_in_by', _booking.checked_in_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_client_qr_attendance(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_client_qr_attendance(text, uuid) TO authenticated;
