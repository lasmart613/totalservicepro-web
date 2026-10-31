-- 000948: invoice labor, separate from parts line items.
--
-- Searched organizations, service_invoices, and earlier migrations for
-- labor_rate / hourly_rate / half-day / full-day columns. None exist.
-- labor_log.hourly_rate prices job-costing rows. estimate_data.pricing.laborRate
-- is one hourly rate inside a quote. Both stay as they are. These columns are new.
--
-- organizations (nullable numeric(10,2), NULL or >= 0):
--   labor_hourly_rate, labor_half_day_rate, labor_full_day_rate
-- service_invoices:
--   labor_hours, labor_half_days, labor_full_days  numeric(10,2) NOT NULL DEFAULT 0, >= 0
--   labor_hourly_rate, labor_half_day_rate, labor_full_day_rate  numeric(10,2) NULL, >= 0
--   labor_subtotal  numeric(12,2) NOT NULL DEFAULT 0, >= 0
-- Existing rows get quantity and subtotal 0, so subtotal / tax / total are unchanged.
--
-- Tax stays service_invoices.tax, a dollar amount. Labor is not given its own
-- taxable flag. Estimates already tax a subtotal that includes hourly labor;
-- the invoice copies that tax amount.
--
-- SELECT on organizations is per column (000932). These rates are public profile
-- columns, so anon and authenticated get SELECT, and authenticated gets
-- INSERT and UPDATE, same as country / phone. They are not in the private set.
-- service_invoices keeps table-level INSERT/SELECT/UPDATE for authenticated and
-- the existing service_invoices_member_all policy. This file also grants the
-- new invoice columns to authenticated explicitly. It does not create or
-- replace RLS policies.
--
-- Bookkeeping: version 20261025_000948, name invoice_labor.
-- Web ships first and hides labor when these columns are missing.
-- APPLY ON LIVE SUPABASE only after Larry's yes. Rollback:
-- 20261025_000948_invoice_labor_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION '000948 drift: public.organizations is missing';
  END IF;
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000948 drift: public.service_invoices is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION '000948 drift: anon or authenticated role is missing';
  END IF;

  FOR r IN
    SELECT *
    FROM (VALUES
      ('organizations', 'labor_hourly_rate', 10, 2, 'YES'),
      ('organizations', 'labor_half_day_rate', 10, 2, 'YES'),
      ('organizations', 'labor_full_day_rate', 10, 2, 'YES'),
      ('service_invoices', 'labor_hourly_rate', 10, 2, 'YES'),
      ('service_invoices', 'labor_half_day_rate', 10, 2, 'YES'),
      ('service_invoices', 'labor_full_day_rate', 10, 2, 'YES'),
      ('service_invoices', 'labor_hours', 10, 2, 'NO'),
      ('service_invoices', 'labor_half_days', 10, 2, 'NO'),
      ('service_invoices', 'labor_full_days', 10, 2, 'NO'),
      ('service_invoices', 'labor_subtotal', 12, 2, 'NO')
    ) AS v(tbl, col, prec, scale, nullable)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.tbl AND c.column_name = r.col
        AND c.data_type = 'numeric'
        AND c.numeric_precision = r.prec
        AND c.numeric_scale = r.scale
        AND c.is_nullable = r.nullable
    ) THEN
      RAISE EXCEPTION '000948 drift: public.%.% is not numeric(%,%) nullable %',
        r.tbl, r.col, r.prec, r.scale, r.nullable;
    END IF;
  END LOOP;
END $$;

LOCK TABLE public.organizations, public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS labor_hourly_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_half_day_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_full_day_rate numeric(10,2);

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS labor_hours numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_half_days numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_full_days numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_hourly_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_half_day_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_full_day_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS labor_subtotal numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_hourly_rate_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_labor_hourly_rate_check
  CHECK (labor_hourly_rate IS NULL OR (labor_hourly_rate >= 0 AND labor_hourly_rate <> 'NaN'));
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_half_day_rate_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_labor_half_day_rate_check
  CHECK (labor_half_day_rate IS NULL OR (labor_half_day_rate >= 0 AND labor_half_day_rate <> 'NaN'));
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_labor_full_day_rate_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_labor_full_day_rate_check
  CHECK (labor_full_day_rate IS NULL OR (labor_full_day_rate >= 0 AND labor_full_day_rate <> 'NaN'));

ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_hours_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_hours_check
  CHECK (labor_hours >= 0 AND labor_hours <> 'NaN');
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_half_days_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_half_days_check
  CHECK (labor_half_days >= 0 AND labor_half_days <> 'NaN');
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_full_days_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_full_days_check
  CHECK (labor_full_days >= 0 AND labor_full_days <> 'NaN');
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_hourly_rate_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_hourly_rate_check
  CHECK (labor_hourly_rate IS NULL OR (labor_hourly_rate >= 0 AND labor_hourly_rate <> 'NaN'));
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_half_day_rate_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_half_day_rate_check
  CHECK (labor_half_day_rate IS NULL OR (labor_half_day_rate >= 0 AND labor_half_day_rate <> 'NaN'));
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_full_day_rate_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_full_day_rate_check
  CHECK (labor_full_day_rate IS NULL OR (labor_full_day_rate >= 0 AND labor_full_day_rate <> 'NaN'));
ALTER TABLE public.service_invoices DROP CONSTRAINT IF EXISTS service_invoices_labor_subtotal_check;
ALTER TABLE public.service_invoices ADD CONSTRAINT service_invoices_labor_subtotal_check
  CHECK (labor_subtotal >= 0 AND labor_subtotal <> 'NaN');

COMMENT ON COLUMN public.organizations.labor_hourly_rate IS
  '000948 service-org default hourly labor rate. NULL until set. >= 0.';
COMMENT ON COLUMN public.organizations.labor_half_day_rate IS
  '000948 service-org default half-day labor rate. NULL until set. >= 0.';
COMMENT ON COLUMN public.organizations.labor_full_day_rate IS
  '000948 service-org default full-day labor rate. NULL until set. >= 0.';
COMMENT ON COLUMN public.service_invoices.labor_hours IS
  '000948 hours on this invoice. Default 0. Snapshot rate is labor_hourly_rate.';
COMMENT ON COLUMN public.service_invoices.labor_half_days IS
  '000948 half days on this invoice. Default 0.';
COMMENT ON COLUMN public.service_invoices.labor_full_days IS
  '000948 full days on this invoice. Default 0.';
COMMENT ON COLUMN public.service_invoices.labor_hourly_rate IS
  '000948 hourly rate snapshotted onto this invoice. Editable per invoice.';
COMMENT ON COLUMN public.service_invoices.labor_half_day_rate IS
  '000948 half-day rate snapshotted onto this invoice.';
COMMENT ON COLUMN public.service_invoices.labor_full_day_rate IS
  '000948 full-day rate snapshotted onto this invoice.';
COMMENT ON COLUMN public.service_invoices.labor_subtotal IS
  '000948 hours × hourly + half days × half-day + full days × full-day. Default 0. Included in subtotal and total.';

-- 000932 revoked table SELECT. New public columns need an explicit SELECT grant.
GRANT SELECT (labor_hourly_rate, labor_half_day_rate, labor_full_day_rate)
  ON TABLE public.organizations TO anon, authenticated;
GRANT INSERT (labor_hourly_rate, labor_half_day_rate, labor_full_day_rate)
  ON TABLE public.organizations TO authenticated;
GRANT UPDATE (labor_hourly_rate, labor_half_day_rate, labor_full_day_rate)
  ON TABLE public.organizations TO authenticated;

GRANT SELECT (
  labor_hours, labor_half_days, labor_full_days,
  labor_hourly_rate, labor_half_day_rate, labor_full_day_rate,
  labor_subtotal
) ON TABLE public.service_invoices TO authenticated;
GRANT INSERT (
  labor_hours, labor_half_days, labor_full_days,
  labor_hourly_rate, labor_half_day_rate, labor_full_day_rate,
  labor_subtotal
) ON TABLE public.service_invoices TO authenticated;
GRANT UPDATE (
  labor_hours, labor_half_days, labor_full_days,
  labor_hourly_rate, labor_half_day_rate, labor_full_day_rate,
  labor_subtotal
) ON TABLE public.service_invoices TO authenticated;

DO $book$
DECLARE
  has_name boolean;
  has_statements boolean;
  statements_required boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '000948 drift: supabase_migrations.schema_migrations is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'supabase_migrations.schema_migrations'::regclass
      AND i.indisunique
      AND a.attname = 'version'
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION '000948 drift: supabase_migrations.schema_migrations.version is not unique';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'name'
  ) INTO has_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations' AND column_name = 'statements'
  ) INTO has_statements;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
      AND column_name = 'statements' AND is_nullable = 'NO'
  ) INTO statements_required;

  IF has_name AND has_statements THEN
    IF statements_required THEN
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20261025_000948', 'invoice_labor', ARRAY['invoice_labor']::text[])
      ON CONFLICT (version) DO NOTHING;
    ELSE
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20261025_000948', 'invoice_labor', NULL)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  ELSIF has_name THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20261025_000948', 'invoice_labor')
    ON CONFLICT (version) DO NOTHING;
  ELSE
    INSERT INTO supabase_migrations.schema_migrations (version)
    VALUES ('20261025_000948')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
