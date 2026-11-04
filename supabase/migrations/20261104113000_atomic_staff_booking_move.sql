-- Move a staff-managed booking by updating the existing booking row.
-- The operation is atomic: if capacity, horse assignment, or any other
-- constraint fails, neither the old booking nor its horse is changed.
-- Recurrent original slots are recorded as exceptions to prevent an old
-- occurrence being re-created after a manual move.
CREATE OR REPLACE FUNCTION public.staff_move_booking(
  _booking_id uuid,
  _new_date date,
  _new_time time without time zone
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_old public.bookings%rowtype;
  v_trainer text;
  v_capacity integer;
  v_occupied integer;
  v_changed integer;
  v_old_permanent boolean;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role(v_actor, 'admin'::public.app_role)
    OR public.has_role(v_actor, 'trainer'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _booking_id IS NULL OR _new_date IS NULL OR _new_time IS NULL THEN
    RAISE EXCEPTION 'INVALID_MOVE_TARGET' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_old FROM public.bookings
  WHERE id = _booking_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_old.status NOT IN ('active', 'pending_cancel') THEN
    RAISE EXCEPTION 'BOOKING_NOT_ACTIVE' USING ERRCODE = 'check_violation';
  END IF;
  IF _new_date = v_old.slot_date AND _new_time = v_old.slot_time THEN
    RAISE EXCEPTION 'SAME_TIME' USING ERRCODE = 'check_violation';
  END IF;

  -- Match an actual configured schedule slot on the target date.
  -- Prefer staying with the same trainer, so a move does not silently
  -- transfer a rider to someone else's class.
  SELECT ts.trainer_name INTO v_trainer
  FROM public.time_slots ts
  WHERE ts.active = true
    AND ts.slot_time = _new_time
    AND (ts.one_off_date = _new_date
      OR (ts.one_off_date IS NULL
          AND ts.day_of_week = extract(isodow FROM _new_date)::integer))
    AND ts.trainer_name IS NOT DISTINCT FROM v_old.trainer_name
  ORDER BY (ts.one_off_date IS NOT NULL) DESC, ts.max_capacity DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- A slot with no trainer can be used when there is only one
    -- matching configured target and the rider came from a named group.
    SELECT ts.trainer_name INTO v_trainer
    FROM public.time_slots ts
    WHERE ts.active = true
      AND ts.slot_time = _new_time
      AND (ts.one_off_date = _new_date
        OR (ts.one_off_date IS NULL
            AND ts.day_of_week = extract(isodow FROM _new_date)::integer))
    ORDER BY (ts.one_off_date IS NOT NULL) DESC, ts.max_capacity DESC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SLOT_NOT_FOUND' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('equus-slot:' || _new_date::text || ':' || _new_time::text, 0)
  );

  SELECT public.equus_effective_slot_capacity(_new_date, _new_time)
  INTO v_capacity;
  IF v_capacity <= 0 THEN
    RAISE EXCEPTION 'SLOT_NOT_AVAILABLE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer INTO v_occupied
  FROM public.bookings b
  WHERE b.id <> v_old.id
    AND b.slot_date = _new_date
    AND b.slot_time = _new_time
    AND b.status IN ('active','pending_cancel')
    AND b.is_paused_for_subscription IS NOT TRUE;

  IF v_occupied >= v_capacity THEN
    RAISE EXCEPTION 'SLOT_FULL' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id <> v_old.id
      AND b.slot_date = _new_date AND b.slot_time = _new_time
      AND b.status IN ('active','pending_cancel')
      AND (
        (v_old.user_id IS NOT NULL AND b.user_id = v_old.user_id
          AND b.family_rider_id IS NOT DISTINCT FROM v_old.family_rider_id)
        OR (v_old.guest_rider_id IS NOT NULL AND b.guest_rider_id = v_old.guest_rider_id)
      )
  ) THEN
    RAISE EXCEPTION 'RIDER_ALREADY_BOOKED' USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.horse_assignments assigned
    JOIN public.horse_assignments other
      ON other.horse_id = assigned.horse_id
     AND other.slot_date = _new_date
     AND other.slot_time = _new_time
     AND other.booking_id IS DISTINCT FROM assigned.booking_id
    WHERE assigned.booking_id = v_old.id
  ) THEN
    RAISE EXCEPTION 'HORSE_NOT_AVAILABLE' USING ERRCODE = 'unique_violation';
  END IF;

  v_old_permanent := public.booking_is_permanent(v_old.id);

  UPDATE public.bookings
  SET slot_date = _new_date,
      slot_time = _new_time,
      trainer_name = v_trainer,
      updated_at = now()
  WHERE id = v_old.id
    AND status IN ('active','pending_cancel');

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed <> 1 THEN
    RAISE EXCEPTION 'BOOKING_MOVE_NOT_SAVED' USING ERRCODE = 'check_violation';
  END IF;

  -- Synchronize the assignment in the same transaction. If the
  -- target horse/day violates a unique or weekday limit, roll back.
  UPDATE public.horse_assignments
  SET slot_date = _new_date,
      slot_time = _new_time
  WHERE booking_id = v_old.id;

  -- A request is associated with the original date/time, so move it
  -- together with the reservation where there is one.
  IF v_old.user_id IS NOT NULL THEN
    UPDATE public.horse_requests
    SET slot_date = _new_date, slot_time = _new_time
    WHERE user_id = v_old.user_id
      AND slot_date = v_old.slot_date
      AND slot_time = v_old.slot_time;
  END IF;

  IF v_old_permanent
     AND v_old.slot_date >= (now() AT TIME ZONE 'Europe/Vilnius')::date
     AND v_old.user_id IS NOT NULL
  THEN
    INSERT INTO public.permanent_booking_exceptions(user_id, slot_date, slot_time)
    VALUES (v_old.user_id, v_old.slot_date, v_old.slot_time)
    ON CONFLICT (user_id, slot_date, slot_time) DO NOTHING;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = v_old.id
       AND b.slot_date = _new_date AND b.slot_time = _new_time
       AND b.status IN ('active','pending_cancel')
  ) THEN
    RAISE EXCEPTION 'BOOKING_MOVE_NOT_SAVED' USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_old.id,
    'old_date', v_old.slot_date,
    'old_time', v_old.slot_time,
    'new_date', _new_date,
    'new_time', _new_time
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_move_booking(uuid,date,time without time zone)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_move_booking(uuid,date,time without time zone)
  TO authenticated;
