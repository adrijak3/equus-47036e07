
REVOKE EXECUTE ON FUNCTION public.apply_sickness_credit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_day_notes_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_horse_daily_limit() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_permanent_slot_insert() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_from_waiting_list() FROM anon, authenticated;
