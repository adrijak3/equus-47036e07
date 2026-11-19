-- Restore a one-day moved lesson to its recurring clock time.
-- Previous UI set the original time's override to zero, so a normal
-- capacity check incorrectly reported "Šiuo laiku nepakanka vietų".
-- Transactional RPC keeps bookings and slot visibility in sync.
CREATE OR REPLACE FUNCTION public.admin_restore_one_off_slot_time(
  _source_slot_id uuid,
  _slot_date date,
  _target_time time without time zone
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_source public.time_slots%ROWTYPE;
  v_target public.time_slots%ROWTYPE;
  v_override_id uuid;
  v_source_count integer;
  v_target_count integer;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO v_source FROM public.time_slots
   WHERE id = _source_slot_id AND active IS TRUE AND one_off_date = _slot_date
   FOR UPDATE;
  IF NOT FOUND OR _target_time IS NULL OR v_source.slot_time = _target_time THEN
    RAISE EXCEPTION 'SOURCE_SLOT_NOT_FOUND';
  END IF;
  SELECT * INTO v_target FROM public.time_slots
   WHERE active IS TRUE AND one_off_date IS NULL
     AND day_of_week = extract(isodow from _slot_date)::integer
     AND slot_time = _target_time
     AND trainer_name IS NOT DISTINCT FROM v_source.trainer_name
   ORDER BY max_capacity ASC, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TARGET_RECURRING_SLOT_NOT_FOUND'; END IF;
  SELECT id INTO v_override_id FROM public.slot_overrides
   WHERE slot_date = _slot_date AND slot_time = _target_time AND max_capacity = 0
   FOR UPDATE;
  IF v_override_id IS NULL THEN
    RAISE EXCEPTION 'TARGET_NOT_A_HIDDEN_RECURRING_SLOT';
  END IF;

  -- Never quietly merge two independent lessons or orphan a waiting rider.
  IF EXISTS (
    SELECT 1 FROM public.time_slots s
    WHERE s.id <> v_source.id AND s.active IS TRUE AND s.slot_time = v_source.slot_time
      AND (s.one_off_date = _slot_date OR (s.one_off_date IS NULL AND s.day_of_week = extract(isodow from _slot_date)::integer))
  ) OR EXISTS (
    SELECT 1 FROM public.waiting_list w WHERE w.slot_date = _slot_date
      AND w.slot_time IN (v_source.slot_time, _target_time)
  ) THEN
    RAISE EXCEPTION 'SLOT_HAS_OTHER_DEPENDENCIES';
  END IF;

  SELECT count(*) INTO v_source_count FROM public.bookings
   WHERE slot_date = _slot_date AND slot_time = v_source.slot_time
     AND status IN ('active','pending_cancel')
     AND is_paused_for_subscription IS NOT TRUE;
  SELECT count(*) INTO v_target_count FROM public.bookings
   WHERE slot_date = _slot_date AND slot_time = _target_time
     AND status IN ('active','pending_cancel')
     AND is_paused_for_subscription IS NOT TRUE;
  IF v_target_count + v_source_count > v_target.max_capacity THEN
    RAISE EXCEPTION 'SLOT_FULL';
  END IF;

  -- Allow standard booking capacity trigger to validate the moved booking.
  DELETE FROM public.slot_overrides WHERE id = v_override_id;
  UPDATE public.bookings SET slot_time = _target_time
   WHERE slot_date = _slot_date AND slot_time = v_source.slot_time
     AND status IN ('active', 'pending_cancel');
  UPDATE public.horse_assignments SET slot_time = _target_time
   WHERE slot_date = _slot_date AND slot_time = v_source.slot_time;
  -- Deactivate moved one-off (preserve record for audit, avoid duplicate slot).
  UPDATE public.time_slots SET active = false WHERE id = v_source.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_restore_one_off_slot_time(uuid,date,time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_restore_one_off_slot_time(uuid,date,time) TO authenticated;
