
REVOKE EXECUTE ON FUNCTION public.materialize_permanent_bookings(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_bookings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_day_notes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_subscriptions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_conversations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_makeup_cancellations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.on_permanent_slot_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_sickness_credit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_from_waiting_list() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_horse_daily_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_day_notes_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.owns_profile(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_profile(uuid, uuid) TO authenticated;
