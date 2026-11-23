SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000970_marketplace_images_policy_index.sql.
-- Restores the 20260620 write policies, including (storage.foldername(name))[0].
-- Does not change the public SELECT policy.

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload listing images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[0] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
CREATE POLICY "Users can update own listing images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[0] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
CREATE POLICY "Users can delete own listing images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'marketplace-images' 
  AND (storage.foldername(name))[0] = auth.uid()::text
);

SELECT '000970 rollback ok' AS status;
