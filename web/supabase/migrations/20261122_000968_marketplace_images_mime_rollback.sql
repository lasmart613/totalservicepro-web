SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000968_marketplace_images_mime.sql.
-- Restores the production MIME list {image/jpeg,image/jpg} and
-- file_size_limit NULL. Does not set allowed_mime_types to NULL: NULL would
-- allow SVG and every other type. Does not change public (the bucket stays
-- private) and does not touch any other bucket.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg']::text[],
    file_size_limit = NULL
WHERE id = 'marketplace-images';

SELECT '000968 rollback ok' AS status;
