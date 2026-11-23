SET LOCAL lock_timeout = '5s';

-- 000974 rollback. NOT APPLIED. public is not changed.
--
-- company-assets, user-avatars, equipment-photos, and part-images always
-- return to the 2026-11-23 live rows. equipment_photos_member_read is not
-- dropped or recreated. Legacy logos/, avatars/, and equipment/ objects
-- keep the same public or member read they had before 000974.
--
-- marketplace-images returns to the prior recorded in
-- public.storage_000974_marketplace_prior:
--   a = {image/jpeg,image/jpg}, NULL size, folder index 0
--   b = png/jpeg/webp, 5 MB, folder index 1 (exact 000970 pg_get_expr)
-- The table is dropped after a successful restore. If the marker is already
-- gone and the database is exactly (a) or exactly (b), this file leaves
-- marketplace-images as it is. It raises if 000974 is applied and the marker
-- is missing.

DO $$
DECLARE
  r record;
  live jsonb := jsonb_build_object(
    'Authenticated users can upload listing images', 'bf674bf17bee483a7d413de54f481767',
    'Users can delete own listing images', '28eeb053229caa1fb44b0cd85ee4e944',
    'Users can update own listing images', '28eeb053229caa1fb44b0cd85ee4e944',
    'Public can view listing images', '3d4d064c1a4c4114021b519a1855db36',
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
           coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') AS qual
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'storage.objects'::regclass
      AND pol.polname IN (SELECT jsonb_object_keys(live))
  LOOP
    IF r.fp = (live ->> r.name) THEN
      CONTINUE;
    END IF;
    -- 000970 write policies: same commands, folder index 1. pg_get_expr md5.
    IF r.name = 'Authenticated users can upload listing images' AND r.fp = '94e71a7c51d1b31e75768e25ffc6187a' THEN
      CONTINUE;
    END IF;
    IF r.name IN ('Users can delete own listing images', 'Users can update own listing images')
       AND r.fp = '3e13542cc539fb1c263ea2fd1b1b079e' THEN
      CONTINUE;
    END IF;
    IF r.name = 'Public can view listing images' AND r.qual LIKE '%marketplace_image_public_read(%' THEN
      CONTINUE;
    END IF;
    RAISE EXCEPTION '000974 rollback: storage.objects policy % is neither a known prior nor the 000974 replacement (%); refusing', r.name, r.fp;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'company-assets' AND b.public IS TRUE AND b.file_size_limit = 5242880
      AND (
        b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
        OR b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'user-avatars' AND b.public IS TRUE
      AND (
        (b.file_size_limit = 2097152 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'equipment-photos' AND b.public IS FALSE
      AND (
        (b.file_size_limit = 8388608 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'part-images' AND b.public IS TRUE
      AND (
        (b.file_size_limit = 5242880 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (b.file_size_limit IS NULL AND b.allowed_mime_types IS NULL)
      )
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets b
    WHERE b.id = 'marketplace-images' AND b.public IS FALSE
      AND (
        (b.file_size_limit = 5242880 AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (b.file_size_limit IS NULL AND b.allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[])
      )
  ) THEN
    RAISE EXCEPTION '000974 rollback: a bucket is neither the live row nor the 000974 target';
  END IF;
END $$;

DROP POLICY IF EXISTS company_assets_owner_insert ON storage.objects;
DROP POLICY IF EXISTS company_assets_owner_update ON storage.objects;
DROP POLICY IF EXISTS company_assets_owner_delete ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_insert ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_update ON storage.objects;
DROP POLICY IF EXISTS user_avatars_owner_delete ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_insert ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_owner_delete ON storage.objects;
-- Marketplace policies are restored below from the recorded prior, before
-- the 000974 functions are dropped.
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can manage their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own company assets" ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_insert ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_update ON storage.objects;
DROP POLICY IF EXISTS equipment_photos_member_delete ON storage.objects;

DO $$
DECLARE
  marker text;
  ins text;
  upd text;
  del text;
  pub text;
  q text;
  c text;
  detected text;
  chosen text;
  mime text[];
  lim bigint;
  n integer;
  a_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[0] = (auth.uid())::text))';
  b_expr text := '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))';
  blanket text := '(bucket_id = ''marketplace-images''::text)';
BEGIN
  IF to_regclass('public.storage_000974_marketplace_prior') IS NOT NULL THEN
    SELECT p.prior INTO marker FROM public.storage_000974_marketplace_prior p WHERE p.id = 1;
  END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass AND polname = 'Authenticated users can upload listing images';
  IF NOT FOUND THEN ins := NULL; ELSE ins := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass AND polname = 'Users can update own listing images';
  IF NOT FOUND THEN upd := NULL; ELSE upd := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), ''), coalesce(pg_get_expr(polwithcheck, polrelid), '')
    INTO q, c FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass AND polname = 'Users can delete own listing images';
  IF NOT FOUND THEN del := NULL; ELSE del := CASE WHEN c <> '' THEN c ELSE q END; END IF;

  SELECT coalesce(pg_get_expr(polqual, polrelid), '') INTO pub
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass AND polname = 'Public can view listing images';
  IF NOT FOUND THEN pub := NULL; END IF;

  SELECT b.allowed_mime_types, b.file_size_limit INTO mime, lim
  FROM storage.buckets b WHERE b.id = 'marketplace-images';

  IF ins = a_expr AND upd = a_expr AND del = a_expr AND pub = blanket
     AND lim IS NULL AND mime IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[] THEN
    detected := 'a';
  ELSIF ins = b_expr AND upd = b_expr AND del = b_expr AND pub = blanket
     AND lim = 5242880 AND mime IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[] THEN
    detected := 'b';
  ELSIF ins IS NULL AND upd IS NULL AND del IS NULL
     AND pub LIKE '%marketplace_image_public_read(%'
     AND lim = 5242880 AND mime IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[] THEN
    detected := '974';
  ELSE
    detected := NULL;
  END IF;

  IF marker IN ('a', 'b') AND (detected = '974' OR detected = marker) THEN
    chosen := marker;
  ELSIF marker IS NULL AND detected IN ('a', 'b') THEN
    chosen := detected;
  ELSE
    RAISE EXCEPTION '000974 rollback: cannot tell which marketplace-images prior to restore (marker %, detected %)', coalesce(marker, '<none>'), coalesce(detected, '<none>');
  END IF;

  IF detected = '974' OR detected IS DISTINCT FROM chosen THEN
    DROP POLICY IF EXISTS marketplace_images_owner_insert ON storage.objects;
    DROP POLICY IF EXISTS marketplace_images_owner_update ON storage.objects;
    DROP POLICY IF EXISTS marketplace_images_owner_delete ON storage.objects;
    DROP POLICY IF EXISTS "Public can view listing images" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
    DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;

    IF chosen = 'a' THEN
      CREATE POLICY "Authenticated users can upload listing images" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
      CREATE POLICY "Users can update own listing images" ON storage.objects
        FOR UPDATE TO authenticated
        USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
      CREATE POLICY "Users can delete own listing images" ON storage.objects
        FOR DELETE TO authenticated
        USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
    ELSE
      CREATE POLICY "Authenticated users can upload listing images" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
      CREATE POLICY "Users can update own listing images" ON storage.objects
        FOR UPDATE TO authenticated
        USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
      CREATE POLICY "Users can delete own listing images" ON storage.objects
        FOR DELETE TO authenticated
        USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
    END IF;
    CREATE POLICY "Public can view listing images" ON storage.objects
      FOR SELECT TO public
      USING ((bucket_id = 'marketplace-images'::text));
  END IF;

  IF chosen = 'a' THEN
    UPDATE storage.buckets
    SET allowed_mime_types = ARRAY['image/jpeg','image/jpg']::text[],
        file_size_limit = NULL
    WHERE id = 'marketplace-images' AND public IS FALSE
      AND (
        (file_size_limit = 5242880 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (file_size_limit IS NULL AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[])
      );
  ELSE
    UPDATE storage.buckets
    SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[],
        file_size_limit = 5242880
    WHERE id = 'marketplace-images' AND public IS FALSE
      AND (
        (file_size_limit = 5242880 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
        OR (file_size_limit IS NULL AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[])
      );
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '000974 rollback: marketplace-images was not restored to prior %', chosen;
  END IF;

  DROP TABLE IF EXISTS public.storage_000974_marketplace_prior;
END $$;

DROP FUNCTION IF EXISTS public.marketplace_image_public_read(text);
DROP FUNCTION IF EXISTS public.storage_caller_owns_prefix(text);

CREATE POLICY "Users can upload own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'user-avatars'::text));

CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING ((bucket_id = 'user-avatars'::text));

CREATE POLICY "Users can manage their own logos" ON storage.objects
  FOR ALL TO authenticated
  USING ((bucket_id = 'company-assets'::text) AND ((auth.uid())::text = split_part(storage.filename(name), '.'::text, 1)));

CREATE POLICY "Users can upload their own company assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'company-assets'::text) AND ((storage.foldername(name))[1] = 'logos'::text));

CREATE POLICY equipment_photos_member_delete ON storage.objects
  FOR DELETE TO authenticated
  USING ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));

CREATE POLICY equipment_photos_member_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));

CREATE POLICY equipment_photos_member_update ON storage.objects
  FOR UPDATE TO authenticated
  USING ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)))
  WITH CHECK ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[],
      file_size_limit = 5242880
  WHERE id = 'company-assets' AND public IS TRUE AND file_size_limit = 5242880
    AND (
      allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
      OR allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '000974 rollback: company-assets was not restored'; END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = NULL, file_size_limit = NULL
  WHERE id = 'user-avatars' AND public IS TRUE
    AND (
      (file_size_limit = 2097152 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      OR (file_size_limit IS NULL AND allowed_mime_types IS NULL)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '000974 rollback: user-avatars was not restored'; END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = NULL, file_size_limit = NULL
  WHERE id = 'equipment-photos' AND public IS FALSE
    AND (
      (file_size_limit = 8388608 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      OR (file_size_limit IS NULL AND allowed_mime_types IS NULL)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '000974 rollback: equipment-photos was not restored'; END IF;

  UPDATE storage.buckets
  SET allowed_mime_types = NULL, file_size_limit = NULL
  WHERE id = 'part-images' AND public IS TRUE
    AND (
      (file_size_limit = 5242880 AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[])
      OR (file_size_limit IS NULL AND allowed_mime_types IS NULL)
    );
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '000974 rollback: part-images was not restored'; END IF;
END $$;

SELECT '000974 rollback ok' AS status;
