-- Local proof for 20261122_000974_storage_bucket_hardening.sql and its rollback.
-- Empty Postgres only (never production). Refuses to run when public.organizations
-- already exists. One transaction, ends in ROLLBACK.
--
--   createdb storage974_proof
--   psql "postgresql:///storage974_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261122_storage_bucket_hardening.sql
--
-- Orgs are QA ids 2655 and 2639. Live orgs are not used.
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
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
  id text PRIMARY KEY,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('company-assets', 'company-assets', true, 5242880, ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[]),
  ('user-avatars', 'user-avatars', true, NULL, NULL),
  ('equipment-photos', 'equipment-photos', false, NULL, NULL),
  ('part-images', 'part-images', true, NULL, NULL),
  ('marketplace-images', 'marketplace-images', false, NULL, ARRAY['image/jpeg','image/jpg']::text[]),
  ('other', 'other', false, NULL, NULL);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

CREATE TABLE public.organization_memberships (
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL,
  role text
);
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 2655, 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 2639, 'owner');

CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid() AND m.organization_id = org_id
    );
$$;

CREATE OR REPLACE FUNCTION public.storage_org_id_from_name(object_name text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  parts text[];
  candidate text;
BEGIN
  IF object_name IS NULL OR btrim(object_name) = '' THEN
    RETURN NULL;
  END IF;
  parts := storage.foldername(object_name);
  IF parts IS NULL OR array_length(parts, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  IF parts[1] = 'equipment' AND array_length(parts, 1) >= 2 THEN
    candidate := parts[2];
  ELSE
    candidate := parts[1];
  END IF;
  IF candidate ~ '^[0-9]+$' THEN
    RETURN candidate::bigint;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE TABLE public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text,
  seller_id uuid,
  created_by uuid,
  organization_id bigint,
  images jsonb,
  photos jsonb,
  details jsonb
);
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Live policies, 2026-11-23. Expressions are the pg_get_expr text.
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
  ('user-avatars', 'aaaaaaaa-0000-0000-0000-000000000001/avatar.jpg'),
  ('user-avatars', 'avatars/aaaaaaaa-0000-0000-0000-000000000001.jpg'),
  ('company-assets', '2655/logo.png'),
  ('company-assets', 'logos/2655.png'),
  ('equipment-photos', '2655/laser.jpg'),
  ('equipment-photos', 'equipment/2655/laser.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/draft.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/secret.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/sold.jpg'),
  ('marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/file.jpg'),
  ('part-images', 'parts/aaaaaaaa-0000-0000-0000-000000000001/photo.jpg');

INSERT INTO public.marketplace_listings (status, seller_id, images) VALUES
  ('active', 'aaaaaaaa-0000-0000-0000-000000000001', '["https://db.example/storage/v1/object/public/marketplace-images/aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg"]'::jsonb),
  ('draft', 'aaaaaaaa-0000-0000-0000-000000000001', '["https://db.example/storage/v1/object/public/marketplace-images/aaaaaaaa-0000-0000-0000-000000000001/listings/draft.jpg"]'::jsonb),
  ('sold', 'aaaaaaaa-0000-0000-0000-000000000001', '["https://db.example/storage/v1/object/public/marketplace-images/aaaaaaaa-0000-0000-0000-000000000001/listings/sold.jpg"]'::jsonb),
  ('active', 'bbbbbbbb-0000-0000-0000-000000000001', '["https://db.example/storage/v1/object/public/marketplace-images/aaaaaaaa-0000-0000-0000-000000000001/listings/secret.jpg"]'::jsonb);

CREATE TEMP TABLE proof (n serial, label text, ok boolean);
GRANT ALL ON proof TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE proof_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.fp(rel regclass, pname text) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
  FROM pg_policy WHERE polrelid = rel AND polname = pname
$$;

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
GRANT EXECUTE ON FUNCTION pg_temp.try_as(text, text) TO authenticated;

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

INSERT INTO proof (label, ok) VALUES
  ('BASE folder index 0 is null', (storage.foldername('aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg'))[0] IS NULL),
  ('BASE folder index 1 is the owner', (storage.foldername('aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg'))[1] = 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('BASE upload listing fp', pg_temp.fp('storage.objects', 'Authenticated users can upload listing images') = 'bf674bf17bee483a7d413de54f481767'),
  ('BASE delete listing fp', pg_temp.fp('storage.objects', 'Users can delete own listing images') = '28eeb053229caa1fb44b0cd85ee4e944'),
  ('BASE update listing fp', pg_temp.fp('storage.objects', 'Users can update own listing images') = '28eeb053229caa1fb44b0cd85ee4e944'),
  ('BASE public listing fp', pg_temp.fp('storage.objects', 'Public can view listing images') = '3d4d064c1a4c4114021b519a1855db36'),
  ('BASE avatar update fp', pg_temp.fp('storage.objects', 'Users can update own avatar') = 'fba55b5b38dc6edfba51d1aa8404069f'),
  ('BASE avatar insert fp', pg_temp.fp('storage.objects', 'Users can upload own avatar') = 'a22e713d7957d5a86dce3772bc9ab998'),
  ('BASE manage logos fp', pg_temp.fp('storage.objects', 'Users can manage their own logos') = '0e7f201834ef33417b800bb66227645c'),
  ('BASE company insert fp', pg_temp.fp('storage.objects', 'Users can upload their own company assets') = 'adc90be904390869399581f20107a66c'),
  ('BASE equipment delete fp', pg_temp.fp('storage.objects', 'equipment_photos_member_delete') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('BASE equipment insert fp', pg_temp.fp('storage.objects', 'equipment_photos_member_insert') = '041eeb85118f9f38141701c1c83020e3'),
  ('BASE equipment update fp', pg_temp.fp('storage.objects', 'equipment_photos_member_update') = '65ca0a5fbb8f542cb2d649fd989dc93f'),
  ('BASE equipment read fp', pg_temp.fp('storage.objects', 'equipment_photos_member_read') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('BASE marketplace mime is jpeg/jpg', (SELECT allowed_mime_types = ARRAY['image/jpeg','image/jpg']::text[] AND file_size_limit IS NULL AND public IS FALSE FROM storage.buckets WHERE id = 'marketplace-images')),
  ('BASE company mime includes svg', (SELECT allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[] AND file_size_limit = 5242880 FROM storage.buckets WHERE id = 'company-assets'));

INSERT INTO proof (label, ok) VALUES
  ('BEFORE any user inserts any avatar path', pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-avatars','aaaaaaaa-0000-0000-0000-000000000001/stolen.jpg')$q$)),
  ('BEFORE any user updates any avatar', pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET name = name WHERE bucket_id = 'user-avatars' AND name = 'aaaaaaaa-0000-0000-0000-000000000001/avatar.jpg'$q$)),
  ('BEFORE any user inserts logos/', pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','logos/evil.png')$q$)),
  ('BEFORE marketplace own-folder insert fails on index 0', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/listings/new.jpg')$q$)),
  ('BEFORE member inserts legacy equipment/ path', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('equipment-photos','equipment/2655/new.jpg')$q$)),
  ('BEFORE anon reads every marketplace object', pg_temp.see('anon', '', 'marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/secret.jpg') = 1);

\ir ../migrations/20261122_000974_storage_bucket_hardening.sql
\ir ../migrations/20261122_000974_storage_bucket_hardening.sql

INSERT INTO proof (label, ok) VALUES
  ('AFTER old avatar write policies gone', pg_temp.fp('storage.objects', 'Users can upload own avatar') IS NULL AND pg_temp.fp('storage.objects', 'Users can update own avatar') IS NULL),
  ('AFTER old company write policies gone', pg_temp.fp('storage.objects', 'Users can upload their own company assets') IS NULL AND pg_temp.fp('storage.objects', 'Users can manage their own logos') IS NULL),
  ('AFTER old marketplace write policies gone', pg_temp.fp('storage.objects', 'Authenticated users can upload listing images') IS NULL),
  ('AFTER equipment read policy unchanged', pg_temp.fp('storage.objects', 'equipment_photos_member_read') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('AFTER no policy expression uses index 0', NOT EXISTS (
     SELECT 1 FROM pg_policy
     WHERE polrelid = 'storage.objects'::regclass
       AND (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')) LIKE '%[0]%'
  )),
  ('AFTER owns function uses index 1', (SELECT prosrc LIKE '%parts[1]%' AND prosrc NOT LIKE '%[0]%' FROM pg_proc WHERE oid = 'public.storage_caller_owns_prefix(text)'::regprocedure)),
  ('AFTER public read function uses index 1', (SELECT prosrc LIKE '%[1]%' AND prosrc NOT LIKE '%[0]%' FROM pg_proc WHERE oid = 'public.marketplace_image_public_read(text)'::regprocedure)),
  ('AFTER owns is secdef and hidden from anon', (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = 'public.storage_caller_owns_prefix(text)'::regprocedure) AND NOT has_function_privilege('anon', 'public.storage_caller_owns_prefix(text)', 'EXECUTE')),
  ('AFTER public read granted to anon', has_function_privilege('anon', 'public.marketplace_image_public_read(text)', 'EXECUTE')),
  ('AFTER company mime is png/jpeg/webp at 5 MB', (SELECT public IS TRUE AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'company-assets')),
  ('AFTER avatars are png/jpeg/webp at 2 MB', (SELECT public IS TRUE AND file_size_limit = 2097152 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'user-avatars')),
  ('AFTER equipment is png/jpeg/webp at 8 MiB and still private', (SELECT public IS FALSE AND file_size_limit = 8388608 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'equipment-photos')),
  ('AFTER part-images is png/jpeg/webp at 5 MB and still public', (SELECT public IS TRUE AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'part-images')),
  ('AFTER marketplace is png/jpeg/webp at 5 MB and still private', (SELECT public IS FALSE AND file_size_limit = 5242880 AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']::text[] FROM storage.buckets WHERE id = 'marketplace-images')),
  ('AFTER other bucket untouched', (SELECT public IS FALSE AND file_size_limit IS NULL AND allowed_mime_types IS NULL FROM storage.buckets WHERE id = 'other'));

INSERT INTO proof (label, ok) VALUES
  ('AFTER owner inserts own avatar folder', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-avatars','aaaaaaaa-0000-0000-0000-000000000001/avatar-2.jpg')$q$)),
  ('AFTER avatar legacy avatars/ path refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-avatars','avatars/aaaaaaaa-0000-0000-0000-000000000001.jpg')$q$)),
  ('AFTER other user cannot update this avatar', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET name = name WHERE bucket_id = 'user-avatars' AND name = 'aaaaaaaa-0000-0000-0000-000000000001/avatar.jpg'$q$)),
  ('AFTER owner deletes own avatar', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$DELETE FROM storage.objects WHERE bucket_id = 'user-avatars' AND name = 'aaaaaaaa-0000-0000-0000-000000000001/avatar.jpg'$q$)),
  ('AFTER member inserts org company asset', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','2655/logo-2.png')$q$)),
  ('AFTER onboarding uid folder insert', pg_temp.try_as('cccccccc-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','cccccccc-0000-0000-0000-000000000001/logo.png')$q$)),
  ('AFTER logos/ company path refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','logos/2655.png')$q$)),
  ('AFTER other shop cannot write 2655/', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','2655/evil.png')$q$)),
  ('AFTER cannot move company asset to another org', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET name = '2639/logo.png' WHERE bucket_id = 'company-assets' AND name = '2655/logo.png'$q$)),
  ('AFTER member inserts {orgId}/ equipment photo', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('equipment-photos','2655/laser-2.jpg')$q$)),
  ('AFTER legacy equipment/{orgId}/ write refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('equipment-photos','equipment/2655/new2.jpg')$q$)),
  ('AFTER member still reads legacy equipment/ object', pg_temp.see('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment-photos', 'equipment/2655/laser.jpg') = 1),
  ('AFTER other shop cannot read 2655 equipment', pg_temp.see('authenticated', 'bbbbbbbb-0000-0000-0000-000000000001', 'equipment-photos', '2655/laser.jpg') = 0),
  ('AFTER listing path {uid}/listings/ inserts', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/listings/new.jpg')$q$)),
  ('AFTER android path {uid}/{file} inserts', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/only.jpg')$q$)),
  ('AFTER other user cannot write this listing folder', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/listings/stolen.jpg')$q$)),
  ('AFTER part-images client insert still denied', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('part-images','aaaaaaaa-0000-0000-0000-000000000001/photo.jpg')$q$)),
  ('AFTER bucket root refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('user-avatars','avatar.jpg')$q$)),
  ('AFTER dotdot refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('company-assets','2655/../2639/x.png')$q$)),
  ('AFTER anon reads an active listing image', pg_temp.see('anon', '', 'marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/pub.jpg') = 1),
  ('AFTER anon reads a sold listing image', pg_temp.see('anon', '', 'marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/sold.jpg') = 1),
  ('AFTER anon cannot read a draft listing image', pg_temp.see('anon', '', 'marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/draft.jpg') = 0),
  ('AFTER anon cannot read an unreferenced or other-seller path', pg_temp.see('anon', '', 'marketplace-images', 'aaaaaaaa-0000-0000-0000-000000000001/listings/secret.jpg') = 0),
  ('AFTER company public select unchanged', pg_temp.fp('storage.objects', 'Company assets are publicly viewable') = 'ff4a9e1a393148b403a8c54941fe7f3e'),
  ('AFTER avatar public select unchanged', pg_temp.fp('storage.objects', 'Avatars are publicly viewable') = 'fba55b5b38dc6edfba51d1aa8404069f'),
  ('AFTER anon still reads legacy logos/ object', pg_temp.see('anon', '', 'company-assets', 'logos/2655.png') = 1),
  ('AFTER anon still reads legacy avatars/ object', pg_temp.see('anon', '', 'user-avatars', 'avatars/aaaaaaaa-0000-0000-0000-000000000001.jpg') = 1),
  ('AFTER prior marker records live state a', (SELECT prior = 'a' FROM public.storage_000974_marketplace_prior WHERE id = 1)),
  ('AFTER anon cannot read the prior marker', NOT has_table_privilege('anon', 'public.storage_000974_marketplace_prior', 'SELECT')),
  ('AFTER other bucket still has no write', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('other','2655/x.png')$q$));

\ir ../migrations/20261122_000974_storage_bucket_hardening_rollback.sql

INSERT INTO proof (label, ok) VALUES
  ('ROLLBACK listing upload fp', pg_temp.fp('storage.objects', 'Authenticated users can upload listing images') = 'bf674bf17bee483a7d413de54f481767'),
  ('ROLLBACK listing delete fp', pg_temp.fp('storage.objects', 'Users can delete own listing images') = '28eeb053229caa1fb44b0cd85ee4e944'),
  ('ROLLBACK listing update fp', pg_temp.fp('storage.objects', 'Users can update own listing images') = '28eeb053229caa1fb44b0cd85ee4e944'),
  ('ROLLBACK public listing fp', pg_temp.fp('storage.objects', 'Public can view listing images') = '3d4d064c1a4c4114021b519a1855db36'),
  ('ROLLBACK avatar update fp', pg_temp.fp('storage.objects', 'Users can update own avatar') = 'fba55b5b38dc6edfba51d1aa8404069f'),
  ('ROLLBACK avatar insert fp', pg_temp.fp('storage.objects', 'Users can upload own avatar') = 'a22e713d7957d5a86dce3772bc9ab998'),
  ('ROLLBACK manage logos fp', pg_temp.fp('storage.objects', 'Users can manage their own logos') = '0e7f201834ef33417b800bb66227645c'),
  ('ROLLBACK company insert fp', pg_temp.fp('storage.objects', 'Users can upload their own company assets') = 'adc90be904390869399581f20107a66c'),
  ('ROLLBACK equipment delete fp', pg_temp.fp('storage.objects', 'equipment_photos_member_delete') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('ROLLBACK equipment insert fp', pg_temp.fp('storage.objects', 'equipment_photos_member_insert') = '041eeb85118f9f38141701c1c83020e3'),
  ('ROLLBACK equipment update fp', pg_temp.fp('storage.objects', 'equipment_photos_member_update') = '65ca0a5fbb8f542cb2d649fd989dc93f'),
  ('ROLLBACK equipment read still the live fp', pg_temp.fp('storage.objects', 'equipment_photos_member_read') = 'd37a11a8435025658fb1bced2c4d9ec5'),
  ('ROLLBACK 000974 policies gone', NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE '%_owner_%' AND polrelid = 'storage.objects'::regclass)),
  ('ROLLBACK functions gone', to_regprocedure('public.storage_caller_owns_prefix(text)') IS NULL AND to_regprocedure('public.marketplace_image_public_read(text)') IS NULL),
  ('ROLLBACK company mime and size', (SELECT allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/svg+xml','image/webp']::text[] AND file_size_limit = 5242880 AND public IS TRUE FROM storage.buckets WHERE id = 'company-assets')),
  ('ROLLBACK avatars mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS TRUE FROM storage.buckets WHERE id = 'user-avatars')),
  ('ROLLBACK equipment mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS FALSE FROM storage.buckets WHERE id = 'equipment-photos')),
  ('ROLLBACK part-images mime and size NULL', (SELECT allowed_mime_types IS NULL AND file_size_limit IS NULL AND public IS TRUE FROM storage.buckets WHERE id = 'part-images')),
  ('ROLLBACK marketplace mime is jpeg/jpg and size NULL', (SELECT allowed_mime_types = ARRAY['image/jpeg','image/jpg']::text[] AND file_size_limit IS NULL AND public IS FALSE FROM storage.buckets WHERE id = 'marketplace-images')),
  ('ROLLBACK listing insert is authenticated', (SELECT polcmd = 'a' AND polroles = ARRAY['authenticated'::regrole]::oid[] FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'Authenticated users can upload listing images')),
  ('ROLLBACK public listing select is public', (SELECT polcmd = 'r' AND polroles = ARRAY[0::oid] FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'Public can view listing images')),
  ('ROLLBACK index 0 is back on the listing insert', (SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%[0]%' FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'Authenticated users can upload listing images')),
  ('ROLLBACK prior marker dropped', to_regclass('public.storage_000974_marketplace_prior') IS NULL);

\ir ../migrations/20261122_000974_storage_bucket_hardening.sql
INSERT INTO proof (label, ok) VALUES
  ('REAPPLY own listing insert works', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('marketplace-images','aaaaaaaa-0000-0000-0000-000000000001/listings/reapply.jpg')$q$));

SELECT n, label, ok FROM proof ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE ok IS NOT TRUE) AS fail FROM proof;
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(label, '; ' ORDER BY n) INTO bad FROM proof WHERE ok IS NOT TRUE;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'proof failed: %', bad;
  END IF;
END $$;
ROLLBACK;
