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
-- Matches the prod columns the migration reads (versioned storage).
CREATE TABLE storage.objects (
  id bigserial PRIMARY KEY,
  bucket_id text NOT NULL,
  name text NOT NULL,
  metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean NOT NULL DEFAULT false
);
CREATE INDEX ON storage.objects (bucket_id, name);

CREATE TABLE public.manuals (
  id bigint PRIMARY KEY,
  storage_path text,
  entry_file_path text,
  is_folder boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true
);
-- Same shape as prod after 000913 (generated tsvector + GIN).
CREATE TABLE public.manual_search_index (
  manual_id bigint NOT NULL REFERENCES public.manuals(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0 CHECK (chunk_index >= 0 AND chunk_index < 100),
  search_text text NOT NULL DEFAULT '',
  indexed_at timestamptz,
  index_clipped boolean NOT NULL DEFAULT false,
  indexed_page_max integer,
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(search_text, ''::text))) STORED,
  PRIMARY KEY (manual_id, chunk_index)
);
CREATE INDEX idx_manual_search_index_tsv ON public.manual_search_index USING gin (search_tsv);
GRANT USAGE ON SCHEMA public, storage TO anon, authenticated, service_role;

-- The live 000913 search_manual_catalog and replace_manual_search_index
-- (000918 redefines both; the rollback restores these bodies).
\i web/supabase/tests/fixtures/000913_functions.sql

INSERT INTO public.manuals (id, storage_path, entry_file_path, is_folder, published) VALUES
  (1, 'shared/a/one.pdf', NULL, false, true),          -- indexed
  (2, 'shared/a/two.pdf', NULL, false, true),          -- missing, file present
  (3, 'shared/a/gone.pdf', NULL, false, true),         -- missing, no file
  (4, 'shared/a/hidden.pdf', NULL, false, false),      -- unpublished, file present
  (5, 'shared/sciton/profile', NULL, true, true),      -- folder, PDFs inside
  (6, 'shared/empty_folder', NULL, true, true),        -- folder, no PDFs
  (7, 'shared/a_b/x', 'shared/a_b/x/entry.pdf', false, true), -- entry file only
  (8, 'shared/a/eight.pdf', NULL, false, true),        -- missing, file present
  (9, 'shared/a/nine.pdf', NULL, false, true),         -- deleted: delete marker only
  (10, 'shared/a/ten.pdf', NULL, false, true),         -- deleted: archived version only
  (11, 'shared/a/huge.pdf', NULL, false, true),        -- 25 MiB: oversized
  (12, 'shared/big_folder', NULL, true, true),         -- folder, 2 x 12 MiB = 24 MiB: oversized
  (13, 'shared/a/nosize.pdf', NULL, false, true),      -- no size metadata: unknown_size, not eligible
  (14, 'shared/a/replaced.pdf', NULL, false, true),    -- archived old version + live version
  (15, 'shared/a/badsize.pdf', NULL, false, true);     -- size is not a number: unknown_size
INSERT INTO public.manual_search_index (manual_id, chunk_index, search_text) VALUES
  (1, 0, 'a'), (1, 1, 'b');
INSERT INTO storage.objects (bucket_id, name, metadata, archived_at, is_delete_marker) VALUES
  ('manuals', 'shared/a/one.pdf', '{"size": 1000}', NULL, false),
  ('manuals', 'shared/a/two.pdf', '{"size": 2000}', NULL, false),
  ('manuals', 'shared/a/hidden.pdf', '{"size": 1000}', NULL, false),
  ('manuals', 'shared/sciton/profile/ch1.PDF', '{"size": 3000}', NULL, false),
  ('manuals', 'shared/sciton/profile/ch2.pdf', '{"size": 3000}', NULL, false),
  ('manuals', 'shared/empty_folder/readme.txt', '{"size": 10}', NULL, false),
  ('manuals', 'shared/empty_folderX/real.pdf', '{"size": 10}', NULL, false),
  ('manuals', 'shared/a_b/x/entry.pdf', '{"size": 4000}', NULL, false),
  ('manuals', 'shared/a/eight.pdf', '{"size": 4000}', NULL, false),
  ('manuals', 'shared/a/nine.pdf', NULL, NULL, true),
  ('manuals', 'shared/a/ten.pdf', '{"size": 5000}', now() - interval '1 day', false),
  ('manuals', 'shared/a/huge.pdf', '{"size": 26214400}', NULL, false),
  ('manuals', 'shared/big_folder/a.pdf', '{"size": 12582912}', NULL, false),
  ('manuals', 'shared/big_folder/b.pdf', '{"size": 12582912}', NULL, false),
  ('manuals', 'shared/a/nosize.pdf', '{}', NULL, false),
  ('manuals', 'shared/a/replaced.pdf', '{"size": 99999999}', now() - interval '1 day', false),
  ('manuals', 'shared/a/replaced.pdf', '{"size": 7000}', NULL, false),
  ('manuals', 'shared/a/badsize.pdf', '{"size": "12 MB"}', NULL, false),
  ('other', 'shared/a/gone.pdf', '{"size": 1}', NULL, false);

-- Stand-in for the earlier (integer) draft: applying must replace it, not
-- leave an ambiguous overload.
CREATE FUNCTION public.manuals_missing_search_index(p_limit integer)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql
-- Re-run is safe.
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql

DO $$
DECLARE r jsonb;
BEGIN
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 9, "eligible": 5, "oversized": 2, "oversized_ids": [11, 12],
            "unknown_size": 2, "unknown_size_ids": [13, 15],
            "no_file": 4, "no_file_ids": [3, 6, 9, 10], "in_progress": 0,
            "ids": [2, 5, 7, 8, 14]}'::jsonb THEN
    RAISE EXCEPTION 'unexpected missing set %', r;
  END IF;
  r := public.manuals_missing_search_index(2);
  IF r->'ids' <> '[2, 5]'::jsonb OR (r->>'missing')::int <> 9 THEN
    RAISE EXCEPTION 'limit not applied %', r;
  END IF;
  r := public.manuals_missing_search_index(1000);
  IF r->'ids' <> '[2, 5, 7, 8, 14]'::jsonb THEN RAISE EXCEPTION 'cap broke small set %', r; END IF;
  r := public.manuals_missing_search_index(NULL);
  IF jsonb_array_length(r->'ids') <> 5 THEN RAISE EXCEPTION 'null limit %', r; END IF;
  r := public.manuals_missing_search_index(0);
  IF r->'ids' <> '[]'::jsonb OR (r->>'missing')::int <> 9 THEN RAISE EXCEPTION 'zero limit %', r; END IF;
  -- Size cap is a parameter: at 24.5 MiB only the 25 MiB file is oversized,
  -- the 24 MiB folder becomes eligible. Unknown sizes stay out at any cap.
  r := public.manuals_missing_search_index(50, 25690112);
  IF r->'oversized_ids' <> '[11]'::jsonb OR r->'ids' <> '[2, 5, 7, 8, 12, 14]'::jsonb THEN
    RAISE EXCEPTION 'max bytes param %', r;
  END IF;
  r := public.manuals_missing_search_index(50, 9223372036854775807);
  IF r->'ids' @> '[13]'::jsonb OR r->'ids' @> '[15]'::jsonb OR r->'unknown_size_ids' <> '[13, 15]'::jsonb THEN
    RAISE EXCEPTION 'unknown size treated as small %', r;
  END IF;
  r := public.manuals_missing_search_index(50, NULL);
  IF r->'oversized_ids' <> '[11, 12]'::jsonb THEN RAISE EXCEPTION 'null max bytes %', r; END IF;
  -- A folder with one sized and one unsized PDF is unknown, not small.
  INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('manuals', 'shared/sciton/profile/ch3.pdf', NULL);
  r := public.manuals_missing_search_index(50);
  IF r->'unknown_size_ids' <> '[5, 13, 15]'::jsonb OR r->'ids' @> '[5]'::jsonb THEN RAISE EXCEPTION 'folder unknown size %', r; END IF;
  DELETE FROM storage.objects WHERE name = 'shared/sciton/profile/ch3.pdf';
  RAISE NOTICE 'missing set ok (deleted versions absent, oversized/unknown size excluded, no_file listed): %', public.manuals_missing_search_index(5);
END $$;

-- Backoff: the attempt is recorded BEFORE extraction, so a run that is then
-- killed (timeout, OOM) still hides the manual until retry_after.
DO $$
DECLARE t1 timestamptz; t2 timestamptz; t3 timestamptz; r jsonb; a int;
BEGIN
  t1 := public.record_manual_search_index_attempt(2, 'started');
  IF t1 < now() + interval '14 minutes' OR t1 > now() + interval '16 minutes' THEN
    RAISE EXCEPTION 'first backoff %', t1 - now();
  END IF;
  r := public.manuals_missing_search_index(5);
  IF r->'ids' <> '[5, 7, 8, 14]'::jsonb OR (r->>'eligible')::int <> 4 THEN
    RAISE EXCEPTION 'attempted manual still eligible %', r;
  END IF;
  -- The failure reason does not bump attempts or move retry_after again.
  t2 := public.record_manual_search_index_failure(2, 'pdf.js: Invalid PDF structure');
  SELECT attempts INTO a FROM public.manual_search_index_failures WHERE manual_id = 2;
  IF a <> 1 OR t2 <> t1 THEN RAISE EXCEPTION 'failure bumped attempts % or moved retry %', a, t2 - t1; END IF;
  IF (SELECT last_error FROM public.manual_search_index_failures WHERE manual_id = 2) <> 'pdf.js: Invalid PDF structure' THEN
    RAISE EXCEPTION 'failure reason not stored';
  END IF;
  -- Second attempt doubles.
  t2 := public.record_manual_search_index_attempt(2, repeat('x', 900));
  SELECT attempts INTO a FROM public.manual_search_index_failures WHERE manual_id = 2;
  IF a <> 2 OR t2 < now() + interval '29 minutes' OR t2 > now() + interval '31 minutes' THEN
    RAISE EXCEPTION 'second backoff % %', a, t2 - now();
  END IF;
  IF (SELECT length(last_error) FROM public.manual_search_index_failures WHERE manual_id = 2) <> 500 THEN
    RAISE EXCEPTION 'note not clipped';
  END IF;
  UPDATE public.manual_search_index_failures SET attempts = 30 WHERE manual_id = 2;
  t2 := public.record_manual_search_index_attempt(2, 'again');
  IF t2 > now() + interval '24 hours 1 second' OR t2 < now() + interval '23 hours' THEN RAISE EXCEPTION 'cap broke %', t2 - now(); END IF;
  -- A failure with no attempt row still backs off (15 min).
  t3 := public.record_manual_search_index_failure(7, repeat('y', 900));
  IF t3 < now() + interval '14 minutes' OR (SELECT length(last_error) FROM public.manual_search_index_failures WHERE manual_id = 7) <> 500 THEN
    RAISE EXCEPTION 'failure without attempt %', t3 - now();
  END IF;
  DELETE FROM public.manual_search_index_failures WHERE manual_id = 7;
  -- Retry window passed: eligible again.
  UPDATE public.manual_search_index_failures SET retry_after = now() - interval '1 second' WHERE manual_id = 2;
  r := public.manuals_missing_search_index(5);
  IF r->'ids' <> '[2, 5, 7, 8, 14]'::jsonb THEN RAISE EXCEPTION 'retry window %', r; END IF;
  -- Indexed: drops out. Deleting the manual cascades the failure row.
  INSERT INTO public.manual_search_index (manual_id, chunk_index, search_text) VALUES (2, 0, 'now indexed');
  r := public.manuals_missing_search_index(5);
  IF (r->>'missing')::int <> 8 OR r->'ids' <> '[5, 7, 8, 14]'::jsonb THEN RAISE EXCEPTION 'indexed still missing %', r; END IF;
  DELETE FROM public.manual_search_index WHERE manual_id = 2;
  DELETE FROM public.manuals WHERE id = 2;
  IF EXISTS (SELECT 1 FROM public.manual_search_index_failures WHERE manual_id = 2) THEN
    RAISE EXCEPTION 'failure row did not cascade';
  END IF;
  RAISE NOTICE 'backoff ok (attempt before extraction)';
END $$;

-- Chunked writes: expect-empty claim, row-count guard, marker hides the
-- partial manual from search and keeps it missing, finish/abort/takeover.
DO $$
DECLARE r jsonb; tok uuid; tok2 uuid; ok boolean;
BEGIN
  r := public.begin_manual_search_index_append(8, 3);
  IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'begin %', r; END IF;
  tok := (r->>'token')::uuid;
  IF public.begin_manual_search_index_append(8, 3)->>'status' <> 'busy' THEN RAISE EXCEPTION 'second writer not busy'; END IF;
  IF public.append_manual_search_index_chunks(8, gen_random_uuid(), 0, ARRAY['x'], NULL, NULL) THEN RAISE EXCEPTION 'wrong token appended'; END IF;
  IF public.append_manual_search_index_chunks(8, tok, 1, ARRAY['x'], NULL, NULL) THEN RAISE EXCEPTION 'wrong row count appended'; END IF;
  IF NOT public.append_manual_search_index_chunks(8, tok, 0, ARRAY['[[pdfpage:1]] zebrafish alpha'], ARRAY[false], ARRAY[1]) THEN RAISE EXCEPTION 'chunk 0'; END IF;
  -- Partial: not searchable, still missing (in progress, not eligible while fresh).
  IF EXISTS (SELECT 1 FROM public.search_manual_catalog('zebrafish')) THEN RAISE EXCEPTION 'partial manual searchable'; END IF;
  r := public.manuals_missing_search_index(50);
  IF (r->>'in_progress')::int <> 1 OR r->'ids' @> '[8]'::jsonb OR (r->>'missing')::int <> 8 THEN RAISE EXCEPTION 'partial manual not missing/in progress %', r; END IF;
  IF public.finish_manual_search_index_append(8, tok) THEN RAISE EXCEPTION 'finished early'; END IF;
  IF NOT public.append_manual_search_index_chunks(8, tok, 1, ARRAY['[[pdfpage:2]] beta', '[[pdfpage:3]] gamma'], ARRAY[false, false], ARRAY[2, 3]) THEN RAISE EXCEPTION 'chunks 1-2'; END IF;
  IF public.append_manual_search_index_chunks(8, tok, 3, ARRAY['too many'], NULL, NULL) THEN RAISE EXCEPTION 'appended past total'; END IF;
  IF NOT public.finish_manual_search_index_append(8, tok) THEN RAISE EXCEPTION 'finish'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_manual_catalog('zebrafish') WHERE manual_id = 8) THEN RAISE EXCEPTION 'complete manual not searchable'; END IF;
  IF (SELECT array_agg(chunk_index ORDER BY chunk_index) FROM public.manual_search_index WHERE manual_id = 8) <> ARRAY[0, 1, 2] THEN RAISE EXCEPTION 'chunk order'; END IF;
  r := public.manuals_missing_search_index(50);
  IF r->'ids' @> '[8]'::jsonb OR (r->>'missing')::int <> 7 OR (r->>'in_progress')::int <> 0 THEN RAISE EXCEPTION 'complete manual still missing %', r; END IF;
  IF public.begin_manual_search_index_append(8, 1)->>'status' <> 'already_indexed' THEN RAISE EXCEPTION 'expect-empty claim'; END IF;

  -- Abort: only with the right token; removes partial rows and the marker.
  tok := (public.begin_manual_search_index_append(14, 2)->>'token')::uuid;
  PERFORM public.append_manual_search_index_chunks(14, tok, 0, ARRAY['partial'], NULL, NULL);
  IF public.abort_manual_search_index_append(14, gen_random_uuid()) THEN RAISE EXCEPTION 'abort with wrong token'; END IF;
  IF public.abort_manual_search_index_append(8, tok) THEN RAISE EXCEPTION 'abort touched a complete manual'; END IF;
  IF (SELECT count(*) FROM public.manual_search_index WHERE manual_id = 8) <> 3 THEN RAISE EXCEPTION 'complete manual lost rows'; END IF;
  IF NOT public.abort_manual_search_index_append(14, tok) THEN RAISE EXCEPTION 'abort'; END IF;
  IF EXISTS (SELECT 1 FROM public.manual_search_index WHERE manual_id = 14)
     OR EXISTS (SELECT 1 FROM public.manual_search_index_pending WHERE manual_id = 14) THEN RAISE EXCEPTION 'abort left rows'; END IF;

  -- Stale takeover: a writer that died 11 minutes ago.
  tok := (public.begin_manual_search_index_append(5, 2)->>'token')::uuid;
  PERFORM public.append_manual_search_index_chunks(5, tok, 0, ARRAY['stale partial'], NULL, NULL);
  UPDATE public.manual_search_index_pending SET started_at = now() - interval '11 minutes' WHERE manual_id = 5;
  IF NOT (public.manuals_missing_search_index(50)->'ids' @> '[5]'::jsonb) THEN RAISE EXCEPTION 'stale manual not eligible'; END IF;
  r := public.begin_manual_search_index_append(5, 1);
  IF r->>'status' <> 'ok' THEN RAISE EXCEPTION 'takeover %', r; END IF;
  tok2 := (r->>'token')::uuid;
  IF EXISTS (SELECT 1 FROM public.manual_search_index WHERE manual_id = 5) THEN RAISE EXCEPTION 'stale partial rows kept'; END IF;
  IF public.append_manual_search_index_chunks(5, tok, 0, ARRAY['old writer'], NULL, NULL) THEN RAISE EXCEPTION 'old token still writes'; END IF;
  IF NOT public.abort_manual_search_index_append(5, tok2) THEN RAISE EXCEPTION 'abort takeover'; END IF;

  -- A God replace wins over a writer in progress and clears its marker.
  tok := (public.begin_manual_search_index_append(7, 2)->>'token')::uuid;
  PERFORM public.append_manual_search_index_chunks(7, tok, 0, ARRAY['partial seven'], NULL, NULL);
  IF NOT public.replace_manual_search_index(7, ARRAY['god text'], ARRAY[false], ARRAY[NULL::int], md5('partial seven')) THEN RAISE EXCEPTION 'replace'; END IF;
  IF EXISTS (SELECT 1 FROM public.manual_search_index_pending WHERE manual_id = 7) THEN RAISE EXCEPTION 'replace left marker'; END IF;
  IF public.finish_manual_search_index_append(7, tok) OR public.abort_manual_search_index_append(7, tok) THEN RAISE EXCEPTION 'old writer touched replaced manual'; END IF;
  IF (SELECT search_text FROM public.manual_search_index WHERE manual_id = 7) <> 'god text' THEN RAISE EXCEPTION 'replace rows lost'; END IF;

  -- Restore: only manual 1 indexed (2 rows) for the checks below.
  DELETE FROM public.manual_search_index WHERE manual_id IN (7, 8);
  RAISE NOTICE 'chunked writes ok';
END $$;

-- Privileges: service_role only.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.manuals_missing_search_index(integer, bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.manuals_missing_search_index(integer, bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_manual_search_index_attempt(bigint, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_manual_search_index_attempt(bigint, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_manual_search_index_append(bigint, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_manual_search_index_append(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.abort_manual_search_index_append(bigint, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.begin_manual_search_index_append(bigint, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.abort_manual_search_index_append(bigint, uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.manual_search_index_pending', 'SELECT')
     OR has_table_privilege('authenticated', 'public.manual_search_index_pending', 'SELECT')
     OR has_table_privilege('anon', 'public.manual_search_index_failures', 'SELECT')
     OR has_table_privilege('authenticated', 'public.manual_search_index_failures', 'SELECT') THEN
    RAISE EXCEPTION 'anon/authenticated can reach the catch-up objects';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.manuals_missing_search_index(integer, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_manual_search_index_failure(bigint, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_manual_search_index_attempt(bigint, text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.finish_manual_search_index_append(bigint, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.abort_manual_search_index_append(bigint, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.begin_manual_search_index_append(bigint, integer)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.manual_search_index_pending', 'DELETE')
     OR NOT has_function_privilege('authenticated', 'public.search_manual_catalog(text)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.manual_search_index_failures', 'DELETE') THEN
    RAISE EXCEPTION 'service_role is missing a grant';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.manual_search_index_failures'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.manual_search_index_pending'::regclass) THEN
    RAISE EXCEPTION 'RLS is off';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('manuals_missing_search_index', 'record_manual_search_index_failure', 'record_manual_search_index_attempt',
                        'begin_manual_search_index_append', 'append_manual_search_index_chunks', 'finish_manual_search_index_append',
                        'abort_manual_search_index_append', 'replace_manual_search_index', 'search_manual_catalog')
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
  IF (public.manuals_missing_search_index(5)->>'missing')::int <> 8 THEN
    RAISE EXCEPTION 'search_path shadowing changed the result';
  END IF;
  RAISE NOTICE 'search_path ok';
END $$;
RESET search_path;

-- Rollback removes everything, drops a partial write's rows, leaves complete
-- indexes alone and restores the 000913 function bodies.
DO $$
DECLARE tok uuid;
BEGIN
  tok := (public.begin_manual_search_index_append(14, 2)->>'token')::uuid;
  PERFORM public.append_manual_search_index_chunks(14, tok, 0, ARRAY['partial at rollback'], NULL, NULL);
END $$;
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup_rollback.sql
DO $$
BEGIN
  IF to_regclass('public.manual_search_index_failures') IS NOT NULL
     OR to_regprocedure('public.manuals_missing_search_index(integer, bigint)') IS NOT NULL
     OR to_regprocedure('public.manuals_missing_search_index(integer)') IS NOT NULL
     OR to_regprocedure('public.record_manual_search_index_attempt(bigint,text)') IS NOT NULL
     OR to_regprocedure('public.record_manual_search_index_failure(bigint,text)') IS NOT NULL
     OR to_regprocedure('public.begin_manual_search_index_append(bigint,integer)') IS NOT NULL
     OR to_regprocedure('public.abort_manual_search_index_append(bigint,uuid)') IS NOT NULL
     OR to_regclass('public.manual_search_index_pending') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left objects behind';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.search_manual_catalog(text)'::regprocedure) LIKE '%pending%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.replace_manual_search_index(bigint,text[],boolean[],integer[],text)'::regprocedure) LIKE '%pending%'
     OR NOT ((SELECT proconfig FROM pg_proc WHERE oid = 'public.search_manual_catalog(text)'::regprocedure) @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'rollback did not restore the 000913 bodies';
  END IF;
  IF EXISTS (SELECT 1 FROM public.manual_search_index WHERE manual_id = 14) THEN
    RAISE EXCEPTION 'rollback left a partial write visible';
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
