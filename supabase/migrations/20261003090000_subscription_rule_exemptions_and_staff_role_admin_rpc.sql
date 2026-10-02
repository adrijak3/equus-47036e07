-- Equus: admin-managed subscription-rule exemptions and secure half-admin role management.
--
-- Exemption means:
--   * subscription requirement is bypassed;
--   * weekly registration opening rules still apply;
--   * ordinary booking/capacity/duplicate rules still apply.
--
-- The table is intentionally user-based so Admin can add/remove exceptions
-- without hardcoding names in application code.

CREATE TABLE IF NOT EXISTS public.subscription_rule_exemptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.subscription_rule_exemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage subscription rule exemptions"
  ON public.subscription_rule_exemptions;

CREATE POLICY "Admins manage subscription rule exemptions"
ON public.subscription_rule_exemptions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.admin_add_subscription_rule_exemption(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF _user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  INSERT INTO public.subscription_rule_exemptions(user_id, created_by)
  VALUES (_user_id, auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'user_id', _user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_subscription_rule_exemption(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  DELETE FROM public.subscription_rule_exemptions
  WHERE user_id = _user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', _user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_add_half_admin(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF _user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (_user_id, 'half_admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'user_id', _user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_half_admin(
  _user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = _user_id
    AND role = 'half_admin'::public.app_role;

  RETURN jsonb_build_object('ok', true, 'user_id', _user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_add_subscription_rule_exemption(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_remove_subscription_rule_exemption(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_add_half_admin(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.admin_remove_half_admin(uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_add_subscription_rule_exemption(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_remove_subscription_rule_exemption(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_add_half_admin(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_remove_half_admin(uuid)
  TO authenticated;
