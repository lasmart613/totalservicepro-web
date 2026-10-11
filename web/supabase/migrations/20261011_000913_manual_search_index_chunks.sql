-- Store a long manual index as several rows instead of slicing it at
-- 1,500,000 characters.
--
-- manual_search_index was one row per manual (primary key manual_id).
-- search_tsv is a generated tsvector, and a tsvector cannot exceed
-- 1,048,575 bytes. The densest live row is manual 24: 680,306 bytes of
-- tsvector for 1,335,422 characters. A single row much past 1,500,000
-- characters of that density can fail the generated column. Each chunk
-- stays at the existing cap, split on a [[pdfpage:N]] boundary, so every
-- chunk stays in the range already proven in production. The grok-assistant
-- isolate can hold the joined text (a few megabytes). The tsvector limit
-- is why this does not raise the cap.
--
-- [[pdfpage:N]] is not renumbered. Chunk 0 holds the earlier pages, later
-- chunks continue the same stamps. search_manual_catalog keeps the live
-- published filter and returns each manual once. A multi-word match is
-- only within one chunk.
--
-- replace_manual_search_index is the only writer that swaps every chunk.
-- It takes a transaction advisory lock, compares md5 of the joined chunks
-- to p_expected_md5, and refuses the write when they differ. Empty storage
-- is md5 NULL on both sides. SECURITY DEFINER so the write bypasses RLS.
-- search_path is empty and every table reference is schema-qualified.
-- EXECUTE is service_role only.
--
-- Apply 20261011_000912_manual_search_index_clip.sql first. That file
-- adds index_clipped and indexed_page_max. 20261011_000911_manuals_published.sql
-- is already applied and is a different change.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
-- Do not apply from the app deploy.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.manual_search_index
  ADD COLUMN IF NOT EXISTS chunk_index integer NOT NULL DEFAULT 0;

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_chunk_index_check;

ALTER TABLE public.manual_search_index
  ADD CONSTRAINT manual_search_index_chunk_index_check
  CHECK (chunk_index >= 0 AND chunk_index < 100);

COMMENT ON COLUMN public.manual_search_index.chunk_index IS
  '0-based page-boundary slice of one manual. Stamps [[pdfpage:N]] continue across chunks. Each search_text stays within the 1,500,000-character cap.';

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_pkey;

ALTER TABLE public.manual_search_index
  ADD CONSTRAINT manual_search_index_pkey PRIMARY KEY (manual_id, chunk_index);

-- Live body from search_manual_catalog after 000911, plus SELECT DISTINCT
-- so several chunk rows for one manual return one id. The published join
-- stays. A multi-word query matches only inside a single chunk.
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

COMMENT ON FUNCTION public.search_manual_catalog(text) IS
  'Returns catalog ids (bigint) whose indexed PDF body matches q and whose manual is published. One id per manual when the index is stored in several chunks. Does not return search_text. Does not filter by ownership.';

-- SECURITY DEFINER bypasses RLS. An empty search_path stops a caller from
-- shadowing public. Tables are schema-qualified. extract, coalesce, md5,
-- and now stay unqualified. Qualifying extract fails at CREATE (42601)
-- and qualifying coalesce fails at the first call (42883).
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

COMMENT ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) IS
  'Replace every search chunk for one manual. Refuses when md5 of the joined chunks differs from p_expected_md5. Null md5 matches an empty index. service_role only.';

REVOKE ALL ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.replace_manual_search_index(bigint, text[], boolean[], integer[], text) TO service_role';
  END IF;
END
$grant$;

NOTIFY pgrst, 'reload schema';
