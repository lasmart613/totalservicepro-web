-- Local proof for 20261011_000912_manual_search_index_clip.sql.
-- Empty Postgres only. Refuses to run when public.manuals already exists.
-- The body is one transaction and ends in ROLLBACK. It does not write a
-- database that outlives this session.
--
--   psql "postgresql:///clip_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261011_manual_search_index_clip.sql
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

INSERT INTO public.manuals (id) VALUES (1), (9), (73), (58), (27), (99);

CREATE TABLE public.manual_search_index (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  search_text text NOT NULL DEFAULT '',
  indexed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.manual_search_index (manual_id, search_text)
SELECT 1, repeat('a', 1500000 - char_length(stamp)) || stamp
FROM (SELECT '[[pdfpage:1018]]'::text AS stamp) AS s
UNION ALL
SELECT 73, repeat('b', 1499994 - char_length(stamp)) || stamp
FROM (SELECT '[[pdfpage:1090]]'::text AS stamp) AS s
UNION ALL
SELECT 58, repeat('c', 200000) || '[[pdfpage:700]]'
UNION ALL
SELECT 27, '[[pdfpage:1]] cover' || E'\f[[pdfpage:273]] end'
UNION ALL
SELECT 99, 'no stamps here';

\i web/supabase/migrations/20261011_000912_manual_search_index_clip.sql

DO $$
DECLARE
  clipped boolean;
  max_page integer;
  chars integer;
BEGIN
  SELECT index_clipped, indexed_page_max, char_length(search_text)
    INTO clipped, max_page, chars
  FROM public.manual_search_index WHERE manual_id = 1;
  IF chars <> 1500000 OR clipped IS NOT TRUE OR max_page <> 1018 THEN
    RAISE EXCEPTION 'manual 1 expected clipped 1500000/1018, got % % %', chars, clipped, max_page;
  END IF;

  SELECT index_clipped, indexed_page_max, char_length(search_text)
    INTO clipped, max_page, chars
  FROM public.manual_search_index WHERE manual_id = 73;
  IF chars <> 1499994 OR clipped IS NOT TRUE OR max_page <> 1090 THEN
    RAISE EXCEPTION 'manual 73 expected clipped 1499994/1090, got % % %', chars, clipped, max_page;
  END IF;

  SELECT index_clipped, indexed_page_max
    INTO clipped, max_page
  FROM public.manual_search_index WHERE manual_id = 58;
  IF clipped IS NOT FALSE OR max_page <> 700 THEN
    RAISE EXCEPTION 'manual 58 expected unclipped max 700, got % %', clipped, max_page;
  END IF;

  SELECT index_clipped, indexed_page_max
    INTO clipped, max_page
  FROM public.manual_search_index WHERE manual_id = 27;
  IF clipped IS NOT FALSE OR max_page <> 273 THEN
    RAISE EXCEPTION 'manual 27 expected unclipped max 273, got % %', clipped, max_page;
  END IF;

  SELECT index_clipped, indexed_page_max
    INTO clipped, max_page
  FROM public.manual_search_index WHERE manual_id = 99;
  IF clipped IS NOT FALSE OR max_page IS NOT NULL THEN
    RAISE EXCEPTION 'manual 99 expected unclipped null max, got % %', clipped, max_page;
  END IF;
END $$;

-- A second apply must not replace an indexer-written max.
UPDATE public.manual_search_index
SET search_text = '[[pdfpage:5]] replaced'
WHERE manual_id = 27;

\i web/supabase/migrations/20261011_000912_manual_search_index_clip.sql

DO $$
DECLARE
  max_page integer;
BEGIN
  SELECT indexed_page_max INTO max_page
  FROM public.manual_search_index WHERE manual_id = 27;
  IF max_page <> 273 THEN
    RAISE EXCEPTION 're-run replaced indexed_page_max, got %', max_page;
  END IF;

  BEGIN
    INSERT INTO public.manual_search_index (manual_id, search_text, indexed_page_max)
    VALUES (9, 'x', 0);
    RAISE EXCEPTION 'indexed_page_max 0 was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;
END $$;

\i web/supabase/migrations/20261011_000912_manual_search_index_clip_rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manual_search_index'
      AND column_name IN ('index_clipped', 'indexed_page_max')
  ) THEN
    RAISE EXCEPTION 'rollback left a clip column';
  END IF;
END $$;

ROLLBACK;
