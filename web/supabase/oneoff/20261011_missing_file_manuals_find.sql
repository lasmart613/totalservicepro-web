-- Read-only. Not a migration and not applied by the app.
-- Non-folder manuals rows whose file (entry_file_path, else storage_path) is
-- not in the manuals storage bucket, with how many user/org links and index
-- rows point at each one.
--
-- Live read-only run on 2026-10-11 against project yljztfajyvjzqikxdddf:
--   764, 765, 801  "Quanta System Litho EVO User Manual DGM001435"
--   storage_path shared/quanta-system/litho-evo/DGM001435.pdf (no object)
--   published = false, user_manuals 0, organization_manuals 0,
--   manual_search_index 1 row each (chunk 0, empty search_text).
-- No other manuals row is missing its file. user_manuals and
-- organization_manuals reference manuals by id with ON DELETE CASCADE, so no
-- orphan link can point at a deleted row. No notifications, forum posts,
-- product issue reports, marketplace data or chapter_metadata mention the old
-- paths (GE OEC 9900, Biolitec Edge One 2.0, Quanta Litho DGM001063,
-- Litho-100 DGM001341); those rows were re-pointed to real files before this
-- check, and the 400s for them stopped at 04:51 UTC (9:51 PM PT, Oct 10).

SELECT
  m.id,
  m.title,
  m.published,
  m.storage_path,
  m.entry_file_path,
  m.created_at,
  (SELECT count(*) FROM public.user_manuals um WHERE um.manual_id = m.id) AS user_manuals,
  (SELECT count(*) FROM public.organization_manuals om WHERE om.manual_id = m.id) AS organization_manuals,
  (SELECT count(*) FROM public.manual_search_index s WHERE s.manual_id = m.id) AS index_rows
FROM public.manuals m
WHERE coalesce(m.is_folder, false) = false
  AND NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'manuals'
      AND o.name = coalesce(nullif(m.entry_file_path, ''), m.storage_path)
  )
ORDER BY m.id;
