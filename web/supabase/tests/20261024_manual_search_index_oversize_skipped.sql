-- Local proof for 20261024_000944_manual_search_index_oversize_skipped.sql (PG17).
-- Empty scratch Postgres only (refuses when public.manuals exists). The
-- migration has its own BEGIN/COMMIT, so this file is not wrapped in one:
-- drop the scratch database afterwards.
--
--   createdb oversize_proof
--   psql "postgresql:///oversize_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261024_manual_search_index_oversize_skipped.sql
--   dropdb oversize_proof
--
-- Run psql from the repo root so the \i paths resolve. Fixture rows are the
-- 000918 proof's (11 = 25 MiB file, 12 = 24 MiB folder are oversized).

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

-- Drift guard refuses a body that is not 000918.
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'manuals_missing_search_index') <> '6175e1c20eeb81eecb2cb757add3478c' THEN
    RAISE EXCEPTION 'fixture 000918 body differs from prod';
  END IF;
END $$;

\i web/supabase/migrations/20261024_000944_manual_search_index_oversize_skipped.sql

DO $$
DECLARE r jsonb; n int;
BEGIN
  -- 1. Before any mark: identical to 000918 plus the two new keys at 0.
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 9, "eligible": 5, "oversized": 2, "oversized_ids": [11, 12],
            "oversize_skipped": 0, "oversize_skipped_ids": [],
            "unknown_size": 2, "unknown_size_ids": [13, 15],
            "no_file": 4, "no_file_ids": [3, 6, 9, 10], "in_progress": 0,
            "ids": [2, 5, 7, 8, 14]}'::jsonb THEN
    RAISE EXCEPTION '1 unexpected %', r;
  END IF;
  -- 2. Mark: exactly the two oversized manuals, nothing small/unknown/no-file.
  n := public.record_manual_search_index_oversize(20971520);
  IF n <> 2 THEN RAISE EXCEPTION '2 marked % rows', n; END IF;
  IF (SELECT array_agg(manual_id ORDER BY manual_id) FROM public.manual_search_index_failures) <> '{11,12}' THEN
    RAISE EXCEPTION '2 wrong rows';
  END IF;
  IF NOT (SELECT bool_and(starts_with(last_error, 'oversize_skipped: ') AND retry_after > now() + interval '23 hours')
          FROM public.manual_search_index_failures) THEN
    RAISE EXCEPTION '2 bad mark';
  END IF;
  IF (SELECT last_error FROM public.manual_search_index_failures WHERE manual_id = 11)
     <> 'oversize_skipped: 26214400 bytes > 20971520; index with scripts/index-missing-manuals.mjs --apply' THEN
    RAISE EXCEPTION '2 bad message';
  END IF;
  -- 3. Marked rows leave missing/oversized, show as oversize_skipped; rest unchanged.
  r := public.manuals_missing_search_index(5);
  IF r <> '{"missing": 7, "eligible": 5, "oversized": 0, "oversized_ids": [],
            "oversize_skipped": 2, "oversize_skipped_ids": [11, 12],
            "unknown_size": 2, "unknown_size_ids": [13, 15],
            "no_file": 4, "no_file_ids": [3, 6, 9, 10], "in_progress": 0,
            "ids": [2, 5, 7, 8, 14]}'::jsonb THEN
    RAISE EXCEPTION '3 unexpected %', r;
  END IF;
  -- 4. Not re-scanned: the sizes helper skips marked rows.
  IF EXISTS (SELECT 1 FROM public.manual_search_index_unindexed_sizes(true) WHERE id IN (11, 12)) THEN
    RAISE EXCEPTION '4 marked rows still scanned';
  END IF;
  IF (SELECT count(*) FROM public.manual_search_index_unindexed_sizes(false) WHERE id IN (11, 12)) <> 2 THEN
    RAISE EXCEPTION '4 unmarked scan lost rows';
  END IF;
  -- 5. Re-mark is idempotent (marked rows are skipped).
  n := public.record_manual_search_index_oversize(20971520);
  IF n <> 0 THEN RAISE EXCEPTION '5 re-mark wrote %', n; END IF;
  -- 6. Mark expires after 24 h: re-checked once and re-marked; attempts kept.
  UPDATE public.manual_search_index_failures SET retry_after = now() - interval '1 minute', attempts = 3 WHERE manual_id = 11;
  r := public.manuals_missing_search_index(5);
  IF r->'oversized_ids' <> '[11]'::jsonb OR r->'oversize_skipped_ids' <> '[12]'::jsonb THEN RAISE EXCEPTION '6 expiry %', r; END IF;
  n := public.record_manual_search_index_oversize(20971520);
  IF n <> 1 OR (SELECT attempts FROM public.manual_search_index_failures WHERE manual_id = 11) <> 3 THEN
    RAISE EXCEPTION '6 re-mark %', n;
  END IF;
  -- 7. Replaced by a small PDF after expiry: becomes eligible, not re-marked.
  UPDATE public.manual_search_index_failures SET retry_after = now() - interval '1 minute' WHERE manual_id = 11;
  UPDATE storage.objects SET metadata = '{"size": 5000}' WHERE name = 'shared/a/huge.pdf';
  IF public.record_manual_search_index_oversize(20971520) <> 0 THEN RAISE EXCEPTION '7 small file re-marked'; END IF;
  r := public.manuals_missing_search_index(50);
  IF NOT (r->'ids' @> '[11]'::jsonb) THEN RAISE EXCEPTION '7 not eligible %', r; END IF;
  -- 8. Indexed by the CLI: drops out of every count even with a live mark.
  INSERT INTO public.manual_search_index (manual_id, chunk_index, search_text) VALUES (12, 0, 'x');
  r := public.manuals_missing_search_index(50);
  IF (r->>'oversize_skipped')::int <> 0 OR r->'ids' @> '[12]'::jsonb THEN RAISE EXCEPTION '8 indexed still counted %', r; END IF;
  DELETE FROM public.manual_search_index WHERE manual_id = 12;
  UPDATE storage.objects SET metadata = '{"size": 26214400}' WHERE name = 'shared/a/huge.pdf';
  -- 9. In-progress (pending) oversize rows are never marked.
  DELETE FROM public.manual_search_index_failures;
  INSERT INTO public.manual_search_index_pending (manual_id, token, total_chunks) VALUES (11, gen_random_uuid(), 3);
  IF public.record_manual_search_index_oversize(20971520) <> 1 THEN RAISE EXCEPTION '9 pending marked'; END IF;
  DELETE FROM public.manual_search_index_pending;
  -- 10. Cap is a parameter (24.5 MiB: only the 25 MiB file).
  DELETE FROM public.manual_search_index_failures;
  IF public.record_manual_search_index_oversize(25690112) <> 1 THEN RAISE EXCEPTION '10 cap'; END IF;
  DELETE FROM public.manual_search_index_failures;
END $$;

-- 11. Grants: service_role only.
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.record_manual_search_index_oversize(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_manual_search_index_oversize(bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.manual_search_index_unindexed_sizes(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.manual_search_index_unindexed_sizes(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.manuals_missing_search_index(integer,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_manual_search_index_oversize(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.manuals_missing_search_index(integer,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '11 grants wrong';
  END IF;
  IF (SELECT bool_or(prosecdef IS NOT TRUE OR NOT (proconfig @> ARRAY['search_path=""']))
        FROM pg_proc WHERE proname IN ('record_manual_search_index_oversize', 'manual_search_index_unindexed_sizes', 'manuals_missing_search_index')) THEN
    RAISE EXCEPTION '11 not SECURITY DEFINER with empty search_path';
  END IF;
END $$;

-- 12. Re-applying is refused by the drift guard (not silently re-run).
\set ON_ERROR_STOP off
\i web/supabase/migrations/20261024_000944_manual_search_index_oversize_skipped.sql
\set ON_ERROR_STOP on
ROLLBACK;

-- 13. Rollback restores the exact 000918 body and removes the marks only.
SELECT public.record_manual_search_index_oversize(20971520);
INSERT INTO public.manual_search_index_failures (manual_id, last_error) VALUES (2, 'real failure');
\i web/supabase/migrations/20261024_000944_manual_search_index_oversize_skipped_rollback.sql
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'manuals_missing_search_index') <> '6175e1c20eeb81eecb2cb757add3478c'
     OR to_regprocedure('public.record_manual_search_index_oversize(bigint)') IS NOT NULL
     OR to_regprocedure('public.manual_search_index_unindexed_sizes(boolean)') IS NOT NULL
     OR (SELECT array_agg(manual_id) FROM public.manual_search_index_failures) <> '{2}' THEN
    RAISE EXCEPTION '13 rollback incomplete';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.manuals_missing_search_index(integer,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.manuals_missing_search_index(integer,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION '13 grants changed';
  END IF;
END $$;
-- 14. Rollback re-run is safe; re-apply after rollback works.
\i web/supabase/migrations/20261024_000944_manual_search_index_oversize_skipped_rollback.sql
\i web/supabase/migrations/20261024_000944_manual_search_index_oversize_skipped.sql
DELETE FROM public.manual_search_index_failures;
\echo 000944 proof: all checks passed
