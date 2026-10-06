-- Equus Gallery: folders/albums and admin-managed photos.
--
-- Authenticated users can view the gallery. Only administrators can create,
-- edit, upload, and delete gallery content. Storage is public so gallery
-- photos can be rendered directly in the app and shared by URL if needed.

CREATE TABLE IF NOT EXISTS public.gallery_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gallery_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.gallery_folders(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  public_url text NOT NULL,
  original_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_folders_updated_at
  ON public.gallery_folders(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gallery_photos_folder_created_at
  ON public.gallery_photos(folder_id, created_at);

ALTER TABLE public.gallery_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view gallery folders" ON public.gallery_folders;
CREATE POLICY "Authenticated users can view gallery folders"
ON public.gallery_folders
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage gallery folders" ON public.gallery_folders;
CREATE POLICY "Admins can manage gallery folders"
ON public.gallery_folders
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Authenticated users can view gallery photos" ON public.gallery_photos;
CREATE POLICY "Authenticated users can view gallery photos"
ON public.gallery_photos
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can manage gallery photos" ON public.gallery_photos;
CREATE POLICY "Admins can manage gallery photos"
ON public.gallery_photos
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'gallery',
  'gallery',
  true,
  15728640,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 15728640,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif'];

DROP POLICY IF EXISTS "Admins upload gallery photos" ON storage.objects;
CREATE POLICY "Admins upload gallery photos"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'gallery'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admins update gallery photos" ON storage.objects;
CREATE POLICY "Admins update gallery photos"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'gallery'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'gallery'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admins delete gallery photos" ON storage.objects;
CREATE POLICY "Admins delete gallery photos"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'gallery'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);
