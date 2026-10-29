-- Add public individual riding lesson requests and correct saved sport lesson prices.
ALTER TABLE public.public_registration_requests
  DROP CONSTRAINT IF EXISTS public_registration_requests_service_type_check,
  DROP CONSTRAINT IF EXISTS public_registration_requests_price_eur_check;

ALTER TABLE public.public_registration_requests
  ADD CONSTRAINT public_registration_requests_service_type_check
    CHECK (service_type = ANY (ARRAY['mazylio_30'::text, 'mazylio_45'::text, 'sportine'::text, 'individuali'::text])),
  ADD CONSTRAINT public_registration_requests_price_eur_check
    CHECK (price_eur = ANY (ARRAY[20::numeric, 35::numeric, 40::numeric, 45::numeric, 50::numeric]));

CREATE OR REPLACE FUNCTION public.get_public_registration_slots(_days integer DEFAULT 45)
RETURNS TABLE(slot_date date, slot_time time without time zone, max_capacity integer, active_count bigint, lesson_type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH days AS (
    SELECT current_date + i AS d
    FROM generate_series(0, LEAST(GREATEST(_days, 1), 90)) i
  ),
  candidates AS (
    SELECT d.d AS slot_date, ts.slot_time, ts.max_capacity
    FROM days d
    JOIN public.time_slots ts
      ON ts.active = true
     AND (
       (ts.one_off_date IS NULL AND ts.day_of_week = extract(isodow FROM d.d)::int)
       OR ts.one_off_date = d.d
     )
    WHERE ts.max_capacity >= 1
  )
  SELECT
    c.slot_date,
    c.slot_time,
    c.max_capacity,
    count(b.id) FILTER (WHERE b.status IN ('active', 'completed', 'pending_cancel')) AS active_count,
    CASE
      WHEN c.max_capacity = 1 THEN 'individuali'
      WHEN c.max_capacity = 2 THEN 'porine'
      ELSE 'grupine'
    END
  FROM candidates c
  LEFT JOIN public.bookings b
    ON b.slot_date = c.slot_date
   AND b.slot_time = c.slot_time
  GROUP BY c.slot_date, c.slot_time, c.max_capacity
  ORDER BY c.slot_date, c.slot_time;
$function$;

CREATE OR REPLACE FUNCTION public.submit_public_registration_v2(
  _first_name text,
  _last_name text,
  _phone text,
  _email text,
  _age integer,
  _emergency_contact text,
  _service_type text,
  _experience_level text,
  _experience_notes text DEFAULT NULL::text,
  _preferred_times text DEFAULT NULL::text,
  _requested_date date DEFAULT NULL::date,
  _requested_time time without time zone DEFAULT NULL::time without time zone,
  _facebook_name text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, public_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  request_row public.public_registration_requests%rowtype;
  resolved_duration integer;
  resolved_price numeric(8,2);
  minimum_age integer;
  selected_capacity integer;
BEGIN
  IF _service_type NOT IN ('mazylio_30', 'mazylio_45', 'sportine', 'individuali') THEN
    RAISE EXCEPTION 'Neteisingas užsiėmimo tipas';
  END IF;

  IF _service_type = 'mazylio_30' THEN
    resolved_duration := 30;
    resolved_price := 20;
    minimum_age := 3;
  ELSIF _service_type = 'mazylio_45' THEN
    resolved_duration := 45;
    resolved_price := 35;
    minimum_age := 3;
  ELSIF _service_type = 'individuali' THEN
    resolved_duration := 45;
    resolved_price := 50;
    minimum_age := 10;
  ELSE
    resolved_duration := 45;
    resolved_price := 40;
    minimum_age := 10;
  END IF;

  IF _age < minimum_age OR _age > 90 THEN
    RAISE EXCEPTION 'Dalyvio amžius neatitinka pasirinkto užsiėmimo reikalavimų';
  END IF;

  IF _service_type IN ('sportine', 'individuali')
     AND _experience_level NOT IN ('beginner', 'intermediate', 'advanced') THEN
    RAISE EXCEPTION 'Neteisingas patirties lygis';
  END IF;

  -- Children and individual lessons are scheduled by the administration.
  IF _service_type IN ('mazylio_30', 'mazylio_45', 'individuali')
     OR (_service_type = 'sportine' AND _experience_level = 'beginner') THEN
    _requested_date := NULL;
    _requested_time := NULL;
  END IF;

  IF _requested_date IS NOT NULL THEN
    IF _requested_date < current_date
       OR _requested_date > current_date + 13 THEN
      RAISE EXCEPTION 'Galima pasirinkti tik artimiausių 2 savaičių laiką';
    END IF;

    SELECT slot.max_capacity
      INTO selected_capacity
    FROM public.get_public_registration_slots(13) slot
    WHERE slot.slot_date = _requested_date
      AND slot.slot_time = _requested_time
      AND slot.max_capacity >= 2
      AND slot.active_count < slot.max_capacity
    LIMIT 1;

    IF selected_capacity IS NULL THEN
      RAISE EXCEPTION 'Pasirinktas laikas nebėra laisvas';
    END IF;

    resolved_price := CASE WHEN selected_capacity = 2 THEN 45 ELSE 40 END;
  END IF;

  INSERT INTO public.public_registration_requests (
    first_name, last_name, phone, email, age, emergency_contact,
    service_type, duration_minutes, price_eur, experience_level,
    experience_notes, preferred_times, requested_date, requested_time,
    facebook_name
  )
  VALUES (
    trim(_first_name),
    trim(_last_name),
    trim(_phone),
    lower(trim(_email)),
    _age,
    trim(_emergency_contact),
    _service_type,
    resolved_duration,
    resolved_price,
    CASE
      WHEN _service_type IN ('sportine', 'individuali') THEN _experience_level
      ELSE 'beginner'
    END,
    nullif(trim(_experience_notes), ''),
    nullif(trim(_preferred_times), ''),
    _requested_date,
    _requested_time,
    nullif(trim(_facebook_name), '')
  )
  RETURNING * INTO request_row;

  RETURN QUERY SELECT request_row.id, request_row.public_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_propose_public_registration_time(
  _request_id uuid,
  _date date,
  _time time without time zone,
  _note text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  requested_service text;
  slot_capacity integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT service_type
    INTO requested_service
  FROM public.public_registration_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF requested_service IS NULL THEN
    RAISE EXCEPTION 'Registracijos prašymas nerastas';
  END IF;

  SELECT s.max_capacity
    INTO slot_capacity
  FROM public.get_public_registration_slots(90) s
  WHERE s.slot_date = _date
    AND s.slot_time = _time
    AND s.active_count < s.max_capacity
    AND (
      (requested_service = 'individuali' AND s.max_capacity = 1)
      OR (requested_service <> 'individuali' AND s.max_capacity >= 2)
    )
  LIMIT 1;

  IF slot_capacity IS NULL THEN
    RAISE EXCEPTION 'Laikas pilnas arba neegzistuoja';
  END IF;

  UPDATE public.public_registration_requests
  SET
    proposed_date = _date,
    proposed_time = _time,
    admin_note = _note,
    status = 'proposed',
    price_eur = CASE
      WHEN requested_service = 'individuali' THEN 50
      WHEN slot_capacity = 2 THEN 45
      ELSE 40
    END,
    updated_at = now()
  WHERE id = _request_id;
END;
$function$;
