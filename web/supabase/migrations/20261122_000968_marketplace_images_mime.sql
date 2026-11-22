SET LOCAL lock_timeout = '5s';

-- 000968: marketplace listing photos. NOT APPLIED by the PR that adds this
-- file. Do not run it against production from that change.
--
-- The public marketplace-images bucket accepted any MIME type, so an SVG
-- (script included) could be stored and served from a listing photo URL.
-- Client uploads now check magic bytes; this is the Storage API backstop,
-- modeled on the logos bucket update in
-- 20261018_000927_security_weekly_1018.sql.
--
-- Recorded live value before this statement: allowed_mime_types NULL,
-- file_size_limit NULL (same shape as logos before 000927). 5 MB matches the
-- catalog part-photo cap (PART_PHOTO_MAX_BYTES) and the listing form.
-- Does not create the bucket, change public, or touch any other bucket.
-- The row is created in the dashboard (see 20260620). If it is missing, this
-- migration stops instead of reporting success.
--
-- Rollback: 20261122_000968_marketplace_images_mime_rollback.sql

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION '000968: storage.buckets is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'marketplace-images') THEN
    RAISE EXCEPTION '000968: storage.buckets row marketplace-images does not exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'marketplace-images'
      AND b.allowed_mime_types IS NOT NULL
      AND b.allowed_mime_types <> ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION '000968: marketplace-images allowed_mime_types differs from the recorded value (NULL); refusing to replace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'marketplace-images'
      AND b.file_size_limit IS NOT NULL
      AND b.file_size_limit <> 5242880
  ) THEN
    RAISE EXCEPTION '000968: marketplace-images file_size_limit differs from the recorded value (NULL); refusing to replace';
  END IF;
END $$;

-- No SVG (or any non-raster type) through the Storage API.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
    file_size_limit = 5242880   -- 5 MB
WHERE id = 'marketplace-images';

SELECT '000968 ok' AS status;
