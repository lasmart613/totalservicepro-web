-- Local proof for 20261025_000948_invoice_labor.sql (+ rollback) on PostgreSQL 17.
-- Scratch database only. The migration has its own BEGIN/COMMIT.
-- org 1005 is a real customer and is never inserted.
--
--   createdb invoice_labor_proof
--   psql "postgresql:///invoice_labor_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261025_invoice_labor.sql
--   dropdb invoice_labor_proof

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'proof requires PostgreSQL 17, got %', current_setting('server_version');
  END IF;
  IF to_regclass('public.organizations') IS NOT NULL OR to_regclass('public.service_invoices') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: not a scratch database';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name text,
  statements text[]
);

CREATE TABLE public.organizations (
  id bigint PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.service_invoices (
  id bigint PRIMARY KEY,
  organization_id bigint REFERENCES public.organizations(id),
  customer_name text,
  subtotal numeric(12,2),
  tax numeric(12,2),
  total numeric(12,2),
  amount_paid numeric(12,2) DEFAULT 0,
  status text,
  invoice_number text,
  invoice_data jsonb
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY service_invoices_member_all ON public.service_invoices
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT (id, name) ON TABLE public.organizations TO anon, authenticated;
GRANT UPDATE (name) ON TABLE public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_invoices TO authenticated;
GRANT ALL ON TABLE public.organizations, public.service_invoices TO service_role;

-- org 1005 is a real customer. This fixture uses 7001 only.
INSERT INTO public.organizations (id, name) VALUES (7001, 'Proof Service');
INSERT INTO public.service_invoices (id, organization_id, customer_name, subtotal, tax, total, amount_paid, status, invoice_number)
VALUES (42, 7001, 'Existing Clinic', 100.00, 8.00, 108.00, 0, 'sent', 'INV-EXISTING');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = 1005) THEN
    RAISE EXCEPTION 'refusing: org 1005 is a real customer';
  END IF;
END $$;

CREATE TEMP TABLE labor_policy_before AS
SELECT pol.polname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'service_invoices';

\i web/supabase/migrations/20261025_000948_invoice_labor.sql

DO $$
DECLARE
  v_hours numeric;
  v_half numeric;
  v_full numeric;
  v_sub numeric;
  v_total numeric;
  v_tax numeric;
  v_subtotal numeric;
  v_paid numeric;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'proof lost PostgreSQL 17';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'labor_hourly_rate' AND data_type = 'numeric'
      AND numeric_precision = 10 AND numeric_scale = 2 AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'labor_half_day_rate' AND numeric_precision = 10 AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'labor_full_day_rate' AND numeric_precision = 10 AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'org labor rate columns missing or wrong type';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_invoices'
      AND column_name = 'labor_hours' AND data_type = 'numeric'
      AND numeric_precision = 10 AND numeric_scale = 2 AND is_nullable = 'NO'
      AND column_default IS NOT NULL
      AND regexp_replace(column_default, '[^0-9.-]', '', 'g') = '0'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_invoices'
      AND column_name = 'labor_subtotal' AND numeric_precision = 12 AND numeric_scale = 2
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'invoice labor columns missing or wrong type';
  END IF;

  SELECT labor_hours, labor_half_days, labor_full_days, labor_subtotal, total, tax, subtotal, amount_paid
    INTO v_hours, v_half, v_full, v_sub, v_total, v_tax, v_subtotal, v_paid
  FROM public.service_invoices WHERE id = 42;
  IF v_hours <> 0 OR v_half <> 0 OR v_full <> 0 OR v_sub <> 0 THEN
    RAISE EXCEPTION 'existing invoice labor defaulted to % % % %', v_hours, v_half, v_full, v_sub;
  END IF;
  IF v_subtotal <> 100 OR v_tax <> 8 OR v_total <> 108 OR v_paid <> 0 THEN
    RAISE EXCEPTION 'existing invoice totals changed: subtotal % tax % total % paid %', v_subtotal, v_tax, v_total, v_paid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261025_000948' AND name = 'invoice_labor'
  ) THEN
    RAISE EXCEPTION 'schema_migrations row missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN labor_policy_before b ON b.polname = pol.polname
    WHERE c.relname = 'service_invoices'
      AND (pg_get_expr(pol.polqual, pol.polrelid) IS DISTINCT FROM b.qual
        OR pg_get_expr(pol.polwithcheck, pol.polrelid) IS DISTINCT FROM b.with_check)
  ) THEN
    RAISE EXCEPTION 'service_invoices RLS policy changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'labor_hourly_rate' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name = 'labor_half_day_rate' AND grantee = 'anon' AND privilege_type = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'service_invoices'
      AND column_name = 'labor_subtotal' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'labor grants missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'service_invoices'
      AND column_name = 'labor_hours' AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'anon was granted invoice labor columns';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.organizations (id, name, labor_hourly_rate) VALUES (7002, 'Neg Rate', -1);
    RAISE EXCEPTION 'negative org rate was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.service_invoices (id, organization_id, subtotal, tax, total, labor_hours)
    VALUES (43, 7001, 0, 0, 0, -2);
    RAISE EXCEPTION 'negative hours were accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

INSERT INTO public.organizations (id, name, labor_hourly_rate, labor_half_day_rate, labor_full_day_rate)
VALUES (7003, 'Rates Shop', 150.00, 500.00, 900.00);
INSERT INTO public.service_invoices (
  id, organization_id, customer_name, subtotal, tax, total,
  labor_hours, labor_half_days, labor_full_days,
  labor_hourly_rate, labor_half_day_rate, labor_full_day_rate, labor_subtotal
) VALUES (
  44, 7003, 'Labor Clinic', 1100.00, 8.00, 1108.00,
  2.00, 1.00, 0.50,
  150.00, 500.00, 900.00, 1250.00
);

DO $$
DECLARE
  v_total numeric;
  v_labor numeric;
BEGIN
  SELECT total, labor_subtotal INTO v_total, v_labor FROM public.service_invoices WHERE id = 42;
  IF v_total <> 108 OR v_labor <> 0 THEN
    RAISE EXCEPTION 'zero-labor invoice changed after a labor invoice was inserted';
  END IF;
  SELECT labor_subtotal INTO v_labor FROM public.service_invoices WHERE id = 44;
  IF v_labor <> 1250 THEN
    RAISE EXCEPTION 'labor subtotal not stored, got %', v_labor;
  END IF;
END $$;

\i web/supabase/migrations/20261025_000948_invoice_labor_rollback.sql

DO $$
DECLARE
  v_total numeric;
  v_tax numeric;
  v_subtotal numeric;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name IN ('labor_hourly_rate', 'labor_half_day_rate', 'labor_full_day_rate')
  ) OR EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'service_invoices'
      AND column_name IN (
        'labor_hours', 'labor_half_days', 'labor_full_days',
        'labor_hourly_rate', 'labor_half_day_rate', 'labor_full_day_rate', 'labor_subtotal'
      )
  ) THEN
    RAISE EXCEPTION 'rollback left labor columns';
  END IF;
  SELECT total, tax, subtotal INTO v_total, v_tax, v_subtotal
  FROM public.service_invoices WHERE id = 42;
  IF v_subtotal <> 100 OR v_tax <> 8 OR v_total <> 108 THEN
    RAISE EXCEPTION 'rollback changed existing totals';
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000948'
  ) THEN
    RAISE EXCEPTION 'rollback left schema_migrations row';
  END IF;
END $$;

\i web/supabase/migrations/20261025_000948_invoice_labor.sql

DO $$
DECLARE
  v_total numeric;
BEGIN
  SELECT total INTO v_total FROM public.service_invoices WHERE id = 42;
  IF v_total <> 108 THEN
    RAISE EXCEPTION 're-apply changed existing total';
  END IF;
  IF (SELECT labor_hours FROM public.service_invoices WHERE id = 42) <> 0 THEN
    RAISE EXCEPTION 're-apply did not default labor hours to 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261025_000948' AND name = 'invoice_labor'
  ) THEN
    RAISE EXCEPTION 're-apply did not record schema_migrations';
  END IF;
END $$;

SELECT '000948 invoice labor proof ok' AS result;
