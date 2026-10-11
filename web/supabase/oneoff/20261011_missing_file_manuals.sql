-- One-off cleanup. Not a migration and not applied by the app.
-- Removes the three unpublished duplicate rows for
-- "Quanta System Litho EVO User Manual DGM001435" (764, 765, 801). Their file
-- shared/quanta-system/litho-evo/DGM001435.pdf is not in storage, they have no
-- user or organization links, and each has one empty index row. Anything
-- that still opens them (old AI chips, QA id sweeps) hits a missing object.
--
-- Run 20261011_missing_file_manuals_find.sql first. This file refuses to run
-- if any of the three rows gained a file, a link, or published = true.
-- Backup rows go to private tables first; 20261011_missing_file_manuals_rollback.sql
-- puts them back.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = '';

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
  FROM public.manuals m
  WHERE m.id IN (764, 765, 801)
    AND (
      m.published IS DISTINCT FROM false
      OR coalesce(m.is_folder, false)
      OR m.storage_path IS DISTINCT FROM 'shared/quanta-system/litho-evo/DGM001435.pdf'
      OR EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'manuals' AND o.name = m.storage_path)
      OR EXISTS (SELECT 1 FROM public.user_manuals um WHERE um.manual_id = m.id)
      OR EXISTS (SELECT 1 FROM public.organization_manuals om WHERE om.manual_id = m.id)
    );
  IF bad > 0 THEN
    RAISE EXCEPTION 'missing-file cleanup: % of rows 764/765/801 changed since the check; nothing deleted', bad;
  END IF;
END
$$;

-- Plain copies: no identity, no generated search_tsv (it is rebuilt on restore).
CREATE TABLE public._cleanup_20261011_manuals AS
SELECT id, brand, model, title, storage_path, tier_required, created_at, xai_collection_id, is_folder, entry_file_path, chapter_metadata, wavelengths, equipment_type, is_incomplete, doc_kind, language, published
FROM public.manuals
WITH NO DATA;
CREATE TABLE public._cleanup_20261011_manual_search_index AS
SELECT manual_id, search_text, indexed_at, index_clipped, indexed_page_max, chunk_index
FROM public.manual_search_index
WITH NO DATA;
ALTER TABLE public._cleanup_20261011_manuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._cleanup_20261011_manual_search_index ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._cleanup_20261011_manuals FROM anon, authenticated;
REVOKE ALL ON public._cleanup_20261011_manual_search_index FROM anon, authenticated;

INSERT INTO public._cleanup_20261011_manuals (id, brand, model, title, storage_path, tier_required, created_at, xai_collection_id, is_folder, entry_file_path, chapter_metadata, wavelengths, equipment_type, is_incomplete, doc_kind, language, published)
SELECT id, brand, model, title, storage_path, tier_required, created_at, xai_collection_id, is_folder, entry_file_path, chapter_metadata, wavelengths, equipment_type, is_incomplete, doc_kind, language, published
FROM public.manuals
WHERE id IN (764, 765, 801);

INSERT INTO public._cleanup_20261011_manual_search_index (manual_id, search_text, indexed_at, index_clipped, indexed_page_max, chunk_index)
SELECT manual_id, search_text, indexed_at, index_clipped, indexed_page_max, chunk_index
FROM public.manual_search_index
WHERE manual_id IN (764, 765, 801);

-- manual_search_index rows go with ON DELETE CASCADE.
DELETE FROM public.manuals m WHERE m.id IN (764, 765, 801);

COMMIT;

-- Expected: 3 rows in public._cleanup_20261011_manuals, 3 in
-- public._cleanup_20261011_manual_search_index, and
-- 20261011_missing_file_manuals_find.sql returns no rows.
