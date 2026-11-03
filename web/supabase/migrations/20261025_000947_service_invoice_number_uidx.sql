-- 000947: create the missing service_invoices_org_number_uidx.
--
-- 20261025_000946_service_invoice_number_backfill.sql aborts when this index
-- is absent. 20260813_000000_unique_doc_numbers.sql was never applied in prod.
-- Prod service_invoices has the primary key plus organization_id and
-- created_at indexes only, and no duplicate (organization_id, invoice_number)
-- groups. This file creates only the invoice index, using the statement in
-- 20260813_000000_unique_doc_numbers.sql lines 8-10 (IF NOT EXISTS).
--
-- It does not create the other index in that file:
--   service_estimates_org_number_uidx (lines 4-6). That index is also absent
--   wherever 20260813 was not applied; no later migration creates it.
-- purchase_orders_org_number_uidx is not in 20260813. It is created with the
-- table in 20260825_000001_purchase_orders.sql. This file does not create it
-- and does not mark version 20260813_000000 applied.
--
-- Apply this file before re-running 000946. Filename order runs 000946 first,
-- and 000946 still aborts until this index exists.
--
-- Order inside one transaction:
--   1. drift guards (table, integer organization_id, text invoice_number)
--   2. lock service_invoices (lock_timeout 5s; this bounds the wait, not the build)
--   3. abort if any duplicate (organization_id, nonblank invoice_number) group exists
--   4. CREATE UNIQUE INDEX IF NOT EXISTS, exactly the 20260813 statement
--   5. abort if the index is missing or is not that definition
--   6. record supabase_migrations.schema_migrations version 20261025_000947
--
-- Does not update invoice_number. Rollback:
-- 20261025_000947_service_invoice_number_uidx_rollback.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drift$
DECLARE
  v_org_type oid;
  v_num_type oid;
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000947 drift: public.service_invoices is missing';
  END IF;

  SELECT atttypid INTO v_org_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'organization_id' AND NOT attisdropped;
  IF v_org_type IS NULL OR v_org_type NOT IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype) THEN
    RAISE EXCEPTION '000947 drift: public.service_invoices.organization_id integer column is missing';
  END IF;

  SELECT atttypid INTO v_num_type
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_invoices'::regclass
    AND attname = 'invoice_number' AND NOT attisdropped;
  IF v_num_type IS NULL OR v_num_type NOT IN ('text'::regtype, 'varchar'::regtype) THEN
    RAISE EXCEPTION '000947 drift: public.service_invoices.invoice_number text column is missing';
  END IF;
END
$drift$;

LOCK TABLE public.service_invoices IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
DECLARE
  v_groups bigint;
  v_sample text;
BEGIN
  -- Same rows the partial unique index covers. Null and whitespace-only
  -- invoice_number values are not nonblank, so they are not a duplicate group.
  -- GROUP BY keeps a null organization_id as one group, matching a duplicate
  -- (org, number) count.
  WITH dups AS (
    SELECT si.organization_id, si.invoice_number, count(*) AS n
    FROM public.service_invoices si
    WHERE si.invoice_number IS NOT NULL
      AND pg_catalog.btrim(si.invoice_number) <> ''
    GROUP BY si.organization_id, si.invoice_number
    HAVING count(*) > 1
  )
  SELECT count(*)::bigint,
         (SELECT pg_catalog.string_agg(
            pg_catalog.format(
              'org=%s number=%L n=%s',
              coalesce(s.organization_id::text, '<null>'),
              s.invoice_number,
              s.n
            ),
            ', ' ORDER BY s.organization_id NULLS FIRST, s.invoice_number
          )
          FROM (
            SELECT d.organization_id, d.invoice_number, d.n
            FROM dups d
            ORDER BY d.organization_id NULLS FIRST, d.invoice_number
            LIMIT 5
          ) s)
    INTO v_groups, v_sample
  FROM dups;

  IF v_groups > 0 THEN
    RAISE EXCEPTION '000947 abort: % duplicate (organization_id, nonblank invoice_number) groups exist: %',
      v_groups, coalesce(v_sample, '');
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_org_number_uidx
  ON public.service_invoices (organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND btrim(invoice_number) <> '';

DO $check$
DECLARE
  v_unique boolean;
  v_indexdef text;
BEGIN
  SELECT i.indisunique, pg_catalog.pg_get_indexdef(i.indexrelid)
    INTO v_unique, v_indexdef
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx';

  IF v_unique IS NOT TRUE
     OR v_indexdef NOT LIKE '%(organization_id, invoice_number)%'
     OR v_indexdef NOT ILIKE '%invoice_number IS NOT NULL%'
     OR v_indexdef NOT ILIKE '%btrim(invoice_number)%' THEN
    RAISE EXCEPTION '000947 drift: service_invoices_org_number_uidx is not the 20260813 definition';
  END IF;
  RAISE NOTICE '000947 indexdef: %', v_indexdef;
END
$check$;

DO $book$
DECLARE
  has_name boolean;
  has_statements boolean;
  statements_required boolean;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION '000947 drift: supabase_migrations.schema_migrations is missing';
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
    RAISE EXCEPTION '000947 drift: supabase_migrations.schema_migrations.version is not unique';
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
      VALUES ('20261025_000947', 'service_invoice_number_uidx', ARRAY['service_invoice_number_uidx']::text[])
      ON CONFLICT (version) DO NOTHING;
    ELSE
      INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
      VALUES ('20261025_000947', 'service_invoice_number_uidx', NULL)
      ON CONFLICT (version) DO NOTHING;
    END IF;
  ELSIF has_name THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20261025_000947', 'service_invoice_number_uidx')
    ON CONFLICT (version) DO NOTHING;
  ELSE
    INSERT INTO supabase_migrations.schema_migrations (version)
    VALUES ('20261025_000947')
    ON CONFLICT (version) DO NOTHING;
  END IF;
END
$book$;

NOTIFY pgrst, 'reload schema';

COMMIT;
