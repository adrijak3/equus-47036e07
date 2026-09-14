ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS experience_text text,
  ADD COLUMN IF NOT EXISTS phone_is_parent boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, experience_text, phone_is_parent)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    NEW.raw_user_meta_data->>'experience_text',
    COALESCE((NEW.raw_user_meta_data->>'phone_is_parent')::boolean, false)
  );
  IF NEW.email = 'adrija.kalikaite3@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSIF NEW.email = 'jojimomokykla@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'trainer');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;