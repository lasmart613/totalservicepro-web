-- supabase/migrations/20250525_120000_add_manual_folder_support.sql
--
-- Option 1 Long-Term Data Model for Service Manuals
-- Adds support for "folder-style" / multi-chapter manuals (e.g. Candela Mini GentleLASE - MGL)
-- while keeping the existing per-file ownership + Edge Function prefix authz working.
--
-- Philosophy (matches current Edge Function design):
--   • Every physical PDF file that can be viewed has (or can have) its own row in `manuals`
--     with `storage_path` pointing to the exact object, e.g.
--       "shared/candela/MGL Service Manual/Sect 1/8501-00-1762_A.pdf"
--   • A "virtual folder/manual" row (the one shown as a single book on the shelf) uses:
--       is_folder = true
--       storage_path = the common prefix (e.g. "shared/candela/MGL Service Manual")
--         → this makes the existing startsWith(ownedPath + "/") check grant *all* children automatically
--       entry_file_path = the chapter to open by default when the book is tapped
--       chapter_metadata = rich array used by the PDF viewer chapter selector UI
--
-- Benefits:
--   - One ownership row (user_manuals) for the whole manual grants every chapter via prefix
--   - Nice bookshelf UX (one book → chapter grid → individual PDFs load via streaming)
--   - Cross-chapter links (TOC "Sect 3/....pdf") continue to work with resolveRelativeStoragePath + loadNewPDF
--   - Single-file manuals remain unchanged (is_folder=false, just use storage_path)
--
-- Deploy:
--   supabase db push   (or apply via Supabase Dashboard SQL editor / CLI)
--
-- Rollback:
--   alter table public.manuals drop column if exists chapter_metadata;
--   alter table public.manuals drop column if exists entry_file_path;
--   alter table public.manuals drop column if exists is_folder;

-- 1. Add the new columns (idempotent)
alter table if exists public.manuals
  add column if not exists is_folder        boolean not null default false,
  add column if not exists entry_file_path  text,
  add column if not exists chapter_metadata jsonb   not null default '[]'::jsonb;

-- Helpful index for UI queries that filter folder vs file manuals
create index if not exists idx_manuals_is_folder on public.manuals (is_folder);

-- 2. Documentation / comments
comment on column public.manuals.is_folder is
  'True when this row represents a multi-chapter / folder-based service manual (e.g. MGL). The shelf/book UI shows this entry; clicking it opens the chapter selector instead of loading a single PDF.';

comment on column public.manuals.entry_file_path is
  'Relative path (under the folder prefix) of the default chapter to auto-load when the user taps a folder-style manual. Example: "Sect 1/8501-00-1762_A.pdf"';

comment on column public.manuals.chapter_metadata is
  'JSON array of chapter definitions used exclusively by the PDF viewer chapter grid UI. Each item: { "order": number, "title": string, "storage_path": string (full or relative) }. Stored here so the client never needs to list private Storage objects.';

-- 3. Example backfill for the Candela MGL Service Manual
--    (Run/adapt this after you have inserted or identified the parent "MGL" row in your manuals table.
--     Replace the WHERE clause with the actual id or a more precise title match if needed.
--     The chapter list below is derived from the real folder structure; extend it with any additional Sects/files you have uploaded.)

/*
-- EXAMPLE: Mark (or create) the MGL parent row as a folder manual and populate its chapter list.
-- You can run this manually in the Supabase SQL editor.

-- If you do not yet have a single "MGL Service Manual" row that represents the whole product,
-- first INSERT one (example only — fill brand, title, price_cents, etc. to match your catalog):

INSERT INTO public.manuals (brand, title, storage_path, is_folder, entry_file_path, chapter_metadata)
VALUES (
  'Candela',
  'Mini GentleLASE (MGL) Service Manual',
  'shared/candela/MGL Service Manual',           -- prefix used for ownership granting
  true,
  'Sect 1/8501-00-1762_A.pdf',
  '[
    {"order": 0, "title": "MGL Operator''s Manual", "storage_path": "shared/candela/MGL Service Manual/MGL Operator''s Manual/8501-00-1740_A.pdf"},
    {"order": 1, "title": "Sect 1 - System Overview & Safety", "storage_path": "shared/candela/MGL Service Manual/Sect 1/8501-00-1762_A.pdf"},
    {"order": 2, "title": "Sect 2 - Theory of Operation", "storage_path": "shared/candela/MGL Service Manual/Sect 2/1010-01-3020-B2.pdf"},
    {"order": 3, "title": "Sect 2 - Additional Diagrams", "storage_path": "shared/candela/MGL Service Manual/Sect 2/1010-06-3020-B2.pdf"},
    {"order": 4, "title": "Sect 3 - Troubleshooting (part 1)", "storage_path": "shared/candela/MGL Service Manual/Sect 3/10-040-01502_02.pdf"},
    {"order": 5, "title": "Sect 3 - Troubleshooting (part 2)", "storage_path": "shared/candela/MGL Service Manual/Sect 3/8503-01-0826_A.pdf"},
    {"order": 6, "title": "Sect 3 - Calibration & Alignment", "storage_path": "shared/candela/MGL Service Manual/Sect 3/8503-01-0821_A.pdf"}
    -- ... add the remaining 10+ files from Sect 3 and any other sections exactly as they appear in Storage
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;   -- or use a unique constraint on (brand, title) if you have one

-- Or UPDATE an existing row you already use for MGL in the library:

UPDATE public.manuals
SET
  is_folder         = true,
  storage_path      = 'shared/candela/MGL Service Manual',
  entry_file_path   = 'Sect 1/8501-00-1762_A.pdf',
  chapter_metadata  = '[
    {"order":0,"title":"MGL Operator''s Manual","storage_path":"shared/candela/MGL Service Manual/MGL Operator''s Manual/8501-00-1740_A.pdf"},
    {"order":1,"title":"Sect 1 - System Overview & Safety","storage_path":"shared/candela/MGL Service Manual/Sect 1/8501-00-1762_A.pdf"},
    {"order":2,"title":"Sect 2 - Theory of Operation","storage_path":"shared/candela/MGL Service Manual/Sect 2/1010-01-3020-B2.pdf"},
    {"order":3,"title":"Sect 2 - Additional Diagrams","storage_path":"shared/candela/MGL Service Manual/Sect 2/1010-06-3020-B2.pdf"},
    {"order":4,"title":"Sect 3 - Troubleshooting (part 1)","storage_path":"shared/candela/MGL Service Manual/Sect 3/10-040-01502_02.pdf"},
    {"order":5,"title":"Sect 3 - Troubleshooting (part 2)","storage_path":"shared/candela/MGL Service Manual/Sect 3/8503-01-0826_A.pdf"},
    {"order":6,"title":"Sect 3 - Calibration & Alignment","storage_path":"shared/candela/MGL Service Manual/Sect 3/8503-01-0821_A.pdf"},
    {"order":7,"title":"Sect 3 - Board Layouts & Schematics","storage_path":"shared/candela/MGL Service Manual/Sect 3/8503-01-0822_A.pdf"},
    {"order":8,"title":"Sect 3 - Parts & Diagrams","storage_path":"shared/candela/MGL Service Manual/Sect 3/8503-01-0823_A.pdf"},
    {"order":9,"title":"Sect 3 - Final Assembly","storage_path":"shared/candela/MGL Service Manual/Sect 3/8503-01-0827_A.pdf"}
    -- Extend with every PDF that lives under the MGL Service Manual prefix in your Storage bucket.
    -- Order values control display sequence in the chapter grid.
  ]'::jsonb
WHERE title ILIKE '%MGL%' OR title ILIKE '%Mini GentleLASE%' OR title ILIKE '%MiniGentle%';

-- After the UPDATE, any user who adds the MGL parent row to their library (user_manuals)
-- will automatically get access to every chapter PDF via the existing prefix check in get-manual-url.
*/

-- 4. (Optional) Ensure existing single-file manuals have is_folder = false (harmless, default already covers new rows)
-- UPDATE public.manuals SET is_folder = false WHERE is_folder IS NULL;

-- End of migration
