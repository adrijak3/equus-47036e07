-- Additive safe schedule APIs, already installed 2026-11-12.
-- Public users see slot occupancy but not other riders' names or IDs.

CREATE OR REPLACE FUNCTION public.get_schedule_bookings_safe(_start_date date, _end_date date)
 RETURNS TABLE(id uuid, user_id uuid, slot_date date, slot_time time without time zone, status text, is_guest boolean, guest_name text, is_individual boolean, guest_rider_id uuid, trainer_name text, created_at timestamp with time zone, is_paused_for_subscription boolean, is_grace_booking boolean, family_rider_id uuid, family_group_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_staff boolean := COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false)
                   OR COALESCE(public.has_role(auth.uid(), 'trainer'::public.app_role), false);
BEGIN
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date
     OR _end_date - _start_date > 31 THEN
    RAISE EXCEPTION 'Netinkamas grafiko laikotarpis.';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    CASE WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN b.user_id ELSE NULL::uuid END,
    b.slot_date,
    b.slot_time,
    b.status::text,
    b.is_guest,
    CASE WHEN v_staff THEN b.guest_name ELSE NULL::text END,
    b.is_individual,
    CASE WHEN v_staff THEN b.guest_rider_id ELSE NULL::uuid END,
    b.trainer_name,
    CASE WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN b.created_at ELSE NULL::timestamptz END,
    b.is_paused_for_subscription,
    CASE WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN b.is_grace_booking ELSE false END,
    CASE WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN b.family_rider_id ELSE NULL::uuid END,
    CASE WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN b.family_group_id ELSE NULL::uuid END
  FROM public.bookings b
  WHERE b.slot_date BETWEEN _start_date AND _end_date
    AND b.status IN ('active'::public.booking_status, 'completed'::public.booking_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_schedule_bookings_safe(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_bookings_safe(date,date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_schedule_horses_safe(_start_date date, _end_date date)
 RETURNS TABLE(id uuid, booking_id uuid, user_id uuid, guest_name text, slot_date date, slot_time time without time zone, horse_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_staff boolean := COALESCE(public.has_role(auth.uid(),'admin'::public.app_role),false)
                  OR COALESCE(public.has_role(auth.uid(),'trainer'::public.app_role),false);
BEGIN
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date OR _end_date - _start_date > 31 THEN
    RAISE EXCEPTION 'Netinkamas grafiko laikotarpis.';
  END IF;
  RETURN QUERY SELECT a.id,a.booking_id,
    CASE WHEN v_staff OR public.owns_profile(v_actor,a.user_id) THEN a.user_id ELSE NULL::uuid END,
    CASE WHEN v_staff THEN a.guest_name ELSE NULL::text END,
    a.slot_date,a.slot_time,a.horse_id
  FROM public.horse_assignments a
  WHERE a.slot_date BETWEEN _start_date AND _end_date;
END; $function$;
REVOKE ALL ON FUNCTION public.get_schedule_horses_safe(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_horses_safe(date,date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_schedule_permanents_safe()
 RETURNS TABLE(user_id uuid, day_of_week smallint, slot_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_staff boolean := COALESCE(public.has_role(auth.uid(),'admin'::public.app_role),false)
                  OR COALESCE(public.has_role(auth.uid(),'trainer'::public.app_role),false);
BEGIN
  RETURN QUERY SELECT
    CASE WHEN v_staff OR public.owns_profile(v_actor,p.user_id) THEN p.user_id ELSE NULL::uuid END,
    p.day_of_week,p.slot_time
  FROM public.permanent_slots p;
END; $function$;
REVOKE ALL ON FUNCTION public.get_schedule_permanents_safe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_permanents_safe() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_schedule_waiting_safe(_start_date date, _end_date date)
 RETURNS TABLE(id uuid, user_id uuid, slot_date date, slot_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_staff boolean := COALESCE(public.has_role(auth.uid(),'admin'::public.app_role),false)
                  OR COALESCE(public.has_role(auth.uid(),'trainer'::public.app_role),false);
BEGIN
  IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date OR _end_date - _start_date > 31 THEN
    RAISE EXCEPTION 'Netinkamas grafiko laikotarpis.';
  END IF;
  RETURN QUERY SELECT w.id,
    CASE WHEN v_staff OR public.owns_profile(v_actor,w.user_id) THEN w.user_id ELSE NULL::uuid END,
    w.slot_date,w.slot_time
  FROM public.waiting_list w
  WHERE w.slot_date BETWEEN _start_date AND _end_date;
END; $function$;
REVOKE ALL ON FUNCTION public.get_schedule_waiting_safe(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_waiting_safe(date,date) TO anon, authenticated;

ALTER FUNCTION public.equus_push_cron_tick() SET search_path = pg_catalog;
ALTER FUNCTION public.enforce_3_hour_cutoff() SET search_path = pg_catalog;
