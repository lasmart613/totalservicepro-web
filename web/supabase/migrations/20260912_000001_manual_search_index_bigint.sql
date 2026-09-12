-- Follow-up to 20260912_000000_manual_search_index.sql (PR #95).
-- That migration used uuid and failed on live Supabase:
--   ERROR 42804: foreign key constraint "manual_search_index_manual_id_fkey"
--   cannot be implemented
--   DETAIL: Key columns "manual_id" and "id" are of incompatible types: uuid and bigint
-- Live public.manuals.id is bigint. Drop/recreate the index table + RPC to match.

DROP FUNCTION IF EXISTS public.search_manual_catalog(text);

DROP TABLE IF EXISTS public.manual_search_index;

CREATE TABLE public.manual_search_index (
  manual_id bigint PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
  search_text text NOT NULL DEFAULT '',
  indexed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_search_index
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_manual_search_index_tsv
  ON public.manual_search_index
  USING gin (search_tsv);

COMMENT ON TABLE public.manual_search_index IS
  'Extracted PDF text for library search. Not selectable by authenticated clients. Reindex via God /api/god/manuals/reindex.';

COMMENT ON COLUMN public.manual_search_index.search_text IS
  'Extracted body text (capped in app). Used for FTS; never returned by the library search API.';

COMMENT ON COLUMN public.manual_search_index.manual_id IS
  'FK to public.manuals.id (bigint / int8). Not uuid.';

ALTER TABLE public.manual_search_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to manual search index" ON public.manual_search_index;

-- Authenticated clients have no policy → cannot SELECT search_text.
-- Service role (indexer + search API) bypasses RLS.

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

REVOKE ALL ON FUNCTION public.search_manual_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_manual_catalog(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_manual_catalog(text) TO service_role;

COMMENT ON FUNCTION public.search_manual_catalog(text) IS
  'Returns catalog ids (bigint) whose indexed PDF body matches q. Does not return search_text. Does not filter by ownership.';

NOTIFY pgrst, 'reload schema';
