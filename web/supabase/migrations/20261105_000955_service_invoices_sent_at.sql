-- 000955: nullable sent_at on public.service_invoices.
--
-- Live service_invoices has no sent_at column. Finalize & Email and Mark sent
-- write that column from the browser. PostgREST rejects the unknown column,
-- writeWithColumnRetry saves again without it, and sent_at stays null.
--
-- Adds the column only. Does not UPDATE existing rows. Does not read or write
-- any organization. No backfill: rows sent before this column existed stay null
-- until the next Finalize & Email or Mark sent.
--
-- Repo-only until Larry and the CEO approve applying it. Do not apply from
-- the app. Safe to re-run. The migration runner applies this file as one
-- transaction. Table-level grants already cover a new column; this file does
-- not change privileges.

SET LOCAL lock_timeout = '5s';

DO $sent_at$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000955 drift: public.service_invoices is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.service_invoices'::regclass
      AND a.attname = 'sent_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND coalesce(pg_catalog.col_description(a.attrelid, a.attnum), '') NOT LIKE '000955:%'
  ) THEN
    RAISE EXCEPTION '000955 drift: service_invoices.sent_at exists and was not added by 000955';
  END IF;
END
$sent_at$;

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

COMMENT ON COLUMN public.service_invoices.sent_at IS
  '000955: when Finalize & Email or Mark sent recorded the send. Nullable. No backfill.';

NOTIFY pgrst, 'reload schema';
