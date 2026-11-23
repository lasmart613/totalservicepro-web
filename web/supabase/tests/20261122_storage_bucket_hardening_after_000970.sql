-- Path (b): 000968 then 000970, then 000974, then rollback.
-- Rollback must put marketplace-images back to the exact 000968+000970 state
-- (png/jpeg/webp, 5 MB, folder index 1) and the other buckets back to live.
-- Empty Postgres only. QA orgs 2655 and 2639. Ends in ROLLBACK.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(name, ''), '^.*/', '')
$$;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('company-assets', 'company-assets', true, 5242880, ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]),
  ('user-avatars', 'user-avatars', true, NULL, NULL),
  ('equipment-photos', 'equipment-photos', false, NULL, NULL),
  ('part-images', 'part-images', true, NULL, NULL),
  ('marketplace-images', 'marketplace-images', false, NULL, ARRAY['image/jpeg','image/jpg']::text[]);

CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE TABLE public.organization_memberships (user_id uuid NOT NULL, organization_id bigint NOT NULL, role text);
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 2655, 'owner');

CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = auth.uid() AND m.organization_id = org_id
  );
$$;
CREATE OR REPLACE FUNCTION public.storage_org_id_from_name(object_name text)
RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE parts text[]; candidate text;
BEGIN
  IF object_name IS NULL OR btrim(object_name) = '' THEN RETURN NULL; END IF;
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN RETURN NULL; END IF;
  IF parts[1] = 'equipment' AND array_length(parts, 1) >= 2 THEN candidate := parts[2]; ELSE candidate := parts[1]; END IF;
  IF candidate ~ '^[0-9]+$' THEN RETURN candidate::bigint; END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, seller_id uuid, created_by uuid,
  organization_id bigint, images jsonb, photos jsonb, details jsonb
);
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company assets are publicly viewable" ON storage.objects FOR SELECT TO public USING ((bucket_id = 'company-assets'::text));
CREATE POLICY "Avatars are publicly viewable" ON storage.objects FOR SELECT TO public USING ((bucket_id = 'user-avatars'::text));
CREATE POLICY "Users can upload own avatar" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'user-avatars'::text));
CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'user-avatars'::text));
CREATE POLICY "Users can upload their own company assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'company-assets'::text) AND ((storage.foldername(name))[1] = 'logos'::text));
CREATE POLICY "Users can manage their own logos" ON storage.objects FOR ALL TO authenticated USING ((bucket_id = 'company-assets'::text) AND ((auth.uid())::text = split_part(storage.filename(name), '.'::text, 1)));
CREATE POLICY equipment_photos_member_read ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));
CREATE POLICY equipment_photos_member_delete ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));
CREATE POLICY equipment_photos_member_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));
CREATE POLICY equipment_photos_member_update ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name))) WITH CHECK ((bucket_id = 'equipment-photos'::text) AND auth_member_of_org(storage_org_id_from_name(name)));
CREATE POLICY "Authenticated users can upload listing images" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
CREATE POLICY "Users can delete own listing images" ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
CREATE POLICY "Users can update own listing images" ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'marketplace-images'::text) AND ((storage.foldername(name))[0] = (auth.uid())::text));
CREATE POLICY "Public can view listing images" ON storage.objects FOR SELECT TO public USING ((bucket_id = 'marketplace-images'::text));

INSERT INTO storage.objects (bucket_id, name) VALUES
  ('company-assets', 'logos/2655.png'),
  ('user-avatars', 'avatars/aaaaaaaa-0000-0000-0000-000000000001.jpg'),
  ('equipment-photos', 'equipment/2655/laser.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg');
INSERT INTO public.marketplace_listings (status, seller_id, images) VALUES
  ('active', 'aaaaaaaa-0000-0000-0000-000000000001',
   '["https://db.example/storage/v1/object/public/marketplace-images/aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg"]'::jsonb);

-- 000968 then 000970, exact statements from b5d2f146.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[],
    file_size_limit = 5242880
WHERE id = 'marketplace-images';

DROP POLICY IF EXISTS "Authenticated users can upload listing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload listing images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
DROP POLICY IF EXISTS "Users can update own listing images" ON storage.objects;
CREATE POLICY "Users can update own listing images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
DROP POLICY IF EXISTS "Users can delete own listing images" ON storage.objects;
CREATE POLICY "Users can delete own listing images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

\ir ../migrations/20261122_000974_storage_bucket_hardening.sql

CREATE TEMP TABLE proof (n serial, label text, ok boolean);
CREATE FUNCTION pg_temp.fp(pname text) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
  FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = pname
$$;
CREATE FUNCTION pg_temp.see(role_name text, uid text, bucket text, object_name text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    SELECT count(*) INTO n FROM storage.objects o WHERE o.bucket_id = bucket AND o.name = object_name;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'undo:' || n;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'undo:%' THEN n := substr(SQLERRM, 6)::int; ELSE RAISE; END IF;
  END;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.try_as(uid text, stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE k int := 0;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE stmt;
    GET DIAGNOSTICS k = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'undo:' || k;
  EXCEPTION
    WHEN insufficient_privilege THEN k := -1;
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'undo:%' THEN k := substr(SQLERRM, 6)::int; ELSE RAISE; END IF;
  END;
  EXECUTE 'RESET ROLE';
  RETURN k > 0;
END $$;

INSERT INTO proof (label, ok) VALUES
  ('B AFTER marker is b', (SELECT prior = 'b' FROM public.storage_000974_marketplace_prior WHERE id = 1)),
  ('B AFTER marketplace is the shared target', (SELECT public IS FALSE AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'marketplace-images')),
  ('B AFTER 000970 policy names are gone', pg_temp.fp('Authenticated users can upload listing images') IS NULL),
  ('B AFTER own listing insert works', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/listings/from-b.jpg')$q$)),
  ('B AFTER company public select unchanged', pg_temp.fp('Company assets are publicly viewable') = 'ff4a9e1a393148b403a8c54941fe7f3e'),
  ('B AFTER avatar public select unchanged', pg_temp.fp('Avatars are publicly viewable') = 'fba55b5b38dc6edfba51d1aa8404069f'),
  ('B AFTER equipment member read unchanged', pg_temp.fp('equipment_photos_member_read') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('B AFTER anon still reads legacy logos/', pg_temp.see('anon', '', 'company-assets', 'logos/2655.png') = 1),
  ('B AFTER anon still reads legacy avatars/', pg_temp.see('anon', '', 'user-avatars', 'avatars/aaaaaaaa-0000-0000-0000-000000000001.jpg') = 1),
  ('B AFTER member still reads legacy equipment/', pg_temp.see('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment-photos', 'equipment/2655/laser.jpg') = 1);

\ir ../migrations/20261122_000974_storage_bucket_hardening_rollback.sql

INSERT INTO proof (label, ok) VALUES
  ('B ROLLBACK marker dropped', to_regclass('public.storage_000974_marketplace_prior') IS NULL),
  ('B ROLLBACK 000974 functions gone', to_regprocedure('public.storage_caller_owns_prefix(text)') IS NULL AND to_regprocedure('public.marketplace_image_public_read(text)') IS NULL),
  ('B ROLLBACK owner policies gone', NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname LIKE '%_owner_%')),
  ('B ROLLBACK listing insert fp is 000970', pg_temp.fp('Authenticated users can upload listing images') = '94e71a7c51d1b31e75768e25ffc6187a'),
  ('B ROLLBACK listing update fp is 000970', pg_temp.fp('Users can update own listing images') = '3e13542cc539fb1c263ea2fd1b1b079e'),
  ('B ROLLBACK listing delete fp is 000970', pg_temp.fp('Users can delete own listing images') = '3e13542cc539fb1c263ea2fd1b1b079e'),
  ('B ROLLBACK public select is the blanket policy', pg_temp.fp('Public can view listing images') = '3d4d064c1a4c4114021b519a1855db36'),
  ('B ROLLBACK insert text is index 1', (SELECT pg_get_expr(polwithcheck, polrelid) = '((bucket_id = ''marketplace-images''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))' FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'Authenticated users can upload listing images')),
  ('B ROLLBACK marketplace mime is png/jpeg/webp at 5 MB', (SELECT public IS FALSE AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'marketplace-images')),
  ('B ROLLBACK company mime is the live list', (SELECT allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[] AND file_size_limit = 5242880 AND public IS TRUE FROM storage.buckets WHERE id = 'company-assets')),
  ('B ROLLBACK avatars mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS TRUE FROM storage.buckets WHERE id = 'user-avatars')),
  ('B ROLLBACK equipment mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS FALSE FROM storage.buckets WHERE id = 'equipment-photos')),
  ('B ROLLBACK part-images mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS TRUE FROM storage.buckets WHERE id = 'part-images')),
  ('B ROLLBACK anon still reads legacy logos/', pg_temp.see('anon', '', 'company-assets', 'logos/2655.png') = 1),
  ('B ROLLBACK member still reads legacy equipment/', pg_temp.see('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment-photos', 'equipment/2655/laser.jpg') = 1);

SELECT n, label, ok FROM proof ORDER BY n;
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(label, '; ' ORDER BY n) INTO bad FROM proof WHERE ok IS NOT TRUE;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'path b proof failed: %', bad;
  END IF;
END $$;
ROLLBACK;
