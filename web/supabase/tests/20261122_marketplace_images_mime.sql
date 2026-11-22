-- Local proof for 000968 and 000970. Empty database only. Never production.
--
--   createdb marketplace_images_mime_proof
--   psql -d marketplace_images_mime_proof -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261122_marketplace_images_mime.sql
--
-- Covers both recorded priors (NULL mime, and {image/jpeg,image/jpg}),
-- an idempotent re-run, rollback back to {image/jpeg,image/jpg} with a NULL
-- size limit, and the foldername index ( [0] rejects the owner, [1] allows
-- {uid}/listings/... ).

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

-- Prior A: unrestricted mime, private bucket, no size limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketplace-images', 'marketplace-images', false, NULL, NULL);

\ir ../migrations/20261122_000968_marketplace_images_mime.sql

DO $$
DECLARE
  b storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'marketplace-images';
  IF b.allowed_mime_types IS DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[] THEN
    RAISE EXCEPTION 'NULL prior: mime is %', b.allowed_mime_types;
  END IF;
  IF b.file_size_limit IS DISTINCT FROM 5242880 THEN
    RAISE EXCEPTION 'NULL prior: size is %', b.file_size_limit;
  END IF;
  IF b.public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'NULL prior: public changed';
  END IF;
END $$;

-- Idempotent re-run while the target is already stored.
\ir ../migrations/20261122_000968_marketplace_images_mime.sql

DO $$
DECLARE
  b storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'marketplace-images';
  IF b.allowed_mime_types IS DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
     OR b.file_size_limit IS DISTINCT FROM 5242880
     OR b.public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'idempotent re-run changed the bucket';
  END IF;
END $$;

\ir ../migrations/20261122_000968_marketplace_images_mime_rollback.sql

DO $$
DECLARE
  b storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'marketplace-images';
  IF b.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/jpg']::text[] THEN
    RAISE EXCEPTION 'rollback mime is %', b.allowed_mime_types;
  END IF;
  IF b.file_size_limit IS NOT NULL THEN
    RAISE EXCEPTION 'rollback size is %', b.file_size_limit;
  END IF;
  IF b.public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'rollback changed public';
  END IF;
END $$;

-- Prior B: production MIME list {image/jpeg,image/jpg}, size still NULL.
\ir ../migrations/20261122_000968_marketplace_images_mime.sql

DO $$
DECLARE
  b storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'marketplace-images';
  IF b.allowed_mime_types IS DISTINCT FROM ARRAY['image/png','image/jpeg','image/webp']::text[]
     OR b.file_size_limit IS DISTINCT FROM 5242880
     OR b.public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'jpeg/jpg prior did not reach the target';
  END IF;
END $$;

-- foldername is 1-indexed. [0] is NULL, [1] is the uid folder.
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;

DO $$
DECLARE
  parts text[] := storage.foldername('11111111-1111-1111-1111-111111111111/listings/a.png');
BEGIN
  IF parts[0] IS NOT NULL THEN
    RAISE EXCEPTION 'foldername[0] was %', parts[0];
  END IF;
  IF parts[1] IS DISTINCT FROM '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'foldername[1] was %', parts[1];
  END IF;
END $$;

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- The 20260620 read policy. 000970 does not replace it. UPDATE and DELETE
-- cannot see a row unless some SELECT policy passes.
CREATE POLICY "Public can view listing images"
ON storage.objects FOR SELECT
USING (bucket_id = 'marketplace-images');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA storage, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- Current policies ([0]), then the fix ([1]), then the rollback ([0]).
\ir ../migrations/20261122_000970_marketplace_images_policy_index_rollback.sql

SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
GRANT authenticated TO CURRENT_USER;
SET ROLE authenticated;
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('marketplace-images', '11111111-1111-1111-1111-111111111111/listings/a.png');
  RAISE EXCEPTION 'proof: [0] policy allowed an upload';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT ILIKE '%row-level security%' THEN
    RAISE;
  END IF;
END $$;
RESET ROLE;

\ir ../migrations/20261122_000970_marketplace_images_policy_index.sql

SET ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('marketplace-images', '11111111-1111-1111-1111-111111111111/listings/a.png');
DO $$
DECLARE
  n int;
BEGIN
  UPDATE storage.objects SET name = name
  WHERE bucket_id = 'marketplace-images'
    AND name = '11111111-1111-1111-1111-111111111111/listings/a.png';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'proof: [1] update changed % rows', n;
  END IF;
END $$;
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('marketplace-images', '22222222-2222-2222-2222-222222222222/listings/b.png');
  RAISE EXCEPTION 'proof: [1] policy allowed another uid';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT ILIKE '%row-level security%' THEN
    RAISE;
  END IF;
END $$;
DO $$
DECLARE
  n int;
BEGIN
  DELETE FROM storage.objects
  WHERE bucket_id = 'marketplace-images'
    AND name = '11111111-1111-1111-1111-111111111111/listings/a.png';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'proof: [1] delete removed % rows', n;
  END IF;
END $$;
RESET ROLE;

\ir ../migrations/20261122_000970_marketplace_images_policy_index_rollback.sql

SET ROLE authenticated;
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('marketplace-images', '11111111-1111-1111-1111-111111111111/listings/a.png');
  RAISE EXCEPTION 'proof: rollback [0] policy allowed an upload';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT ILIKE '%row-level security%' THEN
    RAISE;
  END IF;
END $$;
RESET ROLE;

SELECT '20261122 marketplace images proof ok' AS status;
