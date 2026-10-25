-- Rollback for 000946. Drops the assign trigger, the NOT NULL, and the
-- not-blank check, then sets invoice_number back to the audited previous
-- value (null for rows that were null or whitespace) when the current number
-- is still the value 000946 wrote. A number edited after the backfill is left
-- alone (NOTICE) so a later save is not wiped. Drops the audit table and the
-- allocator functions, and deletes schema_migrations version 20261025_000946.
-- Idempotent when 000946 is not applied. Does not drop invoice_number.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drift$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000946 rollback drift: public.service_invoices is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'invoice_number' AND NOT attisdropped
      AND atttypid IN ('text'::regtype, 'varchar'::regtype)
  ) THEN
    RAISE EXCEPTION '000946 rollback drift: public.service_invoices.invoice_number is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'service_invoices_assign_invoice_number'
      AND tgrelid = 'public.service_invoices'::regclass
      AND NOT tgisinternal
  ) AND to_regclass('public.service_invoice_number_backfill_audit') IS NULL THEN
    RAISE EXCEPTION '000946 rollback: assign trigger is present but service_invoice_number_backfill_audit is missing';
  END IF;
END
$drift$;

LOCK TABLE public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER IF EXISTS service_invoices_assign_invoice_number ON public.service_invoices;

ALTER TABLE public.service_invoices
  ALTER COLUMN invoice_number DROP NOT NULL;

ALTER TABLE public.service_invoices
  DROP CONSTRAINT IF EXISTS service_invoices_invoice_number_not_blank;

DO $restore$
DECLARE
  rec record;
  v_restored int := 0;
  v_skipped int := 0;
BEGIN
  IF to_regclass('public.service_invoice_number_backfill_audit') IS NULL THEN
    RAISE NOTICE '000946 rollback: no audit table, no invoice numbers changed';
    RETURN;
  END IF;

  FOR rec IN
    SELECT a.invoice_id, a.organization_id, a.old_invoice_number, a.new_invoice_number, a.source,
           si.invoice_number AS current_number
    FROM public.service_invoice_number_backfill_audit a
    LEFT JOIN public.service_invoices si ON si.id::text = a.invoice_id
    ORDER BY a.invoice_id
  LOOP
    IF rec.current_number IS NULL AND rec.old_invoice_number IS NULL THEN
      RAISE NOTICE '000946 rollback id=% already null', rec.invoice_id;
      CONTINUE;
    END IF;
    IF rec.current_number IS DISTINCT FROM rec.new_invoice_number THEN
      v_skipped := v_skipped + 1;
      RAISE NOTICE '000946 rollback skip id=% org=% current=% audited_after=% reason=number-changed',
        rec.invoice_id, rec.organization_id, rec.current_number, rec.new_invoice_number;
      CONTINUE;
    END IF;
    UPDATE public.service_invoices
    SET invoice_number = rec.old_invoice_number
    WHERE id::text = rec.invoice_id
      AND invoice_number IS NOT DISTINCT FROM rec.new_invoice_number;
    IF FOUND THEN
      v_restored := v_restored + 1;
      RAISE NOTICE '000946 rollback id=% org=% source=% before=% after=<null>',
        rec.invoice_id, rec.organization_id, rec.source, rec.new_invoice_number;
    END IF;
  END LOOP;

  RAISE NOTICE '000946 rollback restored % invoice numbers to null, skipped %', v_restored, v_skipped;
END
$restore$;

DROP TABLE IF EXISTS public.service_invoice_number_backfill_audit;

DROP FUNCTION IF EXISTS public.service_invoices_assign_invoice_number();
DROP FUNCTION IF EXISTS public.service_invoice_next_number(bigint, timestamptz);
DROP FUNCTION IF EXISTS public.service_invoice_day_seq(text, text);
DROP FUNCTION IF EXISTS public.service_invoice_org_zone(bigint);
DROP FUNCTION IF EXISTS public.service_invoice_org_prefix(bigint);
DROP FUNCTION IF EXISTS public.service_invoice_number_seq(text);

DO $book$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946';
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
