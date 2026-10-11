-- Rollback for 20261010_000910_document_send_rate_limit.sql.
-- Drops the take/release functions and the slot table. In-flight counts
-- are discarded. The app falls back to the per-instance memory limiter
-- once the functions are gone (missing-function path), until this migration
-- is applied again.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.take_document_send_slot(text, text, text);
DROP FUNCTION IF EXISTS public.release_document_send_slot(text, text, text, bigint);
DROP TABLE IF EXISTS public.document_send_slots;

NOTIFY pgrst, 'reload schema';
