REVOKE ALL ON FUNCTION public.materialize_permanent_bookings(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.materialize_permanent_bookings(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) TO service_role;

REVOKE ALL ON FUNCTION public.remove_permanent_slot(uuid, integer, time without time zone, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_permanent_slot(uuid, integer, time without time zone, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_permanent_slot(uuid, integer, time without time zone, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_permanent_slot(uuid, integer, time without time zone, date) TO service_role;