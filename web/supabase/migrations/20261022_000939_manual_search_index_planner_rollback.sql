-- Rollback for 000939: drops manual_search_index_ids() and restores the GIN
-- index to its default (fastupdate on, no reloption), exactly as before.
-- Safe to re-run. Deploy-order note: the web code falls back to the REST
-- query when the function is missing, so this rollback needs no code revert.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.idx_manual_search_index_tsv') IS NULL THEN
    RAISE EXCEPTION '000939 rollback drift: idx_manual_search_index_tsv is missing';
  END IF;
  IF to_regprocedure('public.manual_search_index_ids(text,boolean,text[])') IS NOT NULL
     AND coalesce(obj_description(to_regprocedure('public.manual_search_index_ids(text,boolean,text[])'), 'pg_proc'), '') NOT LIKE '000939:%' THEN
    RAISE EXCEPTION '000939 rollback drift: manual_search_index_ids is not the 000939 function; refusing';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.manual_search_index_ids(text, boolean, text[]);
ALTER INDEX public.idx_manual_search_index_tsv RESET (fastupdate);

COMMIT;
