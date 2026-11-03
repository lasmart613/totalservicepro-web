-- Rollback for 000948. Drops the labor rate columns on organizations and the
-- labor quantity, rate snapshot, and labor_subtotal columns on service_invoices,
-- and deletes schema_migrations version 20261025_000948.
-- Invoice subtotal, tax, total, and amount_paid are not modified.
-- Idempotent when the columns are already gone.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drift$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000948 rollback drift: public.organizations is missing';
  END IF;
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000948 rollback drift: public.service_invoices is missing';
  END IF;
END
$drift$;

LOCK TABLE public.organizations, public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_hourly_rate_check;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_half_day_rate_check;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_full_day_rate_check;

ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_hours_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_half_days_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_full_days_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_hourly_rate_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_half_day_rate_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_full_day_rate_check;
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_subtotal_check;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS labor_hourly_rate,
  DROP COLUMN IF EXISTS labor_half_day_rate,
  DROP COLUMN IF EXISTS labor_full_day_rate;

ALTER TABLE public.service_invoices
  DROP COLUMN IF EXISTS labor_hours,
  DROP COLUMN IF EXISTS labor_half_days,
  DROP COLUMN IF EXISTS labor_full_days,
  DROP COLUMN IF EXISTS labor_hourly_rate,
  DROP COLUMN IF EXISTS labor_half_day_rate,
  DROP COLUMN IF EXISTS labor_full_day_rate,
  DROP COLUMN IF EXISTS labor_subtotal;

DO $book$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261025_000948';
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
