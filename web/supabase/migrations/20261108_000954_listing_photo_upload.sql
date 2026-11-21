SET LOCAL lock_timeout = '5s';

-- 000954: listing photo uploads. NOT APPLIED — review and apply with the web deploy.
--
-- Live read 2026-11-08 (no rows changed by that read):
--   storage.buckets marketplace-images: public = false,
--     allowed_mime_types = {image/jpeg, image/jpg}, file_size_limit NULL.
--   Write policies "Authenticated users can upload listing images" (INSERT),
--     "Users can update own listing images" (UPDATE), and
--     "Users can delete own listing images" (DELETE) all compare
--     (storage.foldername(name))[0] to auth.uid()::text.
--   Postgres arrays are 1-based. storage.foldername(uid || '/listings/a.jpg')[0]
--   is NULL and [1] is the uid folder, so every authenticated upload fails
--   WITH CHECK ("new row violates row-level security policy") even when the
--   object path is {auth.uid()}/listings/{file}.
--   Storage logs the same day: JPEG listing uploads returned that RLS error
--   on marketplace-images, then AccessDenied on the equipment-photos fallback
--   (path is a user id, not an org id), then NoSuchBucket on a bucket named
--   equipment. WebP uploads returned InvalidMimeType ("mime type image/webp
--   is not supported") before the same fallback. The reported listing's
--   images and photos arrays were empty after the save.
--
-- This migration:
--   * rewrites only those three write policies to index [1], still
--     authenticated, still the caller's own first folder, with UPDATE
--     USING and WITH CHECK both set (storage upsert needs insert+select+update);
--   * widens allowed_mime_types from jpeg/jpg to jpeg, jpg, png, webp, gif.
-- It does not set the bucket public, does not add a write policy for anon or
-- for every authenticated user, and does not change "Public can view listing
-- images" (pre-existing SELECT). HEIC/HEIF stay rejected.
--
-- Rollback: 20261108_000954_listing_photo_upload_rollback.sql

DO $$
DECLARE
  v_public boolean;
  v_mime text[];
  v_ins text;
  v_upd text;
  v_del text;
  v_sel text;
  v_extra_insert int;
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION '000954: storage schema is missing';
  END IF;

  SELECT b.public, b.allowed_mime_types
    INTO v_public, v_mime
  FROM storage.buckets b
  WHERE b.id = 'marketplace-images';

  IF NOT FOUND THEN
    RAISE EXCEPTION '000954: bucket marketplace-images does not exist';
  END IF;

  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION '000954: marketplace-images.public is not false; refusing to change storage config';
  END IF;

  IF v_mime IS NULL
     OR (
       v_mime <> ARRAY['image/jpeg', 'image/jpg']::text[]
       AND v_mime <> ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']::text[]
     ) THEN
    RAISE EXCEPTION '000954: marketplace-images allowed_mime_types is not the reviewed jpeg/jpg list';
  END IF;

  SELECT pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_ins
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname = 'Authenticated users can upload listing images';

  SELECT pg_get_expr(p.polqual, p.polrelid)
    INTO v_upd
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname = 'Users can update own listing images';

  SELECT pg_get_expr(p.polqual, p.polrelid)
    INTO v_del
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname = 'Users can delete own listing images';

  SELECT pg_get_expr(p.polqual, p.polrelid)
    INTO v_sel
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname = 'Public can view listing images';

  IF v_sel IS NULL OR position('marketplace-images' IN v_sel) = 0 THEN
    RAISE EXCEPTION '000954: public read policy is missing; this migration does not create a new read policy';
  END IF;

  IF v_ins IS NULL OR v_upd IS NULL OR v_del IS NULL THEN
    RAISE EXCEPTION '000954: listing image write policy is missing';
  END IF;

  IF position('foldername' IN v_ins) = 0
     OR position('auth.uid()' IN v_ins) = 0
     OR position('marketplace-images' IN v_ins) = 0
     OR position('foldername' IN v_upd) = 0
     OR position('auth.uid()' IN v_upd) = 0
     OR position('foldername' IN v_del) = 0
     OR position('auth.uid()' IN v_del) = 0 THEN
    RAISE EXCEPTION '000954: listing image write policy is not the owner-folder predicate';
  END IF;

  IF (position('[0]' IN v_ins) = 0 AND position('[1]' IN v_ins) = 0)
     OR (position('[0]' IN v_upd) = 0 AND position('[1]' IN v_upd) = 0)
     OR (position('[0]' IN v_del) = 0 AND position('[1]' IN v_del) = 0) THEN
    RAISE EXCEPTION '000954: listing image write policy index is not the reviewed [0] or the fixed [1]';
  END IF;

  SELECT count(*)
    INTO v_extra_insert
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polcmd = 'a'
    AND p.polname <> 'Authenticated users can upload listing images'
    AND (
      coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ILIKE '%marketplace-images%'
      OR coalesce(pg_get_expr(p.polqual, p.polrelid), '') ILIKE '%marketplace-images%'
    );

  IF v_extra_insert <> 0 THEN
    RAISE EXCEPTION '000954: unexpected extra INSERT policy on marketplace-images';
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload listing images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
CREATE POLICY "Users can update own listing images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
CREATE POLICY "Users can delete own listing images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']::text[]
WHERE id = 'marketplace-images'
  AND public = false
  AND (
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg']::text[]
    OR allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']::text[]
  );

DO $$
DECLARE
  v_auth oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
  v_bad int;
  v_sel text;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION '000954: authenticated role is missing';
  END IF;

  SELECT count(*)
    INTO v_bad
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname IN (
      'Authenticated users can upload listing images',
      'Users can update own listing images',
      'Users can delete own listing images'
    )
    AND (
      cardinality(p.polroles) IS DISTINCT FROM 1
      OR NOT (v_auth = ANY (p.polroles))
      OR position('[1]' IN coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) = 0
      OR position('[0]' IN coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0
      OR position('foldername' IN coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) = 0
    );

  IF v_bad <> 0 THEN
    RAISE EXCEPTION '000954: write policies were not restricted to the authenticated owner folder';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage'
      AND c.relname = 'objects'
      AND p.polname = 'Users can update own listing images'
      AND pg_get_expr(p.polwithcheck, p.polrelid) IS NOT NULL
      AND position('[1]' IN pg_get_expr(p.polwithcheck, p.polrelid)) > 0
  ) THEN
    RAISE EXCEPTION '000954: update policy is missing WITH CHECK for the owner folder';
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid)
    INTO v_sel
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage'
    AND c.relname = 'objects'
    AND p.polname = 'Public can view listing images';

  IF v_sel IS NULL OR position('marketplace-images' IN v_sel) = 0 THEN
    RAISE EXCEPTION '000954: public read policy was changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'marketplace-images'
      AND public = false
      AND allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']::text[]
  ) THEN
    RAISE EXCEPTION '000954: mime list or private flag did not apply';
  END IF;
END $$;
