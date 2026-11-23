SET LOCAL lock_timeout = '5s';

-- 000974: storage bucket hardening. NOT APPLIED. Do not run this against
-- production from the PR that adds the file. Do not deploy it. 000973 is
-- reserved for a different change and is not used here.
--
-- Read-only capture 2026-11-23, project yljztfajyvjzqikxdddf. public is not
-- modified on any bucket. 000968's lesson: marketplace-images mime was
-- {image/jpeg,image/jpg}, not NULL. Every UPDATE below matches that recorded
-- prior or this migration's own target, and raises on anything else.
--
-- MIME target is the types the upload code sends after the magic-byte check:
-- image/png, image/jpeg, image/webp. No SVG and no PDF.
--   company-assets: 4 objects, all image/jpeg, all under logos/. No SVG, no
--     PDF, no application/pdf writer. Client caps are 5 MB (onboarding) and
--     3 MB (company profile). The bucket limit stays 5,242,880 (the higher
--     client cap). image/jpg and image/svg+xml are removed; clients send
--     image/jpeg from the detected bytes.
--   user-avatars: 1 object, image/jpeg, 91,433 bytes, under avatars/. Client
--     cap is 2 MB, so file_size_limit becomes 2,097,152.
--   equipment-photos: jpeg / png / webp. Largest object is a PNG of
--     7,684,472 bytes. file_size_limit becomes 8,388,608 (8 MiB).
--   part-images: jpeg / png / webp, client cap 5 MB. GIF is accepted by the
--     old picker and is not stored. file_size_limit becomes 5,242,880.
--   marketplace-images: private, empty, mime {image/jpeg,image/jpg}, no size
--     limit. Target is png/jpeg/webp and 5,242,880. image/jpg is dropped.
--
-- Writes: storage.foldername is 1-indexed. The first folder (index 1, never
-- 0) must be auth.uid() or an organization id the caller belongs to
-- (public.storage_caller_owns_prefix). Paths the app still uploads:
--   marketplace-images  {userId}/listings/... and {userId}/{file}
--   equipment-photos    {orgId}/{laserId}_{ts}.ext   (was equipment/{orgId}/...)
--   company-assets      {orgId}/logo.ext and {userId}/logo.ext
--                       (was logos/{id}.ext)
--   user-avatars        {userId}/avatar.ext          (was avatars/{userId}.ext)
--   part-images         parts/{userId}/... via the service role only. There is
--     no storage.objects policy today, so authenticated writes are already
--     denied. This migration does not add one: a policy on that prefix would
--     let the browser skip the quota route. Service role bypasses RLS, and
--     the bucket mime/size limits still apply to it.
-- Legacy objects under logos/, avatars/, and equipment/ stay readable
-- (public buckets, or equipment_photos_member_read, which is not replaced).
-- They are no longer member-writable.
--
-- marketplace-images SELECT: the bucket is private (public = false). Web
-- listing pages do not use this policy. /api/storage/signed-urls signs an
-- active listing's {uid}/listings/ object with the service role. The live
-- policy "Public can view listing images" is FOR SELECT TO public USING
-- (bucket_id = 'marketplace-images'), so the anon key can read every object.
-- That is replaced by marketplace_image_public_read: the same policy name,
-- now true only when a listing the app treats as public (not removed,
-- expired, inactive, closed, or draft — the same set as isPublicListingStatus)
-- references that exact path and the first folder is that listing's
-- seller_id or created_by. The public object URL still does not work, because
-- public stays false. Android marketplace.html builds that public URL; it
-- already cannot load this private bucket, and this migration does not change
-- that.
--
-- marketplace-images accepts exactly one of these priors, and raises otherwise.
-- The bucket row and the three write policies must agree; a mix is refused.
--   (a) live, read 2026-11-23: mime {image/jpeg,image/jpg}, file_size_limit
--       NULL, write policies use (storage.foldername(name))[0].
--   (b) after 000968 then 000970 (frozen #402, cursor/marketplace-image-mime-b81b
--       @ b5d2f146): mime {image/png,image/jpeg,image/webp}, file_size_limit
--       5242880, write policies use (storage.foldername(name))[1] =
--       auth.uid()::text. pg_get_expr of those policies is
--       ((bucket_id = 'marketplace-images'::text) AND
--        ((storage.foldername(name))[1] = (auth.uid())::text)).
--       000970 does not change "Public can view listing images".
--   (target) this migration already applied: png/jpeg/webp, 5 MB, owner
--       policies, and the private marker row still present.
-- The first apply records (a) or (b) in public.storage_000974_marketplace_prior
-- (one row, RLS on, no grants to anon or authenticated). Rollback reads that
-- row and restores that marketplace state. It does not guess.
--
-- Release when #402 is in the package: apply 000968, then 000970, merge #402,
-- then this file, then deploy the app. If #402 has not shipped, this file
-- still applies on live state (a); do not skip 000968 or 000970 when they
-- are already in the release. One transaction. Until the app is deployed,
-- company-assets uploads that still use logos/ fail closed.
--
-- Rollback: 20261122_000974_storage_bucket_hardening_rollback.sql
-- Proof: web/supabase/tests/20261122_storage_bucket_hardening.sql

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regclass('public.marketplace_listings') IS NULL
     OR to_regprocedure('public.auth_member_of_org(bigint)') IS NULL
     OR to_regprocedure('storage.foldername(text)') IS NULL THEN
    RAISE EXCEPTION '000974: expected storage.buckets, storage.objects, marketplace_listings, auth_member_of_org, storage.foldername';
  END IF;
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketplace_listings'
      AND column_name IN ('status', 'seller_id', 'created_by', 'images', 'photos', 'details')
  ) <> 6 THEN
    RAISE EXCEPTION '000974: marketplace_listings is missing status, seller, or image columns';
  END IF;
END $$;

-- Drift guards. Non-marketplace policies must match the live fingerprint.
-- Marketplace write policies must match live text (a) or the exact 000970
-- text (b). The public listing SELECT must be the live blanket text or
-- already this migration.
DO $$
DECLARE
  r record;
  expr text;
  a_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[0] = (auth.uid())::text))';
  b_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))';
  blanket text := '(bucket_id = ''marketplace-images''::text)';
  expected jsonb := jsonb_build_object(
    'Users can update own avatar', 'fba55b5b38dc6edfba51d1aa8404069f',
    'Users can upload own avatar', 'a22e713d7957d5a86dce3772bc9ab998',
    'Users can manage their own logos', '0e7f201834ef33417b800bb66227645c',
    'Users can upload their own company assets', 'adc90be904390869399581f20107a66c',
    'equipment_photos_member_delete', 'd37a11a8435025658fb1bced2c4d9ec5',
    'equipment_photos_member_insert', '041eeb85118f9f38141701c1c83020e3',
    'equipment_photos_member_update', '65ca0a5fbb8f542cb2d649fd989dc93f'
  );
BEGIN
  FOR r IN
    SELECT pol.polname::text AS name,
           md5(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
               coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')) AS fp,
           coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') AS qual,
           coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS chk
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'storage.objects'::regclass
      AND (
        pol.polname IN (SELECT jsonb_object_keys(expected))
        OR pol.polname IN (
          'Authenticated users can upload listing images',
          'Users can delete own listing images',
          'Users can update own listing images',
          'Public can view listing images'
        )
      )
  LOOP
    IF r.name IN (
      'Authenticated users can upload listing images',
      'Users can delete own listing images',
      'Users can update own listing images'
    ) THEN
      expr := CASE WHEN r.chk <> '' THEN r.chk ELSE r.qual END;
      IF expr = a_expr OR expr = b_expr THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION '000974: marketplace policy % is not live [0] text or 000970 [1] text (%); refusing', r.name, expr;
    END IF;
    IF r.name = 'Public can view listing images' THEN
      IF r.qual = blanket OR r.qual LIKE '%marketplace_image_public_read(%' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION '000974: Public can view listing images is not the live text or the 000974 predicate (%); refusing', r.qual;
    END IF;
    IF r.fp = (expected ->> r.name) THEN
      CONTINUE;
    END IF;
    RAISE EXCEPTION '000974: storage.objects policy % differs from the recorded live form (%); refusing to replace', r.name, r.fp;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('storage_caller_owns_prefix', 'marketplace_image_public_read')
      AND coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') NOT LIKE '000974:%'
  ) THEN
    RAISE EXCEPTION '000974: storage_caller_owns_prefix / marketplace_image_public_read exists and is not from 000974';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'company-assets' AND b.public IS TRUE
      AND b.file_size_limit = 5242880
      AND (
        b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]
        OR b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
      )
  ) THEN
    RAISE EXCEPTION '000974: company-assets public/mime/size differs from the recorded live value or the 000974 target';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'user-avatars' AND b.public IS TRUE
      AND (
        (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
        OR (b.file_size_limit = 2097152 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      )
  ) THEN
    RAISE EXCEPTION '000974: user-avatars public/mime/size differs from the recorded live value or the 000974 target';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'equipment-photos' AND b.public IS FALSE
      AND (
        (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
        OR (b.file_size_limit = 8388608 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      )
  ) THEN
    RAISE EXCEPTION '000974: equipment-photos public/mime/size differs from the recorded live value or the 000974 target';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'part-images' AND b.public IS TRUE
      AND (
        (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
        OR (b.file_size_limit = 5242880 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      )
  ) THEN
    RAISE EXCEPTION '000974: part-images public/mime/size differs from the recorded live value or the 000974 target';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'marketplace-images' AND b.public IS FALSE
      AND (
        (b.file_size_limit IS NULL AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[])
        OR (b.file_size_limit = 5242880 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      )
  ) THEN
    RAISE EXCEPTION '000974: marketplace-images public/mime/size is not live (a), post-000968 (b), or the 000974 target';
  END IF;
END $$;

-- Record which marketplace prior we found. Re-run keeps the original row.
-- A mix (for example [1] policies with the live MIME list) raises.
DO $$
DECLARE
  ins text;
  upd text;
  del text;
  pub text;
  q text;
  c text;
  marker text;
  detected text;
  mime text[];
  lim bigint;
  a_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[0] = (auth.uid())::text))';
  b_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))';
  blanket text := '(bucket_id = ''marketplace-images''::text)';
BEGIN
  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
    AND polname = 'Authenticated users can upload listing images';
  IF NOT FOUND THEN ins := NULL; ELSE ins := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
    AND polname = 'Users can update own listing images';
  IF NOT FOUND THEN upd := NULL; ELSE upd := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
    AND polname = 'Users can delete own listing images';
  IF NOT FOUND THEN del := NULL; ELSE del := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), '') INTO pub
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
    AND polname = 'Public can view listing images';
  IF NOT FOUND THEN pub := NULL; END IF;

  SELECT b.allowed_mime_types, b.file_size_limit INTO mime, lim
  FROM storage.buckets b
  WHERE b.id = 'marketplace-images';

  IF ins = a_expr AND upd = a_expr AND del = a_expr AND pub = blanket
     AND lim IS NULL
     AND mime IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[] THEN
    detected := 'a';
  ELSIF ins = b_expr AND upd = b_expr AND del = b_expr AND pub = blanket
     AND lim = 5242880
     AND mime IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[] THEN
    detected := 'b';
  ELSIF ins IS NULL AND upd IS NULL AND del IS NULL
     AND pub LIKE '%marketplace_image_public_read(%'
     AND lim = 5242880
     AND mime IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[] THEN
    detected := '974';
  ELSE
    RAISE EXCEPTION '000974: marketplace-images policies and bucket row are not a consistent live (a), post-000968+000970 (b), or 000974 state';
  END IF;

  CREATE TABLE IF NOT EXISTS public.storage_000974_marketplace_prior (
    id integer PRIMARY KEY CHECK (id = 1),
    prior text NOT NULL CHECK (prior IN ('a', 'b'))
  );
  ALTER TABLE public.storage_000974_marketplace_prior ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.storage_000974_marketplace_prior FROM PUBLIC, anon, authenticated;
  COMMENT ON TABLE public.storage_000974_marketplace_prior IS
    '000974 private marker. prior a = live marketplace-images ({image/jpeg,image/jpg}, NULL size, folder index 0). prior b = after 000968+000970 (png/jpeg/webp, 5 MB, folder index 1). Rollback reads this row and drops the table.';

  SELECT p.prior INTO marker FROM public.storage_000974_marketplace_prior p WHERE p.id = 1;
  IF detected IN ('a', 'b') THEN
    IF marker IS NULL THEN
      INSERT INTO public.storage_000974_marketplace_prior (id, prior) VALUES (1, detected);
    ELSIF marker <> detected THEN
      RAISE EXCEPTION '000974: stored marketplace prior % does not match the policies now present (%)', marker, detected;
    END IF;
  ELSIF marker IS NULL THEN
    RAISE EXCEPTION '000974: marketplace-images is already the 000974 target but the prior marker is missing; refusing to guess a rollback';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.storage_caller_owns_prefix(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  uid uuid := auth.uid();
  parts text[];
  head text;
  org_id bigint;
BEGIN
  IF uid IS NULL OR object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN false;
  END IF;
  -- First folder is storage.foldername index 1. Index 0 is always NULL.
  IF position('..' in object_name) > 0
     OR left(object_name, 1) = '/'
     OR position(chr(92) in object_name) > 0 THEN
    RETURN false;
  END IF;
  parts := storage.foldername(object_name);
  IF parts IS NULL OR cardinality(parts) < 1 THEN
    RETURN false;
  END IF;
  head := parts[1];
  IF head IS NULL OR btrim(head) = '' OR head = '.' OR head = '..' THEN
    RETURN false;
  END IF;
  IF lower(head) = lower(uid::text) THEN
    RETURN true;
  END IF;
  IF head ~ '^[1-9][0-9]{0,17}$' THEN
    org_id := head::bigint;
    RETURN COALESCE(public.auth_member_of_org(org_id), false);
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.storage_caller_owns_prefix(text) IS
  '000974: storage write check. The first folder (storage.foldername index 1) must be auth.uid() or an organization id the caller belongs to.';

REVOKE ALL ON FUNCTION public.storage_caller_owns_prefix(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_caller_owns_prefix(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.marketplace_image_public_read(object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  head text;
  blob text;
  listing record;
BEGIN
  IF object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN false;
  END IF;
  IF position('..' in object_name) > 0 OR left(object_name, 1) = '/' THEN
    RETURN false;
  END IF;
  IF storage.foldername(object_name) IS NULL OR cardinality(storage.foldername(object_name)) < 1 THEN
    RETURN false;
  END IF;
  head := (storage.foldername(object_name))[1];
  IF head !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  FOR listing IN
    SELECT ml.status, ml.seller_id, ml.created_by, ml.images, ml.photos, ml.details
    FROM public.marketplace_listings ml
    WHERE lower(btrim(coalesce(ml.status, ''))) NOT IN ('removed', 'expired', 'inactive', 'closed', 'draft')
      AND (
        lower(coalesce(ml.seller_id::text, '')) = lower(head)
        OR lower(coalesce(ml.created_by::text, '')) = lower(head)
      )
  LOOP
    blob := concat_ws(
      E'\n',
      coalesce(listing.images::text, ''),
      coalesce(listing.photos::text, ''),
      coalesce(listing.details::text, '')
    );
    -- The path must end at a URL or JSON boundary, so "a.jpg" does not match "a.jpg2".
    IF strpos(blob, object_name || '"') > 0
       OR strpos(blob, object_name || '?') > 0
       OR strpos(blob, object_name || '#') > 0
       OR right(blob, length(object_name)) = object_name THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.marketplace_image_public_read(text) IS
  '000974: anon read of a private marketplace-images object only when a public listing (not removed, expired, inactive, closed, or draft) references that path and the first folder is the listing seller or creator. Listing pages themselves use signed URLs.';

REVOKE ALL ON FUNCTION public.marketplace_image_public_read(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_image_public_read(text) TO anon, authenticated;

DROP POLICY IF EXISTS "Users can manage their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own company assets" ON storage.objects;
DROP POLICY IF EXISTS company_assets_owner_insert ON storage.objects;
DROP POLICY IF EXISTS company_assets_owner_update ON storage.objects;
DROP POLICY IF EXISTS company_assets_owner_delete ON storage.objects;

CREATE POLICY company_assets_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets' AND public.storage_caller_owns_prefix(name));

CREATE POLICY company_assets_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets' AND public.storage_caller_owns_prefix(name))
  WITH CHECK (bucket_id = 'company-assets' AND public.storage_caller_owns_prefix(name));

CREATE POLICY company_assets_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets' AND public.storage_caller_owns_prefix(name));

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_delete ON storage.objects;

CREATE POLICY user_avatars_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-avatars' AND public.storage_caller_owns_prefix(name));

CREATE POLICY user_avatars_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'user-avatars' AND public.storage_caller_owns_prefix(name))
  WITH CHECK (bucket_id = 'user-avatars' AND public.storage_caller_owns_prefix(name));

CREATE POLICY user_avatars_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-avatars' AND public.storage_caller_owns_prefix(name));

-- equipment_photos_member_read stays, so legacy equipment/{orgId}/ objects
-- remain readable by members. Writes move to the first-folder check.
DROP POLICY IF EXISTS equipment_photos_member_insert ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_delete ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_insert ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_delete ON storage.objects;

CREATE POLICY equipment_photos_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipment-photos' AND public.storage_caller_owns_prefix(name));

CREATE POLICY equipment_photos_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'equipment-photos' AND public.storage_caller_owns_prefix(name))
  WITH CHECK (bucket_id = 'equipment-photos' AND public.storage_caller_owns_prefix(name));

CREATE POLICY equipment_photos_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'equipment-photos' AND public.storage_caller_owns_prefix(name));

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view listing images" ON storage.objects;
DROP POLICY IF EXISTS marketplace_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS marketplace_images_owner_update ON storage.objects;
DROP POLICY IF EXISTS marketplace_images_owner_delete ON storage.objects;

CREATE POLICY marketplace_images_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketplace-images' AND public.storage_caller_owns_prefix(name));

CREATE POLICY marketplace_images_owner_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'marketplace-images' AND public.storage_caller_owns_prefix(name))
  WITH CHECK (bucket_id = 'marketplace-images' AND public.storage_caller_owns_prefix(name));

CREATE POLICY marketplace_images_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'marketplace-images' AND public.storage_caller_owns_prefix(name));

CREATE POLICY "Public can view listing images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'marketplace-images' AND public.marketplace_image_public_read(name));

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
      file_size_limit = 5242880
  WHERE id = 'company-assets'
    AND public IS TRUE
    AND file_size_limit = 5242880
    AND (
      allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]
      OR allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974: company-assets update did not match the recorded live row';
  END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
      file_size_limit = 2097152
  WHERE id = 'user-avatars'
    AND public IS TRUE
    AND (
      (file_size_limit IS NULL AND allowed_mime_types IS NULL)
      OR (file_size_limit = 2097152 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974: user-avatars update did not match the recorded live row';
  END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
      file_size_limit = 8388608
  WHERE id = 'equipment-photos'
    AND public IS FALSE
    AND (
      (file_size_limit IS NULL AND allowed_mime_types IS NULL)
      OR (file_size_limit = 8388608 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974: equipment-photos update did not match the recorded live row';
  END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
      file_size_limit = 5242880
  WHERE id = 'part-images'
    AND public IS TRUE
    AND (
      (file_size_limit IS NULL AND allowed_mime_types IS NULL)
      OR (file_size_limit = 5242880 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974: part-images update did not match the recorded live row';
  END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
      file_size_limit = 5242880
  WHERE id = 'marketplace-images'
    AND public IS FALSE
    AND (
      (file_size_limit IS NULL AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[])
      OR (file_size_limit = 5242880 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974: marketplace-images update did not match the recorded live row';
  END IF;
END $$;

SELECT '000974 ok' AS status;
