-- Repair the live schema if the original permanent-slot request table is
-- missing despite its historical migration being marked as applied.
CREATE TABLE IF NOT EXISTS public.permanent_slot_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  day_of_week int not null check (day_of_week between 1 and 7),
  slot_time time not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);

ALTER TABLE public.permanent_slot_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own permanent requests" ON public.permanent_slot_requests;
CREATE POLICY "users read own permanent requests"
  ON public.permanent_slot_requests
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "users create own permanent requests" ON public.permanent_slot_requests;
CREATE POLICY "users create own permanent requests"
  ON public.permanent_slot_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admins update permanent requests" ON public.permanent_slot_requests;
CREATE POLICY "admins update permanent requests"
  ON public.permanent_slot_requests
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Finalize permanent-slot and Atostogos behavior:
--   1. Every path that ADDS/APPROVES a recurring slot starts tomorrow.
--   2. User Atostogos cancel all of that user's active/pending lessons
--      in the selected range, including already-materialized recurring ones.
--   3. Only recurring occurrences get permanent exceptions, so materialization
--      cannot recreate them during the vacation.
--   4. The permanent slot remains intact and resumes after the vacation.

CREATE OR REPLACE FUNCTION public.request_or_create_permanent_slot(
  _day int,
  _time time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cap int;
  _existing int;
  _conflict record;
  _tomorrow date := (now() AT TIME ZONE 'Europe/Vilnius')::date + 1;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Prisijunkite';
  END IF;

  SELECT max_capacity
    INTO _cap
  FROM public.time_slots
  WHERE active = true
    AND one_off_date IS NULL
    AND day_of_week = _day
    AND slot_time = _time
  LIMIT 1;

  IF _cap IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Šio laiko grafike nėra.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.permanent_slots
    WHERE user_id = _uid
      AND day_of_week = _day
      AND slot_time = _time
  ) THEN
    RETURN jsonb_build_object('ok',false,'message','Šį nuolatinį laiką jau turite.');
  END IF;

  IF _cap <= 2 THEN
    INSERT INTO public.permanent_slot_requests(user_id,day_of_week,slot_time)
    VALUES(_uid,_day,_time);

    RETURN jsonb_build_object(
      'ok',true,
      'requested',true,
      'message','Prašymas išsiųstas administracijai.'
    );
  END IF;

  SELECT count(*)
    INTO _existing
  FROM public.permanent_slots
  WHERE day_of_week = _day
    AND slot_time = _time;

  IF _existing >= 5 THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message','Šis laikas jau turi 5 nuolatines vietas.'
    );
  END IF;

  SELECT b.slot_date, count(*) AS taken
    INTO _conflict
  FROM public.bookings b
  WHERE b.slot_time = _time
    AND b.status IN ('active','completed')
    AND b.slot_date >= _tomorrow
    AND extract(isodow from b.slot_date)::int = _day
  GROUP BY b.slot_date
  HAVING count(*) + 1 > coalesce(
    (
      SELECT so.max_capacity
      FROM public.slot_overrides so
      WHERE so.slot_date = b.slot_date
        AND so.slot_time = _time
      LIMIT 1
    ),
    _cap
  )
  ORDER BY b.slot_date
  LIMIT 1;

  IF found THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message',format(
        'Negalima pridėti: %s ši treniruotė jau būtų virš talpos.',
        _conflict.slot_date
      )
    );
  END IF;

  INSERT INTO public.permanent_slots(user_id,day_of_week,slot_time)
  VALUES(_uid,_day,_time);

  -- The INSERT trigger also materializes from tomorrow. This explicit call
  -- is intentionally kept idempotent and uses the same tomorrow boundary.
  PERFORM public.materialize_permanent_bookings(
    _tomorrow,
    _tomorrow + 120
  );

  RETURN jsonb_build_object(
    'ok',true,
    'requested',false,
    'message','Nuolatinis laikas pridėtas.'
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.decide_permanent_slot_request(
  _request_id uuid,
  _approve boolean,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  r public.permanent_slot_requests%rowtype;
  _cap int;
  _existing int;
  _tomorrow date := (now() AT TIME ZONE 'Europe/Vilnius')::date + 1;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Tik administratorius';
  END IF;

  SELECT *
    INTO r
  FROM public.permanent_slot_requests
  WHERE id = _request_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message','Prašymas neberastas.'
    );
  END IF;

  IF NOT _approve THEN
    UPDATE public.permanent_slot_requests
    SET
      status = 'rejected',
      admin_note = _note,
      decided_at = now(),
      decided_by = auth.uid()
    WHERE id = r.id;

    RETURN jsonb_build_object('ok',true);
  END IF;

  SELECT max_capacity
    INTO _cap
  FROM public.time_slots
  WHERE active = true
    AND one_off_date IS NULL
    AND day_of_week = r.day_of_week
    AND slot_time = r.slot_time
  LIMIT 1;

  SELECT count(*)
    INTO _existing
  FROM public.permanent_slots
  WHERE day_of_week = r.day_of_week
    AND slot_time = r.slot_time;

  IF _existing >= 5 THEN
    RETURN jsonb_build_object(
      'ok',false,
      'message','Šis laikas jau turi 5 nuolatines vietas.'
    );
  END IF;

  INSERT INTO public.permanent_slots(user_id,day_of_week,slot_time)
  VALUES(r.user_id,r.day_of_week,r.slot_time)
  ON CONFLICT DO NOTHING;

  UPDATE public.permanent_slot_requests
  SET
    status = 'approved',
    admin_note = _note,
    decided_at = now(),
    decided_by = auth.uid()
  WHERE id = r.id;

  PERFORM public.materialize_permanent_bookings(
    _tomorrow,
    _tomorrow + 120
  );

  RETURN jsonb_build_object('ok',true);
END;
$function$;


CREATE OR REPLACE FUNCTION public.add_vacation_and_cancel(
  _user_id uuid,
  _starts_on date,
  _ends_on date,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  caller uuid := auth.uid();
  vac_id uuid;
  cancelled_count integer := 0;
  exception_count integer := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'USER_REQUIRED';
  END IF;

  IF _ends_on < _starts_on THEN
    RAISE EXCEPTION 'INVALID_RANGE';
  END IF;

  IF caller <> _user_id
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, _user_id)
  THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  INSERT INTO public.vacations (
    user_id,
    starts_on,
    ends_on,
    note
  )
  VALUES (
    _user_id,
    _starts_on,
    _ends_on,
    NULLIF(btrim(_note), '')
  )
  RETURNING id INTO vac_id;

  -- First create exceptions for every recurring occurrence in the range.
  -- The permanent slot remains active; only these occurrences are suppressed.
  INSERT INTO public.permanent_booking_exceptions (
    user_id,
    slot_date,
    slot_time
  )
  SELECT
    ps.user_id,
    d::date,
    ps.slot_time
  FROM public.permanent_slots ps
  CROSS JOIN LATERAL generate_series(
    _starts_on,
    _ends_on,
    interval '1 day'
  ) AS d
  WHERE ps.user_id = _user_id
    AND ps.day_of_week = EXTRACT(ISODOW FROM d)::integer
  ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;

  GET DIAGNOSTICS exception_count = ROW_COUNT;

  -- Atostogos means the user's active/pending lessons in the selected
  -- range are cancelled, including recurring occurrences already
  -- materialized in the schedule.
  WITH cancelled AS (
    UPDATE public.bookings b
    SET
      status = 'cancelled',
      counts_in_subscription = false
    WHERE b.user_id = _user_id
      AND b.status IN ('active', 'pending_cancel')
      AND b.slot_date BETWEEN _starts_on AND _ends_on
    RETURNING b.id
  )
  SELECT count(*) INTO cancelled_count
  FROM cancelled;

  RETURN jsonb_build_object(
    'vacation_id', vac_id,
    'cancelled_bookings', cancelled_count,
    'recurring_exceptions', exception_count
  );
END;
$function$;


REVOKE ALL
ON FUNCTION public.request_or_create_permanent_slot(int,time)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.request_or_create_permanent_slot(int,time)
TO authenticated;

REVOKE ALL
ON FUNCTION public.decide_permanent_slot_request(uuid,boolean,text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.decide_permanent_slot_request(uuid,boolean,text)
TO authenticated;

REVOKE ALL
ON FUNCTION public.add_vacation_and_cancel(uuid,date,date,text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.add_vacation_and_cancel(uuid,date,date,text)
TO authenticated;
