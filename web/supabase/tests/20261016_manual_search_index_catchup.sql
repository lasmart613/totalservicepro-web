-- Local proof for 20261016_000918_manual_search_index_catchup.sql.
-- Empty Postgres only. Refuses to run when public.manuals already exists.
-- One transaction that ends in ROLLBACK.
--
--   psql "postgresql:///catchup_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261016_manual_search_index_catchup.sql
--
-- Run psql from the repo root so the \i paths resolve.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.manuals') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.manuals already exists';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

BEGIN;

CREATE SCHEMA storage;
CREATE TABLE storage.objects (
  id bigserial PRIMARY KEY,
  bucket_id text NOT NULL,
  name text NOT NULL
);
CREATE INDEX ON storage.objects (bucket_id, name);

CREATE TABLE public.manuals (
  id bigint PRIMARY KEY,
  storage_path text,
  entry_file_path text,
  is_folder boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true
);
CREATE TABLE public.manual_search_index (
  manual_id bigint NOT NULL REFERENCES public.manuals(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  search_text text NOT NULL DEFAULT '',
  PRIMARY KEY (manual_id, chunk_index)
);
GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;

INSERT INTO public.manuals (id, storage_path, entry_file_path, is_folder, published) VALUES
  (1, 'shared/a/one.pdf', NULL, false, true),          -- indexed
  (2, 'shared/a/two.pdf', NULL, false, true),          -- missing, file present
  (3, 'shared/a/gone.pdf', NULL, false, true),         -- missing, no file
  (4, 'shared/a/hidden.pdf', NULL, false, false),      -- unpublished, file present
  (5, 'shared/sciton/profile', NULL, true, true),      -- folder, PDFs inside
  (6, 'shared/empty_folder', NULL, true, true),        -- folder, no PDFs
  (7, 'shared/a_b/x', 'shared/a_b/x/entry.pdf', false, true), -- entry file only
  (8, 'shared/a/eight.pdf', NULL, false, true);        -- missing, file present
INSERT INTO public.manual_search_index (manual_id, chunk_index, search_text) VALUES
  (1, 0, 'a'), (1, 1, 'b');
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('manuals', 'shared/a/one.pdf'),
  ('manuals', 'shared/a/two.pdf'),
  ('manuals', 'shared/a/hidden.pdf'),
  ('manuals', 'shared/sciton/profile/ch1.PDF'),
  ('manuals', 'shared/empty_folder/readme.txt'),
  ('manuals', 'shared/empty_folderX/real.pdf'),
  ('manuals', 'shared/a_b/x/entry.pdf'),
  ('manuals', 'shared/a/eight.pdf'),
  ('other', 'shared/a/gone.pdf');

\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql
-- Re-run is safe.
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql

DO $$
DECLARE r jsonb;
BEGIN
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 4, "eligible": 4, "ids": [2, 5, 7, 8]}'::jsonb THEN
    RAISE EXCEPTION 'unexpected missing set %', r;
  END IF;
  r := public.manuals_missing_search_index(2);
  IF r->'ids' <> '[2, 5]'::jsonb OR (r->>'missing')::int <> 4 THEN
    RAISE EXCEPTION 'limit not applied %', r;
  END IF;
  r := public.manuals_missing_search_index(1000);
  IF jsonb_array_length(r->'ids') <> 4 THEN RAISE EXCEPTION 'cap broke small set %', r; END IF;
  r := public.manuals_missing_search_index(NULL);
  IF jsonb_array_length(r->'ids') <> 4 THEN RAISE EXCEPTION 'null limit %', r; END IF;
  r := public.manuals_missing_search_index(0);
  IF r->'ids' <> '[]'::jsonb OR (r->>'missing')::int <> 4 THEN RAISE EXCEPTION 'zero limit %', r; END IF;
  RAISE NOTICE 'missing set ok: %', public.manuals_missing_search_index(5);
END $$;

-- Backoff: a failure hides the manual until retry_after, and doubles.
DO $$
DECLARE t1 timestamptz; t2 timestamptz; r jsonb; a int;
BEGIN
  t1 := public.record_manual_search_index_failure(2, 'pdf.js: Invalid PDF structure');
  IF t1 < now() + interval '14 minutes' OR t1 > now() + interval '16 minutes' THEN
    RAISE EXCEPTION 'first backoff %', t1 - now();
  END IF;
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 4, "eligible": 3, "ids": [5, 7, 8]}'::jsonb THEN
    RAISE EXCEPTION 'backed-off manual still eligible %', r;
  END IF;
  t2 := public.record_manual_search_index_failure(2, repeat('x', 900));
  SELECT attempts INTO a FROM public.manual_search_index_failures WHERE manual_id = 2;
  IF a <> 2 OR t2 < now() + interval '29 minutes' THEN RAISE EXCEPTION 'second backoff % %', a, t2 - now(); END IF;
  IF (SELECT length(last_error) FROM public.manual_search_index_failures WHERE manual_id = 2) <> 500 THEN
    RAISE EXCEPTION 'error not clipped';
  END IF;
  UPDATE public.manual_search_index_failures SET attempts = 30 WHERE manual_id = 2;
  t2 := public.record_manual_search_index_failure(2, 'again');
  IF t2 > now() + interval '24 hours 1 second' THEN RAISE EXCEPTION 'cap broke %', t2 - now(); END IF;
  -- Retry window passed: eligible again.
  UPDATE public.manual_search_index_failures SET retry_after = now() - interval '1 second' WHERE manual_id = 2;
  r := public.manuals_missing_search_index(5);
  IF r->'ids' <> '[2, 5, 7, 8]'::jsonb THEN RAISE EXCEPTION 'retry window %', r; END IF;
  -- Indexed: drops out. Deleting the manual cascades the failure row.
  INSERT INTO public.manual_search_index (manual_id, chunk_index, search_text) VALUES (2, 0, 'now indexed');
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 3, "eligible": 3, "ids": [5, 7, 8]}'::jsonb THEN RAISE EXCEPTION 'indexed still missing %', r; END IF;
  DELETE FROM public.manual_search_index WHERE manual_id = 2;
  RAISE NOTICE 'backoff ok';
END $$;

-- Privileges: service_role only.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.manuals_missing_search_index(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.manuals_missing_search_index(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.manual_search_index_failures', 'SELECT')
     OR has_table_privilege('authenticated', 'public.manual_search_index_failures', 'SELECT') THEN
    RAISE EXCEPTION 'anon/authenticated can reach the catch-up objects';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.manuals_missing_search_index(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.manual_search_index_failures', 'DELETE') THEN
    RAISE EXCEPTION 'service_role is missing a grant';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.manual_search_index_failures'::regclass) THEN
    RAISE EXCEPTION 'RLS is off';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname IN ('manuals_missing_search_index', 'record_manual_search_index_failure')
      AND NOT (p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
  ) THEN
    RAISE EXCEPTION 'functions must be SECURITY DEFINER with search_path ''''';
  END IF;
  RAISE NOTICE 'privileges ok';
END $$;

-- An authenticated caller is refused.
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.manuals_missing_search_index(5);
  RAISE EXCEPTION 'authenticated was allowed';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'authenticated refused ok';
END $$;
RESET ROLE;

-- A caller cannot shadow public tables through search_path.
CREATE SCHEMA evil;
CREATE TABLE evil.manuals (id bigint, storage_path text, entry_file_path text, is_folder boolean, published boolean);
SET LOCAL search_path = evil, public;
DO $$
BEGIN
  IF (public.manuals_missing_search_index(5)->>'missing')::int <> 4 THEN
    RAISE EXCEPTION 'search_path shadowing changed the result';
  END IF;
  RAISE NOTICE 'search_path ok';
END $$;
RESET search_path;

-- Rollback removes everything and leaves manual_search_index untouched.
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup_rollback.sql
DO $$
BEGIN
  IF to_regclass('public.manual_search_index_failures') IS NOT NULL
     OR to_regprocedure('public.manuals_missing_search_index(integer)') IS NOT NULL
     OR to_regprocedure('public.record_manual_search_index_failure(bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left objects behind';
  END IF;
  IF (SELECT count(*) FROM public.manual_search_index) <> 2 THEN
    RAISE EXCEPTION 'rollback touched manual_search_index';
  END IF;
  RAISE NOTICE 'rollback ok';
END $$;

-- Apply again after rollback.
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql
SELECT public.manuals_missing_search_index(5) AS reapplied;

ROLLBACK;
