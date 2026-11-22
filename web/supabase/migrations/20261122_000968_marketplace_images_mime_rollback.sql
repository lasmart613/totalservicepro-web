SET LOCAL lock_timeout = '5s';

-- Rollback for 20261122_000968_marketplace_images_mime.sql.
-- Restores marketplace-images allowed_mime_types and file_size_limit to the
-- recorded unrestricted values (NULL). Does not drop the bucket or change
-- any other bucket.

UPDATE storage.buckets
SET allowed_mime_types = NULL,
    file_size_limit = NULL
WHERE id = 'marketplace-images';

SELECT '000968 rollback ok' AS status;
