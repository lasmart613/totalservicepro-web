-- Full-text index for service-manual PDF bodies (library search box).
-- Apply in the Supabase SQL editor if you are not running `supabase db push`.
-- search_text is NOT on public.manuals so select('*') in the library UI
-- cannot download every PDF body. RLS: no client policies (service role / RPC only).
-- Backfill: God → Manuals catalog → "Index PDF text", or POST /api/god/manuals/reindex.

CREATE TABLE IF NOT EXISTS public.manual_search_index (
  manual_id uuid PRIMARY KEY REFERENCES public.manuals(id) ON DELETE CASCADE,
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

ALTER TABLE public.manual_search_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No client access to manual search index" ON public.manual_search_index;

-- Authenticated clients have no policy → cannot SELECT search_text.
-- Service role (indexer + search API) bypasses RLS.

CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id uuid)
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
  'Returns catalog ids whose indexed PDF body matches q. Does not return search_text. Does not filter by ownership.';

NOTIFY pgrst, 'reload schema';
