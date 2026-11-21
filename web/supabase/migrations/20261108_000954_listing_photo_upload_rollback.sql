SET LOCAL lock_timeout = '5s';

-- Rollback 000954. Restores the reviewed 2026-11-08 write policies (folder
-- index [0]) and the jpeg/jpg mime list. Does not make the bucket public and
-- does not drop "Public can view listing images".
-- Forward: 20261108_000954_listing_photo_upload.sql

DO $$
DECLARE
  v_public boolean;
  v_mime text[];
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION '000954 rollback: storage schema is missing';
  END IF;

  SELECT b.public, b.allowed_mime_types
    INTO v_public, v_mime
  FROM storage.buckets b
  WHERE b.id = 'marketplace-images';

  IF NOT FOUND THEN
    RAISE EXCEPTION '000954 rollback: bucket marketplace-images does not exist';
  END IF;

  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION '000954 rollback: marketplace-images.public is not false';
  END IF;

  IF v_mime IS NOT NULL
     AND v_mime <> ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']::text[]
     AND v_mime <> ARRAY['image/jpeg', 'image/jpg']::text[] THEN
    RAISE EXCEPTION '000954 rollback: allowed_mime_types is not the 000954 list';
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload listing images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[0] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
CREATE POLICY "Users can update own listing images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[0] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
CREATE POLICY "Users can delete own listing images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[0] = (auth.uid())::text
);

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg']::text[]
WHERE id = 'marketplace-images'
  AND public = false;
