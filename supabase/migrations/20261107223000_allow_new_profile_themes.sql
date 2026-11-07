ALTER TABLE public.profiles DROP CONSTRAINT profiles_theme_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_theme_check CHECK (
  theme IS NULL OR theme = ANY (ARRAY[
    'automatic','spring','summer','autumn','winter','ocean','lavender',
    'midnight','forest','goldleaf','sage','monochrome','warm-neutral'
  ])
);
