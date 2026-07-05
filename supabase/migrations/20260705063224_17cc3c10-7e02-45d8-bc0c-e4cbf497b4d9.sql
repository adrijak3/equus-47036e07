CREATE OR REPLACE FUNCTION public.remove_permanent_slot(
  _user_id uuid,
  _day_of_week int,
  _slot_time time,
  _from_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  deleted_slots int := 0;
  cancelled_bookings int := 0;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF caller <> _user_id
     AND NOT public.has_role(caller, 'admin')
     AND NOT public.has_role(caller, 'trainer')
     AND NOT public.owns_profile(caller, _user_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  WITH d AS (
    DELETE FROM public.permanent_slots
     WHERE user_id = _user_id
       AND day_of_week = _day_of_week
       AND slot_time = _slot_time
    RETURNING 1
  )
  SELECT count(*) INTO deleted_slots FROM d;

  WITH u AS (
    UPDATE public.bookings
       SET status = 'cancelled'
     WHERE user_id = _user_id
       AND slot_time = _slot_time
       AND slot_date >= _from_date
       AND status = 'active'
    RETURNING 1
  )
  SELECT count(*) INTO cancelled_bookings FROM u;

  RETURN jsonb_build_object(
    'deleted_slots', deleted_slots,
    'cancelled_bookings', cancelled_bookings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_permanent_slot(uuid, int, time, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_permanent_slot(uuid, int, time, date) TO authenticated;