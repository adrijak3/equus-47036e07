-- STAGED ONLY. Do not apply until the TOTP gate has been deployed, tested,
-- and every SECURITY DEFINER RPC / Edge Function that acts as the user is audited.
-- Applies solely to users who have voluntarily verified a TOTP factor.
-- Other users remain on the existing aal1 authorization rules.
--
-- This is a defense-in-depth draft and NOT a complete authorization audit.
CREATE OR REPLACE FUNCTION private.equus_optional_mfa_session_ok()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT
    auth.uid() IS NULL
    OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    OR NOT EXISTS (
      SELECT 1
      FROM auth.mfa_factors factor
      WHERE factor.user_id = auth.uid()
        AND factor.status = 'verified'
    );
$fn$;
REVOKE ALL ON FUNCTION private.equus_optional_mfa_session_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.equus_optional_mfa_session_ok() TO authenticated;

DO $do$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles','bookings','subscriptions','user_roles','messages',
    'waiting_list','horse_assignments','permanent_slots',
    'push_subscriptions','family_riders','guest_riders',
    'subscription_purchase_requests'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT private.equus_optional_mfa_session_ok()))
       WITH CHECK ((SELECT private.equus_optional_mfa_session_ok()))',
      'Equus opt-in TOTP protection', table_name
    );
  END LOOP;
END
$do$;

-- After deploying: test AAL1 and AAL2 on every table, including ownership
-- and admin/half-admin actions. Auditing all SECURITY DEFINER RPCs is mandatory:
-- SECURITY DEFINER procedures may bypass table RLS unless they check AAL.
