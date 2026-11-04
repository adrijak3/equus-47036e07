-- Date-scoped delegated admin for holidays. Effective dates use Lithuania local time.
-- Delegates never receive a permanent user_roles(admin) entry.
CREATE TABLE IF NOT EXISTS public.admin_holiday_delegations (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  delegate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_holiday_delegation_dates CHECK (ends_on >= starts_on),
  CONSTRAINT admin_holiday_delegation_distinct CHECK (owner_id <> delegate_id)
);

ALTER TABLE public.admin_holiday_delegations ENABLE ROW LEVEL SECURITY;

-- Explicitly no direct anonymous or authenticated writes: only the
-- owner-checked SECURITY DEFINER RPC below can change delegations.
REVOKE ALL ON public.admin_holiday_delegations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_holiday_delegations TO authenticated;
DROP POLICY IF EXISTS "View own holiday admin delegation" ON public.admin_holiday_delegations;
CREATE POLICY "View own holiday admin delegation"
ON public.admin_holiday_delegations FOR SELECT TO authenticated
USING (owner_id=auth.uid() OR delegate_id=auth.uid());

-- Direct permanent admin check; deliberately ignores holiday delegates.
CREATE OR REPLACE FUNCTION public.is_permanent_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = _user_id AND r.role='admin'::public.app_role
  );
$$;
REVOKE ALL ON FUNCTION public.is_permanent_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_permanent_admin(uuid) TO authenticated;

-- RLS and existing RPCs rely on has_role, so the dates are checked
-- server-side on EVERY privileged operation. Expiry needs no cron.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id=_user_id AND r.role=_role
    )
    OR (
      _role='admin'::public.app_role
      AND EXISTS (
        SELECT 1 FROM public.admin_holiday_delegations d
        WHERE d.delegate_id=_user_id
          AND d.enabled=true
          AND d.starts_on <= (now() at time zone 'Europe/Vilnius')::date
          AND d.ends_on >= (now() at time zone 'Europe/Vilnius')::date
          AND public.is_permanent_admin(d.owner_id)
      )
    );
$$;

-- Delegates should not be able to turn their temporary permissions into
-- a permanent role via any of the existing permissive user_roles policies.
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins update roles" ON public.user_roles;
CREATE POLICY "Only permanent admins modify roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.is_permanent_admin(auth.uid()))
WITH CHECK (public.is_permanent_admin(auth.uid()));
-- Separate SELECT policy remains usable for the current user's own roles
-- and delegated admin read access.
DROP POLICY IF EXISTS "Users view own roles, admins all" ON public.user_roles;
CREATE POLICY "Users view own roles, admins all"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id=auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role));

-- Role table should never be truncated / DDL-manipulated by browser clients.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.user_roles FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_admin_holiday_delegation(
  _delegate_id uuid,
  _starts_on date,
  _ends_on date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF NOT public.is_permanent_admin(v_actor) THEN
    RAISE EXCEPTION 'PERMANENT_ADMIN_ONLY' USING ERRCODE='insufficient_privilege';
  END IF;
  IF _delegate_id IS NULL THEN
    DELETE FROM public.admin_holiday_delegations WHERE owner_id=v_actor;
    RETURN jsonb_build_object('ok',true,'disabled',true);
  END IF;
  IF _starts_on IS NULL OR _ends_on IS NULL OR _ends_on < _starts_on
     OR _ends_on < (now() at time zone 'Europe/Vilnius')::date
     OR _ends_on > (now() at time zone 'Europe/Vilnius')::date + 365
  THEN
    RAISE EXCEPTION 'INVALID_HOLIDAY_DATES' USING ERRCODE='check_violation';
  END IF;
  IF _delegate_id=v_actor THEN
    RAISE EXCEPTION 'CANNOT_DELEGATE_TO_SELF' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=_delegate_id) THEN
    RAISE EXCEPTION 'DELEGATE_PROFILE_NOT_FOUND' USING ERRCODE='check_violation';
  END IF;
  IF public.is_permanent_admin(_delegate_id) THEN
    RAISE EXCEPTION 'ALREADY_PERMANENT_ADMIN' USING ERRCODE='check_violation';
  END IF;

  INSERT INTO public.admin_holiday_delegations(
    owner_id,delegate_id,starts_on,ends_on,enabled,updated_at
  ) VALUES (v_actor,_delegate_id,_starts_on,_ends_on,true,now())
  ON CONFLICT(owner_id) DO UPDATE SET
    delegate_id=EXCLUDED.delegate_id,
    starts_on=EXCLUDED.starts_on,
    ends_on=EXCLUDED.ends_on,
    enabled=true,
    updated_at=now();

  RETURN jsonb_build_object('ok',true,'delegate_id',_delegate_id,
      'starts_on',_starts_on,'ends_on',_ends_on);
END;
$$;
REVOKE ALL ON FUNCTION public.set_admin_holiday_delegation(uuid,date,date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_holiday_delegation(uuid,date,date)
  TO authenticated;

-- This endpoint exposes ONLY public holiday date + delegate display name,
-- not telephone number, personal ID or list of admins.
CREATE OR REPLACE FUNCTION public.get_public_admin_holiday_contact()
RETURNS TABLE(delegate_name text, ends_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public'
AS $$
 SELECT COALESCE(NULLIF(split_part(trim(p.full_name),' ',1),''),'administratorių')::text,
        d.ends_on
 FROM public.admin_holiday_delegations d
 JOIN public.profiles p ON p.id=d.delegate_id
 WHERE d.enabled
   AND d.starts_on <= (now() AT TIME ZONE 'Europe/Vilnius')::date
   AND d.ends_on >= (now() AT TIME ZONE 'Europe/Vilnius')::date
   AND public.is_permanent_admin(d.owner_id)
 ORDER BY d.updated_at DESC
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_public_admin_holiday_contact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_admin_holiday_contact()
TO anon,authenticated;
