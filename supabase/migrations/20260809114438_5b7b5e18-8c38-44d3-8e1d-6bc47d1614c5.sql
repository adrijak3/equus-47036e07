ALTER TABLE public.public_registration_requests ADD COLUMN IF NOT EXISTS client_note text;

ALTER TABLE public.public_registration_requests DROP CONSTRAINT IF EXISTS public_registration_requests_status_check;
ALTER TABLE public.public_registration_requests ADD CONSTRAINT public_registration_requests_status_check
  CHECK (status = ANY (ARRAY['pending','proposed','accepted','approved','confirmed','reschedule','rejected','cancelled','completed']));

CREATE OR REPLACE FUNCTION public.respond_to_public_registration(_token uuid, _action text, _message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.public_registration_requests%rowtype;
  d date;
  t time;
  admin_id uuid;
  is_new boolean;
  label text;
BEGIN
  SELECT * INTO r FROM public.public_registration_requests WHERE public_token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registracija nerasta'; END IF;

  IF _action = 'cancel' THEN
    UPDATE public.public_registration_requests
       SET status = 'cancelled', client_note = COALESCE(NULLIF(btrim(_message),''), client_note), updated_at = now()
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
  END IF;

  IF _action = 'reschedule' THEN
    UPDATE public.public_registration_requests
       SET status = 'reschedule', client_note = NULLIF(btrim(_message),''), updated_at = now()
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'status', 'reschedule');
  END IF;

  IF _action <> 'confirm' THEN RAISE EXCEPTION 'Neteisingas veiksmas'; END IF;

  IF r.status NOT IN ('proposed','approved','accepted') THEN
    RAISE EXCEPTION 'Šiuo metu patvirtinti negalima';
  END IF;

  d := COALESCE(r.proposed_date, r.requested_date);
  t := COALESCE(r.proposed_time, r.requested_time);
  IF d IS NULL OR t IS NULL THEN RAISE EXCEPTION 'Laikas dar nepaskirtas'; END IF;

  SELECT user_id INTO admin_id FROM public.user_roles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'Nėra administratoriaus paskyros'; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.phone IS NOT NULL
       AND regexp_replace(p.phone, '\D', '', 'g') = regexp_replace(r.phone, '\D', '', 'g')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.public_registration_requests o
     WHERE o.id <> r.id
       AND regexp_replace(o.phone, '\D', '', 'g') = regexp_replace(r.phone, '\D', '', 'g')
       AND o.status IN ('confirmed','completed')
  ) INTO is_new;

  label := btrim(r.first_name || ' ' || r.last_name) || CASE WHEN is_new THEN ' (naujokė)' ELSE '' END;

  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.slot_date = d AND b.slot_time = t AND b.is_guest AND b.guest_name = label AND b.status = 'active'
  ) THEN
    INSERT INTO public.bookings (user_id, slot_date, slot_time, status, is_guest, guest_name)
    VALUES (admin_id, d, t, 'active', true, label);
  END IF;

  UPDATE public.public_registration_requests
     SET status = 'confirmed', client_note = COALESCE(NULLIF(btrim(_message),''), client_note), updated_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'status', 'confirmed', 'slot_date', d, 'slot_time', t, 'is_new', is_new);
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_public_registration(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_public_registration(uuid, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_public_registrations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE removed integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.public_registration_requests
     WHERE COALESCE(proposed_date, requested_date, created_at::date) < (current_date - 7)
    RETURNING 1
  )
  SELECT count(*) INTO removed FROM del;
  RETURN removed;
END;
$$;