-- Supabase Storage upsert requires SELECT as well as existing INSERT/UPDATE.
-- Limit new access strictly to the one RHR rider reminder object.
-- The gallery bucket remains publicly viewable via public object URL.
CREATE POLICY "Admins read RHR reminder for upsert"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'gallery'
  AND name = 'competition/rhr-varzybu-atmintine.png'
  AND (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
);
