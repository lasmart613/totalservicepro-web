-- Rollback for 20261016_000918_manual_search_index_catchup.sql.
-- Disable the Netlify scheduled function first (or deploy the app without
-- web/netlify/functions/manual-index-catchup.mts). With the functions gone it
-- only logs an error and writes nothing, so the order is not critical.
-- Stop any index-missing-manuals.mjs --apply run first: a chunked write in
-- progress would lose its marker and its partial rows would look indexed.
-- To be safe this rollback deletes the rows of any manual that still has a
-- marker (partial writes only; complete indexes have no marker).
--
-- search_manual_catalog and replace_manual_search_index go back to their
-- 000913 bodies (copied verbatim) before the marker table is dropped.

SET LOCAL lock_timeout = '5s';

DO $partial$
BEGIN
  IF to_regclass('public.manual_search_index_pending') IS NOT NULL THEN
    DELETE FROM public.manual_search_index AS i
    USING public.manual_search_index_pending AS p
    WHERE p.manual_id = i.manual_id;
  END IF;
END
$partial$;

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

DROP FUNCTION IF EXISTS public.abort_manual_search_index_append(bigint, uuid);
DROP FUNCTION IF EXISTS public.finish_manual_search_index_append(bigint, uuid);
DROP FUNCTION IF EXISTS public.append_manual_search_index_chunks(bigint, uuid, integer, text[], boolean[], integer[]);
DROP FUNCTION IF EXISTS public.begin_manual_search_index_append(bigint, integer);
DROP FUNCTION IF EXISTS public.record_manual_search_index_failure(bigint, text);
DROP FUNCTION IF EXISTS public.record_manual_search_index_attempt(bigint, text);
DROP FUNCTION IF EXISTS public.manuals_missing_search_index(integer, bigint);
DROP FUNCTION IF EXISTS public.manuals_missing_search_index(integer);
DROP TABLE IF EXISTS public.manual_search_index_pending;
DROP TABLE IF EXISTS public.manual_search_index_failures;

NOTIFY pgrst, 'reload schema';
