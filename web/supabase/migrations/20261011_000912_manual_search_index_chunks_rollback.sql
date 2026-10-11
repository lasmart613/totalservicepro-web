-- Rollback for 20261011_000912_manual_search_index_chunks.sql.
-- Deletes chunk_index > 0 (the text past the first 1,500,000 characters)
-- and restores the one-row primary key. Chunk 0 is kept.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

DO $drop_chunks$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manual_search_index'
      AND column_name = 'chunk_index'
  ) THEN
    DELETE FROM public.manual_search_index WHERE chunk_index > 0;
  END IF;
END
$drop_chunks$;

DROP FUNCTION IF EXISTS public.replace_manual_search_index(bigint, text[], boolean[], integer[], text);

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_pkey;

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_chunk_index_check;

ALTER TABLE public.manual_search_index
  DROP COLUMN IF EXISTS chunk_index;

ALTER TABLE public.manual_search_index
  ADD CONSTRAINT manual_search_index_pkey PRIMARY KEY (manual_id);

CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.manual_id
  FROM public.manual_search_index i
  WHERE nullif(btrim(q), '') IS NOT NULL
    AND char_length(btrim(q)) >= 2
    AND (
      i.search_tsv @@ plainto_tsquery('simple', q)
      OR i.search_text ILIKE '%' || replace(replace(btrim(q), '%', ''), '_', '') || '%'
    );
$$;

COMMENT ON FUNCTION public.search_manual_catalog(text) IS
  'Returns catalog ids (bigint) whose indexed PDF body matches q. Does not return search_text. Does not filter by ownership.';

NOTIFY pgrst, 'reload schema';
