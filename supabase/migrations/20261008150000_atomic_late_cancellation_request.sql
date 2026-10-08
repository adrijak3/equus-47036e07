-- Equus: make late cancellation + admin review request atomic.
--
-- A late cancellation must always leave a pending cancellation_requests row when
-- the booking cancellation succeeds. The old frontend flow performed these as
-- two separate writes, so a successful booking cancellation followed by a
-- failed request INSERT could leave the rider with no admin request.
--
-- Insert the request first so the booking-cancellation audit trigger can also
-- capture the user's actual cancellation reason.

CREATE OR REPLACE FUNCTION public.request_booking_cancellation(
  _booking_id uuid,
  _reason text,
  _sickness boolean DEFAULT false,
  _document_url text DEFAULT NULL,
  _document_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $equus_request_cancel$
DECLARE
  v_actor uuid := auth.uid();
  v_booking public.bookings%ROWTYPE;
  v_request_id uuid;
  v_reason text := btrim(COALESCE(_reason, ''));
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Neprisijungta.'
    );
  END IF;

  IF _booking_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Registracija nerasta.'
    );
  END IF;

  SELECT *
    INTO v_booking
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Registracija nerasta.'
    );
  END IF;

  -- Admin/trainer are privileged staff paths. Normal riders may only act on
  -- their own or linked profile bookings.
  IF NOT (
    public.has_role(v_actor, 'admin')
    OR public.has_role(v_actor, 'trainer')
    OR public.owns_profile(v_actor, v_booking.user_id)
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Neturite teisės atšaukti šios registracijos.'
    );
  END IF;

  IF v_booking.status <> 'active' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Registracija nebeaktyvi.'
    );
  END IF;

  IF NOT _sickness AND char_length(v_reason) < 3 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Įveskite atšaukimo priežastį.'
    );
  END IF;

  IF _sickness AND char_length(v_reason) = 0 THEN
    v_reason := 'Liga';
  END IF;

  -- Do not create duplicate pending requests for the same booking.
  IF EXISTS (
    SELECT 1
    FROM public.cancellation_requests cr
    WHERE cr.booking_id = v_booking.id
      AND cr.status = 'pending'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'message', 'Šios pamokos atšaukimo prašymas jau pateiktas.'
    );
  END IF;

  INSERT INTO public.cancellation_requests (
    booking_id,
    user_id,
    reason,
    sickness,
    status,
    admin_decision_counts,
    document_url,
    document_uploaded_at,
    document_deadline
  )
  VALUES (
    v_booking.id,
    v_booking.user_id,
    v_reason,
    COALESCE(_sickness, false),
    'pending',
    NULL,
    NULLIF(_document_url, ''),
    CASE
      WHEN NULLIF(_document_url, '') IS NOT NULL THEN now()
      ELSE NULL
    END,
    _document_deadline
  )
  RETURNING id INTO v_request_id;

  -- Reuse the already-authoritative cancellation operation. Because this
  -- function is one transaction, any failure rolls back the request INSERT.
  PERFORM public.cancel_booking_occurrence(v_booking.id);

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'booking_id', v_booking.id
  );
END;
$equus_request_cancel$;

REVOKE ALL
ON FUNCTION public.request_booking_cancellation(uuid,text,boolean,text,date)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.request_booking_cancellation(uuid,text,boolean,text,date)
TO authenticated;
