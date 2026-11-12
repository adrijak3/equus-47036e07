-- Applied to live Supabase on 2026-11-12.
-- Removing only the 3-hour register/transfer cutoff; past lessons remain closed.
-- Capacity, subscription eligibility and 24-hour cancellation rules are unchanged.

CREATE OR REPLACE FUNCTION public.enforce_3_hour_cutoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
    is_admin BOOLEAN;
    lesson_datetime TIMESTAMPTZ;
BEGIN

    -- Special server-side bypass used only when the system is
    -- materializing Nuolatiniai bookings.
    IF current_setting(
        'equus.allow_permanent_materialization',
        true
    ) = 'true' THEN
        RETURN NEW;
    END IF;

    -- Normal admin bypass.
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role = 'admin'
    )
    INTO is_admin;

    IF is_admin THEN
        RETURN NEW;
    END IF;

    -- Only reject bookings after lesson start, in Lithuania local time.
    lesson_datetime := (NEW.slot_date::text || ' ' || NEW.slot_time::text || ' Europe/Vilnius')::timestamptz;

    IF lesson_datetime <= now() THEN
        RAISE EXCEPTION
            'Pasibaigus treniruotės pradžios laikui registruotis nebegalima.';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_three_hour_booking_cutoff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  starts_at timestamptz;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF caller IS NOT NULL AND public.has_role(caller, 'admin') THEN
    RETURN NEW;
  END IF;

  starts_at := (NEW.slot_date::text || ' ' || NEW.slot_time::text || ' Europe/Vilnius')::timestamptz;

  IF starts_at <= now() THEN
    RAISE EXCEPTION 'BOOKING_STARTED'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_permanent_bookings(_start date, _end date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_count integer := 0;
  ps record;
  d date;
  v_capacity integer;
  v_occupied integer;
BEGIN
  PERFORM set_config('equus.allow_permanent_materialization', 'true', true);

  IF _end < _start THEN
    RETURN 0;
  END IF;

  FOR ps IN
    SELECT user_id, day_of_week, slot_time
    FROM public.permanent_slots
  LOOP
    d := _start;

    WHILE d <= _end LOOP
      IF EXTRACT(ISODOW FROM d)::integer = ps.day_of_week
        AND NOT EXISTS (
          SELECT 1
          FROM public.slot_overrides so
          WHERE so.slot_date = d
            AND so.slot_time = ps.slot_time
            AND so.max_capacity = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.permanent_booking_exceptions pbe
          WHERE pbe.user_id = ps.user_id
            AND pbe.slot_date = d
            AND pbe.slot_time = ps.slot_time
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.vacations v
          WHERE v.user_id = ps.user_id
            AND d BETWEEN v.starts_on AND v.ends_on
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings b
          WHERE b.user_id = ps.user_id
            AND b.slot_date = d
            AND b.slot_time = ps.slot_time
            AND b.status IN ('active', 'pending_cancel', 'completed')
        )
        AND (
          d > (now() AT TIME ZONE 'Europe/Vilnius')::date
          OR make_timestamptz(
            EXTRACT(YEAR FROM d)::integer,
            EXTRACT(MONTH FROM d)::integer,
            EXTRACT(DAY FROM d)::integer,
            EXTRACT(HOUR FROM ps.slot_time)::integer,
            EXTRACT(MINUTE FROM ps.slot_time)::integer,
            EXTRACT(SECOND FROM ps.slot_time),
            'Europe/Vilnius'
          ) > now()
        )
      THEN
        v_capacity := public.equus_effective_slot_capacity(d, ps.slot_time);

        SELECT count(*)::integer
          INTO v_occupied
        FROM public.bookings occupied
        WHERE occupied.slot_date = d
          AND occupied.slot_time = ps.slot_time
          AND occupied.status IN ('active', 'pending_cancel')
          AND occupied.is_paused_for_subscription IS NOT TRUE;

        -- A permanent booking is never paused for subscription reasons.
        -- If there is no capacity, leave this occurrence unmaterialized.
        IF v_occupied < v_capacity THEN
          BEGIN
            INSERT INTO public.bookings (
              user_id,
              slot_date,
              slot_time,
              status,
              counts_in_subscription,
              is_paused_for_subscription,
              is_grace_booking
            )
            VALUES (
              ps.user_id,
              d,
              ps.slot_time,
              'active',
              true,
              false,
              false
            );

            inserted_count := inserted_count + 1;
          EXCEPTION
            WHEN unique_violation THEN
              NULL;
          END;
        END IF;
      END IF;

      d := d + 1;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_booking_same_day(_booking_id uuid, _target_slot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  b public.bookings%rowtype;
  target_slot public.time_slots%rowtype;
  target_capacity integer;
  target_count integer;
  target_start timestamp;
  assigned_horse uuid;
  old_slot_time time;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;

  IF b.user_id <> caller
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF b.status <> 'active' THEN RAISE EXCEPTION 'BOOKING_NOT_ACTIVE'; END IF;

  SELECT * INTO target_slot
  FROM public.time_slots
  WHERE id = _target_slot_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'SLOT_NOT_FOUND'; END IF;

  IF extract(isodow FROM b.slot_date)::integer <> target_slot.day_of_week THEN
    RAISE EXCEPTION 'SLOT_WRONG_DAY';
  END IF;

  IF target_slot.slot_time = b.slot_time
     AND target_slot.trainer_name IS NOT DISTINCT FROM b.trainer_name THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'booking_id', b.id);
  END IF;

  target_start := (b.slot_date + target_slot.slot_time)::timestamp;
  IF target_start <= (now() AT TIME ZONE 'Europe/Vilnius') THEN RAISE EXCEPTION 'BOOKING_STARTED'; END IF;

  SELECT COALESCE(
    (SELECT so.max_capacity FROM public.slot_overrides so
     WHERE so.slot_date = b.slot_date AND so.slot_time = target_slot.slot_time),
    target_slot.max_capacity
  ) INTO target_capacity;

  SELECT count(*) INTO target_count
  FROM public.bookings x
  WHERE x.id <> b.id
    AND x.slot_date = b.slot_date
    AND x.slot_time = target_slot.slot_time
    AND x.status IN ('active', 'pending_cancel')
    AND x.trainer_name IS NOT DISTINCT FROM target_slot.trainer_name;

  IF target_count >= target_capacity THEN RAISE EXCEPTION 'SLOT_FULL'; END IF;

  SELECT ha.horse_id INTO assigned_horse
  FROM public.horse_assignments ha
  WHERE ha.booking_id = b.id
  LIMIT 1;

  IF assigned_horse IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.horse_assignments ha
    WHERE ha.booking_id <> b.id
      AND ha.slot_date = b.slot_date
      AND ha.slot_time = target_slot.slot_time
      AND ha.horse_id = assigned_horse
  ) THEN
    RAISE EXCEPTION 'HORSE_NOT_AVAILABLE';
  END IF;

  old_slot_time := b.slot_time;

  UPDATE public.bookings
  SET slot_time = target_slot.slot_time,
      trainer_name = target_slot.trainer_name,
      updated_at = now()
  WHERE id = b.id;

  UPDATE public.horse_assignments
  SET slot_time = target_slot.slot_time
  WHERE booking_id = b.id AND slot_date = b.slot_date;

  UPDATE public.horse_requests
  SET slot_time = target_slot.slot_time
  WHERE user_id = b.user_id
    AND slot_date = b.slot_date
    AND slot_time = old_slot_time;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', b.id,
    'slot_date', b.slot_date,
    'slot_time', target_slot.slot_time,
    'trainer_name', target_slot.trainer_name
  );
END;
$function$;

