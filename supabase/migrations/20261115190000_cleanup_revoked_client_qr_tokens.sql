-- Remove only QR tokens that were explicitly revoked at least 14 days ago.
-- Active QR identity tokens are intentionally persistent.
create or replace function public.cleanup_revoked_client_qr_tokens()
returns integer language plpgsql security definer set search_path to ''
as $function$
declare removed integer;
begin
  delete from public.client_qr_tokens
  where revoked_at is not null and revoked_at < now()-interval '14 days';
  get diagnostics removed=row_count;
  return removed;
end;
$function$;
revoke all on function public.cleanup_revoked_client_qr_tokens() from public,anon,authenticated;
select cron.schedule('equus-revoked-qr-token-cleanup','20 3 * * *','select public.cleanup_revoked_client_qr_tokens();');
