-- 1) Remove beginner/independent ratio rule for trainer group lessons: flat max 4
CREATE OR REPLACE FUNCTION public.enforce_trainer_group_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  dow int := CASE WHEN extract(dow FROM NEW.slot_date)::int = 0 THEN 7 ELSE extract(dow FROM NEW.slot_date)::int END;
  trainer text;
  total int := 0;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  IF caller IS NOT NULL AND (public.has_role(caller, 'admin') OR public.has_role(caller, 'trainer')) THEN
    RETURN NEW;
  END IF;

  trainer := NEW.trainer_name;
  IF trainer IS NULL THEN
    SELECT t.trainer_name INTO trainer
      FROM public.time_slots t
     WHERE t.active
       AND t.slot_time = NEW.slot_time
       AND t.trainer_name IS NOT NULL
       AND ((t.one_off_date IS NULL AND t.day_of_week = dow) OR t.one_off_date = NEW.slot_date)
     LIMIT 1;
  END IF;

  IF trainer IS NULL OR trainer NOT ILIKE '%Jolita%' THEN RETURN NEW; END IF;

  SELECT count(*) INTO total
    FROM public.bookings b
   WHERE b.slot_date = NEW.slot_date
     AND b.slot_time = NEW.slot_time
     AND b.status = 'active'
     AND b.trainer_name IS NOT DISTINCT FROM NEW.trainer_name
     AND b.id <> NEW.id;

  total := total + 1;

  IF total > 4 THEN
    RAISE EXCEPTION 'Grupė pilna — maksimalus dalyvių skaičius yra 4.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Accidental-registration flag on the cancellation audit log
ALTER TABLE public.booking_cancellations
  ADD COLUMN IF NOT EXISTS accidental boolean NOT NULL DEFAULT false;

-- 3) Accidental cancellation: allowed only within 2 hours of creating the booking.
--    Removes the booking entirely (no trace in the rider's history, never counted),
--    but keeps an audit entry flagged as accidental for admins.
CREATE OR REPLACE FUNCTION public.cancel_booking_accidental(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  b public.bookings%ROWTYPE;
  res jsonb;
BEGIN
  IF caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Neprisijungta.');
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Registracija nerasta.');
  END IF;

  IF NOT (
    b.user_id = caller
    OR b.created_by = caller
    OR public.has_role(caller, 'admin')
    OR public.has_role(caller, 'trainer')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Neturite teisės.');
  END IF;

  IF b.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Registracija nebeaktyvi.');
  END IF;

  IF now() - b.created_at > interval '2 hours' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Klaidingos registracijos atšaukimo laikas (2 val.) baigėsi.');
  END IF;

  res := public.cancel_booking_occurrence(_booking_id);
  IF COALESCE((res->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN res;
  END IF;

  UPDATE public.booking_cancellations
     SET accidental = true,
         reason = 'Registracija per klaidą'
   WHERE booking_id = _booking_id;

  DELETE FROM public.bookings WHERE id = _booking_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Registracija pašalinta.');
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_booking_accidental(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking_accidental(uuid) TO authenticated;