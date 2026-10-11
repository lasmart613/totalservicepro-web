-- Record when manual_search_index.search_text was sliced at 1,500,000
-- characters, and the highest [[pdfpage:N]] that survived the slice.
--
-- get-manual-url allows a stored page map when the pdf.js page_count sum
-- equals indexed_page_max, or when index_clipped is true and the sum is
-- still at least that max. Pages before the clip use the same offsets.
-- An unclipped sum above the max, and any sum below the max, omit the map.
--
-- Existing rows have no marker. char_length >= 1499000 is that slice:
-- manuals 1 and 9 are 1500000 characters, and manual 73 is 1499994 because
-- a non-BMP character is one Postgres code point and two UTF-16 units.
-- The next full index is manual 58 at 1386147. The indexer writes both
-- columns on later saves. This UPDATE fills only rows the indexer has not
-- written yet (indexed_page_max IS NULL), so a re-run does not replace
-- those values.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
-- Do not apply from the app deploy.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.manual_search_index
  ADD COLUMN IF NOT EXISTS index_clipped boolean NOT NULL DEFAULT false;

ALTER TABLE public.manual_search_index
  ADD COLUMN IF NOT EXISTS indexed_page_max integer;

ALTER TABLE public.manual_search_index
  DROP CONSTRAINT IF EXISTS manual_search_index_indexed_page_max_check;

ALTER TABLE public.manual_search_index
  ADD CONSTRAINT manual_search_index_indexed_page_max_check
  CHECK (indexed_page_max IS NULL OR (indexed_page_max >= 1 AND indexed_page_max <= 9999));

COMMENT ON COLUMN public.manual_search_index.index_clipped IS
  'True when search_text was sliced at the 1,500,000-character index cap. Pages at or below indexed_page_max still line up with chapter page_count.';

COMMENT ON COLUMN public.manual_search_index.indexed_page_max IS
  'Highest complete [[pdfpage:N]] stamp stored in search_text. Null when the row has no stamps.';

UPDATE public.manual_search_index AS i
SET
  index_clipped = char_length(i.search_text) >= 1499000,
  indexed_page_max = (
    SELECT max(m[1]::integer)
    FROM regexp_matches(i.search_text, '\[\[pdfpage:([0-9]{1,4})\]\]', 'g') AS m
    WHERE m[1]::integer BETWEEN 1 AND 9999
  )
WHERE i.indexed_page_max IS NULL;

NOTIFY pgrst, 'reload schema';
