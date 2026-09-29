-- Repair the auth -> profile/role signup trigger and backfill orphaned users.
--
-- Root cause:
-- The repository expects public.handle_new_user() + on_auth_user_created
-- to create a profiles row after every auth.users insert, but at least one
-- real account (created 2026-09-29) exists in auth.users without a profile.
-- Recreate the trigger idempotently and backfill any existing orphan users.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    experience_text,
    phone_is_parent
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'Equus klientas'
    ),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'experience_text',
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'phone_is_parent', '')::boolean,
      false
    )
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE
      WHEN NEW.email = 'adrija.kalikaite3@gmail.com' THEN 'admin'::public.app_role
      WHEN NEW.email = 'jojimomokykla@gmail.com' THEN 'trainer'::public.app_role
      ELSE 'user'::public.app_role
    END
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Make sure the trigger is actually installed in the live database.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill any auth users whose profile was never created.
INSERT INTO public.profiles (
  id,
  full_name,
  phone,
  experience_text,
  phone_is_parent
)
SELECT
  u.id,
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    split_part(COALESCE(u.email, ''), '@', 1),
    'Equus klientas'
  ),
  u.raw_user_meta_data->>'phone',
  u.raw_user_meta_data->>'experience_text',
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'phone_is_parent', '')::boolean,
    false
  )
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- Backfill the normal application role for any auth user that has none.
INSERT INTO public.user_roles (user_id, role)
SELECT
  u.id,
  CASE
    WHEN u.email = 'adrija.kalikaite3@gmail.com' THEN 'admin'::public.app_role
    WHEN u.email = 'jojimomokykla@gmail.com' THEN 'trainer'::public.app_role
    ELSE 'user'::public.app_role
  END
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = u.id
);
