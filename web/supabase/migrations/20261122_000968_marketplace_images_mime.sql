SET LOCAL lock_timeout = '5s';

-- 000968: marketplace listing photos. NOT APPLIED by the PR that adds this
-- file. Do not run it against production from that change.
--
-- marketplace-images is a private bucket (storage.buckets.public = false).
-- This statement does not change public, does not create the bucket, and
-- does not touch any other bucket.
--
-- Production value read for this fix: allowed_mime_types = {image/jpeg,image/jpg},
-- file_size_limit NULL. An older row may still have allowed_mime_types NULL.
-- The guard accepts those two priors or the target below, so a re-run is safe.
-- Any other MIME list or size limit is refused.
--
-- Target: png / jpeg / webp, 5 MB (same cap as catalog part photos and the
-- listing form). image/jpg is dropped because uploads send image/jpeg.
-- SVG is not in the list.
--
-- Rollback: 20261122_000968_marketplace_images_mime_rollback.sql
-- restores {image/jpeg,image/jpg} and file_size_limit NULL. It does not set
-- allowed_mime_types to NULL, which would widen the bucket.

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
      AND b.allowed_mime_types <> ARRAY['image/jpeg', 'image/jpg']::text[]
      AND b.allowed_mime_types <> ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION '000968: marketplace-images allowed_mime_types is not NULL, {image/jpeg,image/jpg}, or the png/jpeg/webp target; refusing to replace';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'marketplace-images'
      AND b.file_size_limit IS NOT NULL
      AND b.file_size_limit <> 5242880
  ) THEN
    RAISE EXCEPTION '000968: marketplace-images file_size_limit is not NULL or 5242880; refusing to replace';
  END IF;
END $$;

-- No SVG (or any non-raster type) through the Storage API.
-- public is left as it is (private in production).
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
    file_size_limit = 5242880   -- 5 MB
WHERE id = 'marketplace-images';

SELECT '000968 ok' AS status;
