-- Rollback for 20261011_missing_file_manuals.sql.
-- Puts manuals 764, 765, 801 back with their original ids, then their index
-- rows (search_tsv is generated and rebuilds itself), then drops the backup
-- tables. Runs as postgres/service role, so the published guard allows the
-- published = false value back in.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = '';

INSERT INTO public.manuals (id, brand, model, title, storage_path, tier_required, created_at, xai_collection_id, is_folder, entry_file_path, chapter_metadata, wavelengths, equipment_type, is_incomplete, doc_kind, language, published)
OVERRIDING SYSTEM VALUE
SELECT b.id, b.brand, b.model, b.title, b.storage_path, b.tier_required, b.created_at, b.xai_collection_id, b.is_folder, b.entry_file_path, b.chapter_metadata, b.wavelengths, b.equipment_type, b.is_incomplete, b.doc_kind, b.language, b.published
FROM public._cleanup_20261011_manuals b
WHERE NOT EXISTS (SELECT 1 FROM public.manuals m WHERE m.id = b.id);

INSERT INTO public.manual_search_index (manual_id, search_text, indexed_at, index_clipped, indexed_page_max, chunk_index)
SELECT b.manual_id, b.search_text, b.indexed_at, b.index_clipped, b.indexed_page_max, b.chunk_index
FROM public._cleanup_20261011_manual_search_index b
WHERE NOT EXISTS (
  SELECT 1 FROM public.manual_search_index s
  WHERE s.manual_id = b.manual_id
    AND s.chunk_index IS NOT DISTINCT FROM b.chunk_index
);

DROP TABLE public._cleanup_20261011_manual_search_index;
DROP TABLE public._cleanup_20261011_manuals;

COMMIT;
