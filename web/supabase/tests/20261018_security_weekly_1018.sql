-- Local proof for 20261018_000927_security_weekly_1018.sql and its rollback.
-- Empty Postgres 17 only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
--
--   createdb sec1018_proof
--   psql "postgresql:///sec1018_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_security_weekly_1018.sql
--
-- BASE recreates the live policies read 2026-10-18 and asserts their
-- fingerprints match the md5s the migration guards on. BEFORE shows the hole
-- (any signed-in user writes any org's logo; members self-delete). AFTER runs
-- 000927 (twice: idempotent). DRIFT shows a changed live policy blocks it.
-- ROLLBACK restores the base fingerprints exactly.
-- Orgs: QA ids 2655 (shop), 2639 (other shop), 2656 (CRM customer of 2655).
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
-- Same body as Supabase storage.foldername.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:array_length(_parts, 1) - 1];
END $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true), ('other', 'other', false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, UNIQUE (bucket_id, name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
-- Reads are not under test: allow SELECT so UPDATE/DELETE can see rows.
CREATE POLICY test_read_all ON storage.objects FOR SELECT TO authenticated USING (true);

CREATE TABLE public.organizations (id bigint PRIMARY KEY, name text NOT NULL, type text);
CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL, organization_id bigint NOT NULL REFERENCES public.organizations(id), role text, is_home boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now(), UNIQUE (user_id, organization_id));
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.organization_memberships TO authenticated;
CREATE POLICY organization_memberships_select_own ON public.organization_memberships FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TABLE public.organization_customers (id bigserial PRIMARY KEY, service_organization_id bigint, customer_organization_id bigint);
CREATE TABLE public.api_usage (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, request_type text, tokens_used integer, created_at timestamp DEFAULT now());
GRANT ALL ON public.api_usage TO service_role;

-- Live policies (2026-10-18).
CREATE POLICY "Allow authenticated logo uploads" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos'::text);
CREATE POLICY "Allow authenticated logo updates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'logos'::text);
CREATE POLICY organization_memberships_delete_own ON public.organization_memberships FOR DELETE TO authenticated USING ((user_id = auth.uid()) AND (is_home = false));

INSERT INTO public.organizations VALUES (2655, 'QA shop A', 'service_company'), (2639, 'QA shop B', 'service_company'), (2656, 'QA clinic C', 'clinic'),
  (2657, 'claimed clinic D', 'clinic'), (9001, 'parts seller P', 'parts_supplier'), (9002, 'shop with odd role', 'service_company');
-- 2656 = unclaimed CRM customer of 2655 (no members); 2657 = CRM customer of 2655 claimed by d1 (owner).
-- p1 = parts_supplier on parts_supplier org 9001 (sole member); p2 = role 'parts_supplier' on a non-supplier org 9002.
-- a1 = owner 2655, a2 = company_admin 2655, f1 = fse 2655, b1 = owner 2639
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 2655, 'owner', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', 2655, 'company_admin', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 2655, 'fse', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 2639, 'fse', false),
  ('bbbbbbbb-0000-0000-0000-000000000001', 2639, 'owner', true),
  ('dddddddd-1111-0000-0000-000000000001', 2657, 'owner', true),
  ('eeeeeeee-0000-0000-0000-000000000001', 9001, 'parts_supplier', true),
  ('eeeeeeee-0000-0000-0000-000000000002', 9002, 'parts_supplier', true);
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (2655, 2656), (2655, 2657);
INSERT INTO storage.objects (bucket_id, name) VALUES ('logos', '2655/logo-1.png'), ('logos', '2639/logo-1.png'), ('logos', '2656/logo-1.png'), ('logos', '2657/logo-1.png'), ('logos', '9001/logo-1.png');

CREATE TEMP TABLE proof (n serial, label text, ok boolean);
GRANT ALL ON proof TO anon, authenticated, service_role;
GRANT ALL ON SEQUENCE proof_n_seq TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.fp(rel regclass, pname text) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
  FROM pg_policy WHERE polrelid = rel AND polname = pname
$$;

-- try_as(uid, sql): true when the statement succeeds as that user and touches
-- >=1 row. Its effect is always undone (sub-transaction), so cases are independent.
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

-- BASE
INSERT INTO proof (label, ok) VALUES
  ('BASE uploads fp = guard', pg_temp.fp('storage.objects', 'Allow authenticated logo uploads') = '1eb717041618acedadfe689193b91c26'),
  ('BASE updates fp = guard', pg_temp.fp('storage.objects', 'Allow authenticated logo updates') = '1734a127a8a762408f2f9f4baad62c24'),
  ('BASE delete_own fp = guard', pg_temp.fp('public.organization_memberships', 'organization_memberships_delete_own') = 'c07f80daae380e196fa5f31dcd38357a');

-- BEFORE (hole)
INSERT INTO proof (label, ok) VALUES
  ('BEFORE b1 (shop B) can overwrite shop A logo', pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('BEFORE b1 can insert into 2655/', pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/evil.svg')$q$)),
  ('BEFORE fse self-deletes non-home membership', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000003', $q$DELETE FROM public.organization_memberships WHERE user_id = auth.uid() AND organization_id = 2639$q$));
-- AFTER (apply twice)
\ir ../migrations/20261018_000927_security_weekly_1018.sql
\ir ../migrations/20261018_000927_security_weekly_1018.sql

INSERT INTO proof (label, ok) VALUES
  ('AFTER old logo policies gone', NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname IN ('Allow authenticated logo uploads','Allow authenticated logo updates'))),
  ('AFTER 3 logos_admin_* policies', (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname LIKE 'logos_admin_%') = 3),
  ('AFTER delete_own gone', pg_temp.fp('public.organization_memberships', 'organization_memberships_delete_own') IS NULL),
  ('AFTER writable secdef + search_path empty', (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.logo_object_writable(text)'::regprocedure)),
  ('AFTER reserve secdef + search_path empty', (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.ai_usage_reserve(uuid,text,integer)'::regprocedure)),
  ('AFTER release secdef + search_path empty', (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.ai_usage_release(uuid,uuid)'::regprocedure)),
  ('AFTER anon cannot execute writable', NOT has_function_privilege('anon', 'public.logo_object_writable(text)', 'EXECUTE')),
  ('AFTER anon cannot execute reserve', NOT has_function_privilege('anon', 'public.ai_usage_reserve(uuid,text,integer)', 'EXECUTE')),
  ('AFTER authenticated cannot execute reserve', NOT has_function_privilege('authenticated', 'public.ai_usage_reserve(uuid,text,integer)', 'EXECUTE')),
  ('AFTER authenticated cannot execute release', NOT has_function_privilege('authenticated', 'public.ai_usage_release(uuid,uuid)', 'EXECUTE')),
  ('AFTER logos mime = png/jpeg/webp (no svg)', (SELECT allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'] FROM storage.buckets WHERE id='logos')),
  ('AFTER logos file_size_limit = 2 MB', (SELECT file_size_limit = 2097152 FROM storage.buckets WHERE id='logos')),
  ('AFTER other bucket size limit untouched', (SELECT file_size_limit IS NULL FROM storage.buckets WHERE id='other')),
  ('AFTER other bucket mime untouched', (SELECT allowed_mime_types IS NULL FROM storage.buckets WHERE id='other')),
  ('AFTER service_role executes reserve', has_function_privilege('service_role', 'public.ai_usage_reserve(uuid,text,integer)', 'EXECUTE'));

INSERT INTO proof (label, ok) VALUES
  ('AFTER owner 2655 inserts 2655/', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/logo-2.png')$q$)),
  ('AFTER owner 2655 re-uploads (update) 2655/logo-1', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('AFTER company_admin 2655 inserts 2655/', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/logo-3.png')$q$)),
  ('AFTER shop admin 2655 uploads CRM customer 2656/', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2656/logo-2.png')$q$)),
  ('AFTER owner deletes own org logo', pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$DELETE FROM storage.objects WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('AFTER parts_supplier member inserts own org 9001/', pg_temp.try_as('eeeeeeee-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','9001/logo-2.png')$q$)),
  ('AFTER parts_supplier member re-uploads (update) 9001/logo-1', pg_temp.try_as('eeeeeeee-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='logos' AND name='9001/logo-1.png'$q$)),
  ('AFTER claimed clinic owner writes own 2657/', pg_temp.try_as('dddddddd-1111-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2657/logo-2.png')$q$)),
  ('AFTER onboarding uid folder insert', pg_temp.try_as('cccccccc-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','cccccccc-0000-0000-0000-000000000001/onboard-logo-1.png')$q$));
INSERT INTO proof (label, ok) VALUES
  ('AFTER shop B owner cannot update shop A logo', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('AFTER shop B owner cannot insert 2655/', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/evil.png')$q$)),
  ('AFTER shop B owner cannot delete 2655/', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$DELETE FROM storage.objects WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('AFTER shop B owner cannot write CRM 2656/', NOT pg_temp.try_as('bbbbbbbb-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2656/evil.png')$q$)),
  ('AFTER fse 2655 cannot insert 2655/', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000003', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/fse.png')$q$)),
  ('AFTER cannot move object into another org (update WITH CHECK)', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET name='2639/logo-x.png' WHERE bucket_id='logos' AND name='2655/logo-1.png'$q$)),
  ('AFTER other uid folder refused', NOT pg_temp.try_as('cccccccc-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','aaaaaaaa-0000-0000-0000-000000000001/x.png')$q$)),
  ('AFTER bucket root refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','root.png')$q$)),
  ('AFTER dotdot refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/../2639/x.png')$q$)),
  ('AFTER legacy parts/ refused', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','parts/aaaaaaaa-0000-0000-0000-000000000001/x.png')$q$)),
  ('AFTER no uid refused', NOT pg_temp.try_as('', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/anon.png')$q$)),
  ('AFTER other bucket unaffected by logos policies', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('other','2655/x.png')$q$)),
  ('AFTER parts_supplier role on non-supplier org 9002 refused', NOT pg_temp.try_as('eeeeeeee-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','9002/x.png')$q$)),
  ('AFTER parts_supplier member cannot write shop 2655/', NOT pg_temp.try_as('eeeeeeee-0000-0000-0000-000000000001', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2655/x.png')$q$)),
  ('AFTER shop admin cannot insert claimed CRM clinic 2657/', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000002', $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('logos','2657/shop.png')$q$)),
  ('AFTER shop owner cannot overwrite claimed CRM clinic 2657/logo-1', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000001', $q$UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='logos' AND name='2657/logo-1.png'$q$)),
  ('AFTER fse cannot self-delete membership', NOT pg_temp.try_as('aaaaaaaa-0000-0000-0000-000000000003', $q$DELETE FROM public.organization_memberships WHERE user_id = auth.uid() AND organization_id = 2639$q$));
-- ai_usage_reserve / release (service_role, as the edge function calls it)
SAVEPOINT s2;
INSERT INTO public.api_usage (user_id, request_type, tokens_used, created_at) VALUES
  ('dddddddd-0000-0000-0000-000000000002', 'grok_chat', 10, (now() AT TIME ZONE 'utc') - interval '1 day'),
  ('dddddddd-0000-0000-0000-000000000002', 'grok_tts', 10, now() AT TIME ZONE 'utc');
SET LOCAL ROLE service_role;
CREATE TEMP TABLE r AS SELECT g, public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000001', 'grok_chat', 3) AS j FROM generate_series(1, 5) g;
CREATE TEMP TABLE r2 AS SELECT public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000002', 'grok_chat', 1) AS j;
CREATE TEMP TABLE r3 AS SELECT public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000002', 'grok_tts', 1) AS j;
RESET ROLE;
INSERT INTO proof (label, ok) VALUES
  ('RESERVE first 3 ok', (SELECT count(*) FROM r WHERE (j->>'ok')::boolean) = 3),
  ('RESERVE 4th and 5th refused at used=3', (SELECT count(*) FROM r WHERE NOT (j->>'ok')::boolean AND (j->>'used')::int = 3) = 2),
  ('RESERVE wrote exactly 3 rows', (SELECT count(*) FROM public.api_usage WHERE user_id='dddddddd-0000-0000-0000-000000000001') = 3),
  ('RESERVE used counts 1..3', (SELECT array_agg((j->>'used')::int ORDER BY g) FROM r WHERE (j->>'ok')::boolean) = ARRAY[1,2,3]),
  ('RESERVE rows start at tokens_used 0', (SELECT bool_and(tokens_used = 0) FROM public.api_usage WHERE user_id='dddddddd-0000-0000-0000-000000000001')),
  ('RESERVE yesterday rows do not count', (SELECT (j->>'ok')::boolean FROM r2)),
  ('RESERVE per type (tts already at cap)', (SELECT NOT (j->>'ok')::boolean FROM r3));

SET LOCAL ROLE service_role;
CREATE TEMP TABLE rel AS SELECT
  public.ai_usage_release(((SELECT j FROM r WHERE g = 1)->>'id')::uuid, 'dddddddd-0000-0000-0000-000000000001') AS own,
  public.ai_usage_release(((SELECT j FROM r WHERE g = 2)->>'id')::uuid, 'dddddddd-0000-0000-0000-000000000002') AS wrong_user;
UPDATE public.api_usage SET tokens_used = 42 WHERE id = ((SELECT j FROM r WHERE g = 3)->>'id')::uuid;
CREATE TEMP TABLE rel2 AS SELECT public.ai_usage_release(((SELECT j FROM r WHERE g = 3)->>'id')::uuid, 'dddddddd-0000-0000-0000-000000000001') AS finalized;
CREATE TEMP TABLE r4 AS SELECT public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000001', 'grok_chat', 3) AS j;
RESET ROLE;
INSERT INTO proof (label, ok) VALUES
  ('RELEASE refunds own unfinalised row', (SELECT own FROM rel)),
  ('RELEASE refuses other user id', (SELECT NOT wrong_user FROM rel)),
  ('RELEASE refuses finalised row', (SELECT NOT finalized FROM rel2)),
  ('RESERVE after refund gets a slot again', (SELECT (j->>'ok')::boolean AND (j->>'used')::int = 3 FROM r4));

DO $$
BEGIN
  BEGIN
    PERFORM public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000001', 'other', 3);
    INSERT INTO proof (label, ok) VALUES ('RESERVE rejects unknown type', false);
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO proof (label, ok) VALUES ('RESERVE rejects unknown type', true);
  END;
  BEGIN
    PERFORM public.ai_usage_reserve(NULL, 'grok_chat', 3);
    INSERT INTO proof (label, ok) VALUES ('RESERVE rejects null user', false);
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO proof (label, ok) VALUES ('RESERVE rejects null user', true);
  END;
END $$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.ai_usage_reserve('dddddddd-0000-0000-0000-000000000001', 'grok_chat', 3);
  INSERT INTO proof (label, ok) VALUES ('RESERVE denied to authenticated', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO proof (label, ok) VALUES ('RESERVE denied to authenticated', true);
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.ai_usage_release(gen_random_uuid(), gen_random_uuid());
  INSERT INTO proof (label, ok) VALUES ('RELEASE denied to anon', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO proof (label, ok) VALUES ('RELEASE denied to anon', true);
END $$;
RESET ROLE;
DELETE FROM public.api_usage;
RELEASE SAVEPOINT s2;

-- DRIFT guards are proven by 20261018_security_weekly_1018_drift.sh (a
-- failing migration aborts the transaction, so it runs in its own session).

-- ROLLBACK
\ir ../migrations/20261018_000927_security_weekly_1018_rollback.sql
INSERT INTO proof (label, ok) VALUES
  ('ROLLBACK uploads fp restored', pg_temp.fp('storage.objects', 'Allow authenticated logo uploads') = '1eb717041618acedadfe689193b91c26'),
  ('ROLLBACK updates fp restored', pg_temp.fp('storage.objects', 'Allow authenticated logo updates') = '1734a127a8a762408f2f9f4baad62c24'),
  ('ROLLBACK delete_own fp restored', pg_temp.fp('public.organization_memberships', 'organization_memberships_delete_own') = 'c07f80daae380e196fa5f31dcd38357a'),
  ('ROLLBACK uploads cmd/roles restored', (SELECT polcmd = 'a' AND polroles = ARRAY['authenticated'::regrole::oid] FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='Allow authenticated logo uploads')),
  ('ROLLBACK updates cmd/roles restored', (SELECT polcmd = 'w' AND polroles = ARRAY['authenticated'::regrole::oid] FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='Allow authenticated logo updates')),
  ('ROLLBACK delete_own cmd/roles restored', (SELECT polcmd = 'd' AND polroles = ARRAY['authenticated'::regrole::oid] FROM pg_policy WHERE polrelid='public.organization_memberships'::regclass AND polname='organization_memberships_delete_own')),
  ('ROLLBACK logos file_size_limit back to NULL', (SELECT file_size_limit IS NULL FROM storage.buckets WHERE id='logos')),
  ('ROLLBACK logos mime back to NULL', (SELECT allowed_mime_types IS NULL FROM storage.buckets WHERE id='logos')),
  ('ROLLBACK logos_admin_* gone', NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname LIKE 'logos_admin_%')),
  ('ROLLBACK functions gone', to_regprocedure('public.logo_object_writable(text)') IS NULL AND to_regprocedure('public.ai_usage_reserve(uuid,text,integer)') IS NULL AND to_regprocedure('public.ai_usage_release(uuid,uuid)') IS NULL);

-- Re-apply after rollback works.
\ir ../migrations/20261018_000927_security_weekly_1018.sql
INSERT INTO proof (label, ok) VALUES ('REAPPLY after rollback', (SELECT count(*) FROM pg_policy WHERE polname LIKE 'logos_admin_%') = 3);

SELECT n, label, ok FROM proof ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE ok IS NOT TRUE) AS fail FROM proof;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM proof WHERE ok IS NOT TRUE) THEN RAISE EXCEPTION 'proof failed'; END IF; END $$;
ROLLBACK;
