-- Rollback for 20261011_000912_manual_search_index_clip.sql.
-- Drops the clip marker. get-manual-url then treats the index max as
-- unknown and keeps a stored page map.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_indexed_page_max_check;

ALTER TABLE public.manual_search_index
  DROP COLUMN IF EXISTS index_clipped;

ALTER TABLE public.manual_search_index
  DROP COLUMN IF EXISTS indexed_page_max;

NOTIFY pgrst, 'reload schema';
