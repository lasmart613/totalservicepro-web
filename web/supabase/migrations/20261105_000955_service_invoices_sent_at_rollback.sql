-- Rollback 000955. Drops service_invoices.sent_at only when this migration
-- added it (column comment starts with 000955:). A sent_at column from any
-- other change is left in place. Does not rewrite invoice rows.

SET LOCAL lock_timeout = '5s';

DO $drop_sent_at$
DECLARE
  v_comment text;
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_catalog.col_description(a.attrelid, a.attnum)
    INTO v_comment
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.service_invoices'::regclass
    AND a.attname = 'sent_at'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF coalesce(v_comment, '') NOT LIKE '000955:%' THEN
    RAISE EXCEPTION '000955 rollback refused: service_invoices.sent_at was not added by 000955';
  END IF;

  ALTER TABLE public.service_invoices DROP COLUMN sent_at;
END
$drop_sent_at$;

NOTIFY pgrst, 'reload schema';
