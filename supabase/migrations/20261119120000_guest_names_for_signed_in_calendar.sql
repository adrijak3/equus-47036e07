-- Signed-in riders may see guest first name and surname initial on the
-- calendar, just like registered riders. Staff continue to see full names.
-- Never expose guest contacts, guest profile IDs or guest booking ownership.
CREATE OR REPLACE FUNCTION public.get_schedule_booking_names(
  _start_date date, _end_date date
)
RETURNS TABLE(booking_id uuid, display_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
 v_actor uuid := auth.uid();
 v_staff boolean := coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false)
                 OR coalesce(public.has_role(auth.uid(), 'trainer'::public.app_role), false);
BEGIN
 IF v_actor IS NULL THEN RETURN; END IF;
 IF _start_date IS NULL OR _end_date IS NULL OR _end_date < _start_date OR (_end_date - _start_date) > 31 THEN
   RAISE EXCEPTION 'Netinkamas grafiko laikotarpis.';
 END IF;

 RETURN QUERY
 SELECT b.id,
   CASE
     WHEN b.is_guest THEN
       CASE
         WHEN v_staff THEN coalesce(nullif(trim(b.guest_name), ''), 'Svečias')
         WHEN nullif(trim(b.guest_name), '') IS NULL THEN 'Svečias'
         ELSE
           split_part(trim(b.guest_name), ' ', 1)
           || CASE
                WHEN strpos(trim(b.guest_name), ' ') > 0 THEN
                  ' ' || left(split_part(trim(b.guest_name), ' ', 2), 1) || '.'
                ELSE ''
              END
       END
     WHEN p.full_name IS NULL OR trim(p.full_name) = '' THEN 'Raitelis'
     WHEN v_staff OR public.owns_profile(v_actor, b.user_id) THEN trim(p.full_name)
     ELSE
       split_part(trim(p.full_name), ' ', 1)
       || CASE WHEN strpos(trim(p.full_name), ' ') > 0 THEN
         ' ' || left(split_part(trim(p.full_name), ' ', 2), 1) || '.'
       ELSE '' END
   END::text
 FROM public.bookings b
 LEFT JOIN public.profiles p ON p.id = b.user_id
 WHERE b.slot_date BETWEEN _start_date AND _end_date
   AND b.status IN ('active'::public.booking_status, 'completed'::public.booking_status);
END;
$function$;
