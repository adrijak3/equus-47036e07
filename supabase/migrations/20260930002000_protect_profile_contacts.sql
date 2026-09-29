-- Normal riders need to see who they will ride with, but not other riders'
-- private contact details. Staff keep full profile access.
DROP POLICY IF EXISTS "Authenticated read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users view own or staff profiles" ON public.profiles;

CREATE POLICY "Users view own or staff profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.owns_profile((select auth.uid()), id)
  OR (select public.has_role(auth.uid(), 'admin'::public.app_role))
  OR (select public.has_role(auth.uid(), 'trainer'::public.app_role))
);

-- Safe schedule directory: normal riders receive only a masked display name
-- and riding level. Staff receive the full name.
CREATE OR REPLACE FUNCTION public.get_schedule_rider_directory(_user_ids uuid[])
RETURNS TABLE (
  id uuid,
  display_name text,
  riding_level text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    CASE
      WHEN (select public.has_role((select auth.uid()), 'admin'::public.app_role))
        OR (select public.has_role((select auth.uid()), 'trainer'::public.app_role))
      THEN p.full_name
      ELSE
        split_part(trim(p.full_name), ' ', 1)
        || CASE
          WHEN position(' ' in trim(p.full_name)) > 0
          THEN ' ' || left(reverse(split_part(reverse(trim(p.full_name)), ' ', 1)), 2)
          ELSE ''
        END
    END AS display_name,
    p.riding_level::text
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(_user_ids, ARRAY[]::uuid[]));
$$;

REVOKE ALL ON FUNCTION public.get_schedule_rider_directory(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_schedule_rider_directory(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_schedule_rider_directory(uuid[]) TO authenticated;
