-- Only signed-in people see display names on the timetable.
-- Names are reduced to first name + surname initial for regular riders.
-- Guests still see occupancy but no names; never return phone/email/user_id.
CREATE OR REPLACE FUNCTION public.get_schedule_booking_names(_start_date date,_end_date date)
RETURNS TABLE(booking_id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
 v_actor uuid:=auth.uid();
 v_staff boolean:=coalesce(public.has_role(auth.uid(),'admin'::public.app_role),false)
               OR coalesce(public.has_role(auth.uid(),'trainer'::public.app_role),false);
BEGIN
 IF v_actor IS NULL THEN RETURN; END IF;
 IF _start_date IS NULL OR _end_date IS NULL OR _end_date<_start_date OR (_end_date-_start_date)>31 THEN
   RAISE EXCEPTION 'Netinkamas grafiko laikotarpis.';
 END IF;
 RETURN QUERY SELECT b.id,
 CASE
  WHEN b.is_guest THEN CASE WHEN v_staff THEN coalesce(nullif(trim(b.guest_name),''),'Svečias') ELSE 'Svečias' END
  WHEN p.full_name IS NULL OR trim(p.full_name)='' THEN 'Raitelis'
  WHEN v_staff OR public.owns_profile(v_actor,b.user_id) THEN trim(p.full_name)
  ELSE split_part(trim(p.full_name),' ',1)
    || CASE WHEN strpos(trim(p.full_name),' ')>0
       THEN ' '||left(split_part(trim(p.full_name),' ',2),1)||'.' ELSE '' END
 END::text
 FROM public.bookings b
 LEFT JOIN public.profiles p ON p.id=b.user_id
 WHERE b.slot_date BETWEEN _start_date AND _end_date
   AND b.status IN ('active'::public.booking_status,'completed'::public.booking_status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_schedule_booking_names(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schedule_booking_names(date,date) TO authenticated;