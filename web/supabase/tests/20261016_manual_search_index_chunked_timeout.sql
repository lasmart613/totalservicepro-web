-- Local proof: a dense 2M+ character manual written through the chunked
-- path under the REST role's 8 s statement_timeout (prod: authenticator
-- has statement_timeout=8s). Empty throwaway Postgres only; refuses to run
-- when public.manuals exists. Not a transaction: a statement timeout must
-- cancel only its own statement, as it does over PostgREST.
--
--   createdb chunk_proof
--   psql "postgresql:///chunk_proof" -f web/supabase/tests/20261016_manual_search_index_chunked_timeout.sql
--
-- Run psql from the repo root so the \i paths resolve. Prints \timing for
-- each call. The final DO block fails unless the manual is complete.

\set ON_ERROR_STOP on
\timing on

DO $$
BEGIN
  IF to_regclass('public.manuals') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.manuals already exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA storage;
CREATE TABLE storage.objects (
  id bigserial PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL, metadata jsonb,
  archived_at timestamptz, is_delete_marker boolean NOT NULL DEFAULT false
);
CREATE TABLE public.manuals (
  id bigint PRIMARY KEY, storage_path text, entry_file_path text,
  is_folder boolean NOT NULL DEFAULT false, published boolean NOT NULL DEFAULT true
);
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
\i web/supabase/tests/fixtures/000913_functions.sql
BEGIN;
\i web/supabase/migrations/20261016_000918_manual_search_index_catchup.sql
COMMIT;

INSERT INTO public.manuals (id, storage_path) VALUES (1195, 'a.pdf'), (1210, 'b.pdf');

-- 640 pages of service-manual-like text: words from a 15k vocabulary, part
-- numbers and readings, ~3,900 characters a page, [[pdfpage:N]] stamps.
CREATE TEMP TABLE pages AS
SELECT p AS page,
       '[[pdfpage:' || p || ']] ' || string_agg(
         CASE w % 7
           WHEN 0 THEN 'PN' || (abs(hashtext(p || ':' || w)) % 40000)::text || '-' || lpad((abs(hashtext(w || ':' || p)) % 100)::text, 2, '0')
           WHEN 1 THEN ((abs(hashtext((p * 31 + w)::text)) % 100000)::numeric / 100)::text || 'V'
           ELSE 'w' || (abs(hashtext((p * 977 + w)::text)) % 15000)::text || CASE WHEN w % 3 = 0 THEN 'ing' ELSE 'er' END
         END, ' ' ORDER BY w) AS text
FROM generate_series(1, 640) AS p, generate_series(1, 420) AS w
GROUP BY p;

-- ~200,000-character chunks on page boundaries (what the script sends).
CREATE TEMP TABLE chunks AS
WITH sized AS (
  SELECT page, text, sum(length(text) + 1) OVER (ORDER BY page) AS running FROM pages
)
SELECT (running / 200000)::int AS chunk, string_agg(text, E'\f' ORDER BY page) AS text, max(page) AS page_max
FROM sized GROUP BY 1;

SELECT sum(length(text)) AS total_chars, count(*) AS chunks, max(length(text)) AS largest_chunk FROM chunks;

-- From here on every statement runs under the REST role's limit.
SET statement_timeout = '8s';

-- Old path, for comparison: the whole manual in one replace call, split at
-- 1,500,000 characters like PDF_INDEX_TEXT_MAX. Allowed to fail.
\set ON_ERROR_STOP off
SELECT public.replace_manual_search_index(
  1210,
  ARRAY[(SELECT string_agg(text, E'\f' ORDER BY page) FROM pages WHERE page <= 400),
        (SELECT string_agg(text, E'\f' ORDER BY page) FROM pages WHERE page > 400)],
  ARRAY[false, false], ARRAY[400, 640], NULL) AS old_single_call;
\set ON_ERROR_STOP on

-- New path: begin, one append per chunk (each its own statement), finish.
SELECT (public.begin_manual_search_index_append(1195, (SELECT count(*)::int FROM chunks))->>'token') AS token \gset
SELECT format(
  'SELECT %s AS chunk, public.append_manual_search_index_chunks(1195, %L::uuid, %s, ARRAY[%L], ARRAY[false], ARRAY[%s]) AS appended',
  chunk, :'token', row_number() OVER (ORDER BY chunk) - 1, text, page_max)
FROM chunks ORDER BY chunk \gexec
SELECT public.finish_manual_search_index_append(1195, :'token'::uuid) AS finished;

RESET statement_timeout;
DO $$
DECLARE n int; chars bigint;
BEGIN
  SELECT count(*), sum(length(search_text)) INTO n, chars FROM public.manual_search_index WHERE manual_id = 1195;
  IF n <> (SELECT count(*) FROM chunks) OR chars < 2000000
     OR EXISTS (SELECT 1 FROM public.manual_search_index_pending WHERE manual_id = 1195)
     OR NOT EXISTS (SELECT 1 FROM public.search_manual_catalog('w1234er') WHERE manual_id = 1195 UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM pages WHERE text LIKE '% w1234er %')) THEN
    RAISE EXCEPTION 'chunked write incomplete: % rows, % chars', n, chars;
  END IF;
  RAISE NOTICE 'chunked write ok under 8 s per statement: % rows, % chars', n, chars;
END $$;
SELECT manual_id, count(*) AS rows, sum(length(search_text)) AS chars FROM public.manual_search_index GROUP BY 1 ORDER BY 1;
