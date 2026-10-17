-- Copied verbatim from 20261011_000913_manual_search_index_chunks.sql (the
-- live prod bodies, checked read-only on Oct 16, 2026). Test fixture only.
CREATE OR REPLACE FUNCTION public.search_manual_catalog(q text)
RETURNS TABLE(manual_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT i.manual_id
  FROM public.manual_search_index i
  JOIN public.manuals m ON m.id = i.manual_id
  WHERE m.published = true
    AND nullif(btrim(q), '') IS NOT NULL
    AND char_length(btrim(q)) >= 2
    AND (
      i.search_tsv @@ plainto_tsquery('simple', q)
      OR i.search_text ILIKE '%' || replace(replace(btrim(q), '%', ''), '_', '') || '%'
    );
$$;

CREATE OR REPLACE FUNCTION public.replace_manual_search_index(
  p_manual_id bigint,
  p_chunks text[],
  p_clipped boolean[],
  p_page_max integer[],
  p_expected_md5 text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_md5 text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(p_manual_id);

  IF p_chunks IS NULL THEN
    RAISE EXCEPTION 'replace_manual_search_index requires p_chunks';
  END IF;

  SELECT md5(string_agg(i.search_text, E'\f' ORDER BY i.chunk_index))
  INTO current_md5
  FROM public.manual_search_index AS i
  WHERE i.manual_id = p_manual_id;

  IF current_md5 IS DISTINCT FROM p_expected_md5 THEN
    RETURN false;
  END IF;

  DELETE FROM public.manual_search_index WHERE manual_id = p_manual_id;

  INSERT INTO public.manual_search_index (
    manual_id,
    chunk_index,
    search_text,
    index_clipped,
    indexed_page_max,
    indexed_at
  )
  SELECT
    p_manual_id,
    gs.i - 1,
    p_chunks[gs.i],
    COALESCE(p_clipped[gs.i], false),
    p_page_max[gs.i],
    now()
  FROM generate_subscripts(p_chunks, 1) AS gs(i);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.search_manual_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_manual_catalog(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) TO service_role;
