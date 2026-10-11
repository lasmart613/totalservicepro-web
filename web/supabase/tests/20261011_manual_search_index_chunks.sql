-- Local proof for 20261011_000913_manual_search_index_chunks.sql.
-- Empty Postgres only. Refuses to run when public.manuals already exists.
-- The body is one transaction and ends in ROLLBACK. It does not write a
-- database that outlives this session.
--
--   psql "postgresql:///chunk_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261011_manual_search_index_chunks.sql
--
-- Run psql from the repo root so the \i paths resolve.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.manuals') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.manuals already exists';
  END IF;
  IF to_regclass('public.manual_search_index') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.manual_search_index already exists';
  END IF;
END $$;

BEGIN;

CREATE TABLE public.manuals (
  id bigint PRIMARY KEY
);

INSERT INTO public.manuals (id) VALUES (1), (72), (99);

CREATE TABLE public.manual_search_index (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  search_text text NOT NULL DEFAULT '',
  indexed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_search_index
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED;

INSERT INTO public.manual_search_index (manual_id, search_text) VALUES
  (1, '[[pdfpage:2]] alpha'),
  (72, '[[pdfpage:517]] kept');

\i web/supabase/migrations/20261011_000912_manual_search_index_clip.sql
\i web/supabase/migrations/20261011_000913_manual_search_index_chunks.sql

DO $$
BEGIN
  IF md5('hello' || E'\f' || 'world') IS DISTINCT FROM 'e972eba4a90b22a9136ab76a45c3b38b' THEN
    RAISE EXCEPTION 'postgres md5 of joined chunks does not match node utf8 md5';
  END IF;

  IF (
    SELECT count(*) FROM public.manual_search_index WHERE manual_id = 1 AND chunk_index = 0
  ) <> 1 THEN
    RAISE EXCEPTION 'existing row was not kept as chunk 0';
  END IF;

  IF public.replace_manual_search_index(
    1,
    ARRAY['[[pdfpage:1]] nope'],
    ARRAY[false],
    ARRAY[1],
    'deadbeef'
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'wrong md5 was accepted';
  END IF;

  IF (SELECT search_text FROM public.manual_search_index WHERE manual_id = 1) IS DISTINCT FROM '[[pdfpage:2]] alpha' THEN
    RAISE EXCEPTION 'wrong md5 changed the row';
  END IF;

  IF public.replace_manual_search_index(
    1,
    ARRAY['[[pdfpage:1]] alpha', '[[pdfpage:3]] alpha omega'],
    ARRAY[false, false],
    ARRAY[1, 3],
    md5('[[pdfpage:2]] alpha')
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'matching md5 was refused';
  END IF;

  IF (SELECT count(*) FROM public.manual_search_index WHERE manual_id = 1) <> 2 THEN
    RAISE EXCEPTION 'expected two chunks';
  END IF;

  IF (
    SELECT md5(string_agg(search_text, E'\f' ORDER BY chunk_index))
    FROM public.manual_search_index
    WHERE manual_id = 1
  ) IS DISTINCT FROM md5('[[pdfpage:1]] alpha' || E'\f' || '[[pdfpage:3]] alpha omega') THEN
    RAISE EXCEPTION 'joined chunk md5 drifted';
  END IF;

  IF (
    SELECT max(indexed_page_max) FROM public.manual_search_index WHERE manual_id = 1
  ) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'indexed_page_max did not keep the later stamp';
  END IF;

  IF (
    SELECT bool_or(index_clipped) FROM public.manual_search_index WHERE manual_id = 1
  ) THEN
    RAISE EXCEPTION 'uncut chunks were marked clipped';
  END IF;

  IF (SELECT count(*) FROM public.search_manual_catalog('alpha')) <> 1 THEN
    RAISE EXCEPTION 'catalog search returned duplicate manual ids';
  END IF;

  IF public.replace_manual_search_index(
    1,
    ARRAY['[[pdfpage:1]] stale'],
    ARRAY[false],
    ARRAY[1],
    md5('[[pdfpage:2]] alpha')
  ) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'stale md5 replaced the chunks';
  END IF;

  IF (SELECT count(*) FROM public.manual_search_index WHERE manual_id = 1) <> 2 THEN
    RAISE EXCEPTION 'stale md5 deleted chunks';
  END IF;

  IF public.replace_manual_search_index(
    99,
    ARRAY['[[pdfpage:1]] fresh'],
    ARRAY[false],
    ARRAY[1],
    NULL
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'null md5 did not match an empty index';
  END IF;
END $$;

DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('public.replace_manual_search_index(bigint, text[], boolean[], integer[], text)'::regprocedure);
  IF def NOT LIKE '%set_config(''lock_timeout'', ''5s'', true)%' THEN
    RAISE EXCEPTION 'replace function missing lock_timeout';
  END IF;
  IF def NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'replace function missing advisory lock';
  END IF;
  IF def LIKE '%COMMIT%' THEN
    RAISE EXCEPTION 'replace function must not commit';
  END IF;
  IF pg_get_functiondef('public.search_manual_catalog(text)'::regprocedure) NOT LIKE '%SELECT DISTINCT%' THEN
    RAISE EXCEPTION 'catalog search is not distinct';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.replace_manual_search_index(
      72,
      ARRAY['[[pdfpage:1]] bad'],
      ARRAY[false],
      ARRAY[0],
      (SELECT md5(search_text) FROM public.manual_search_index WHERE manual_id = 72)
    );
    RAISE EXCEPTION 'indexed_page_max 0 was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;

\i web/supabase/migrations/20261011_000913_manual_search_index_chunks.sql

\i web/supabase/migrations/20261011_000913_manual_search_index_chunks_rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manual_search_index'
      AND column_name = 'chunk_index'
  ) THEN
    RAISE EXCEPTION 'rollback left chunk_index';
  END IF;

  IF to_regprocedure('public.replace_manual_search_index(bigint, text[], boolean[], integer[], text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left replace_manual_search_index';
  END IF;

  IF (SELECT count(*) FROM public.manual_search_index WHERE manual_id = 1) <> 1 THEN
    RAISE EXCEPTION 'rollback did not leave a single chunk 0 row';
  END IF;

  IF (SELECT search_text FROM public.manual_search_index WHERE manual_id = 1) IS DISTINCT FROM '[[pdfpage:1]] alpha' THEN
    RAISE EXCEPTION 'rollback kept a later chunk instead of chunk 0';
  END IF;

  IF pg_get_functiondef('public.search_manual_catalog(text)'::regprocedure) LIKE '%SELECT DISTINCT%' THEN
    RAISE EXCEPTION 'rollback left DISTINCT in catalog search';
  END IF;

  IF (
    SELECT string_agg(a.attname, ',' ORDER BY k.ord)
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = 'public.manual_search_index'::regclass
      AND c.contype = 'p'
  ) IS DISTINCT FROM 'manual_id' THEN
    RAISE EXCEPTION 'primary key was not restored to manual_id';
  END IF;
END $$;

ROLLBACK;
