-- 000939: Manual search index - stop the 8 s statement timeouts (Oct 22 Stats).
--
-- B-1  GET /rest/v1/manual_search_index?search_tsv=plfts(simple).<term> returned
--      500 (PostgREST 57014) 8x from 2:49 to 4:12 PM MST on Oct 22. The heap is
--      416 kB (2,663 rows) but the search_tsv/search_text values live in 300 MB
--      of TOAST, which the planner does not cost. After the 1:16 PM MST
--      autoanalyze it chose a Seq Scan (cost 85) over the GIN index: EXPLAIN
--      ANALYZE for 'cyno' took 17,206 ms seq vs 110 ms through
--      idx_manual_search_index_tsv. public.manual_search_index_ids() runs the
--      body search with enable_seqscan = off (function-local), so the GIN index
--      is always used. Optional regex patterns (the part-number imatch filters)
--      are applied only to rows the tsquery already matched.
-- B-2  append_manual_search_index_chunks hit 57014 4x (8:31-11:45 AM MST), one
--      with a 10.9 kB payload, so the cost is not the chunk itself: with GIN
--      fastupdate on (default, 4 MB gin_pending_list_limit), the insert that
--      overflows the pending list merges the whole list into the 73 MB index
--      inside its own 8 s budget. fastupdate = off makes every append pay only
--      for its own entries. The pending list is merged once here.
--
-- What changes: one storage parameter on idx_manual_search_index_tsv and one
-- new function. Table, RLS, policies and grants on manual_search_index are
-- untouched. EXECUTE on the new function: service_role only (the library
-- search route uses the service client). SECURITY DEFINER, search_path ''.
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261022_000939_manual_search_index_planner_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.manual_search_index') IS NULL THEN
    RAISE EXCEPTION '000939 drift: public.manual_search_index is missing';
  END IF;
  IF to_regclass('public.idx_manual_search_index_tsv') IS NULL THEN
    RAISE EXCEPTION '000939 drift: idx_manual_search_index_tsv is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid JOIN pg_am a ON a.oid = c.relam
     WHERE x.indexrelid = 'public.idx_manual_search_index_tsv'::regclass
       AND x.indrelid = 'public.manual_search_index'::regclass AND a.amname = 'gin'
  ) THEN
    RAISE EXCEPTION '000939 drift: idx_manual_search_index_tsv is not a GIN index on manual_search_index';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c, unnest(coalesce(c.reloptions, '{}')) o
     WHERE c.oid = 'public.idx_manual_search_index_tsv'::regclass AND o LIKE 'fastupdate=%'
  ) THEN
    RAISE EXCEPTION '000939 drift: idx_manual_search_index_tsv already has a fastupdate setting; refusing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'manual_search_index' AND column_name = 'search_tsv' AND data_type = 'tsvector')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'manual_search_index' AND column_name = 'search_text' AND data_type = 'text') THEN
    RAISE EXCEPTION '000939 drift: manual_search_index.search_tsv/search_text not as expected';
  END IF;
  IF to_regprocedure('public.manual_search_index_ids(text,boolean,text[])') IS NOT NULL THEN
    RAISE EXCEPTION '000939 drift: manual_search_index_ids already exists; refusing';
  END IF;
END $$;

ALTER INDEX public.idx_manual_search_index_tsv SET (fastupdate = off);
SELECT pg_catalog.gin_clean_pending_list('public.idx_manual_search_index_tsv'::regclass);

CREATE FUNCTION public.manual_search_index_ids(
  p_query text,
  p_plain boolean DEFAULT true,
  p_patterns text[] DEFAULT NULL
)
RETURNS SETOF bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET enable_seqscan = off
AS $$
  SELECT DISTINCT i.manual_id
    FROM public.manual_search_index AS i
   WHERE length(coalesce(p_query, '')) BETWEEN 1 AND 200
     AND coalesce(cardinality(p_patterns), 0) <= 8
     AND i.search_tsv @@ (CASE WHEN p_plain
                               THEN pg_catalog.plainto_tsquery('simple'::regconfig, p_query)
                               ELSE pg_catalog.to_tsquery('simple'::regconfig, p_query) END)
     AND (p_patterns IS NULL
          OR NOT EXISTS (SELECT 1 FROM unnest(p_patterns) AS p(re)
                          WHERE NOT (i.search_text OPERATOR(pg_catalog.~*) p.re)))
   LIMIT 5000
$$;
COMMENT ON FUNCTION public.manual_search_index_ids(text, boolean, text[]) IS
  '000939: manual ids whose search_tsv matches (plainto_tsquery when p_plain, else to_tsquery; simple config), optionally also matching every regex in p_patterns (case-insensitive). enable_seqscan=off forces the GIN index (seq scan detoasts 300 MB).';

REVOKE ALL ON FUNCTION public.manual_search_index_ids(text, boolean, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_search_index_ids(text, boolean, text[]) TO service_role;

COMMIT;
