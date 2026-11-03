-- Local proof for 20261025_000947_service_invoice_number_uidx.sql.
-- Empty Postgres 17 database only. Refuses to run when public.service_invoices
-- already exists. Fixture orgs are 7001 and 7002. org 1005 is a real customer.
--
-- Models prod where 20260813_000000_unique_doc_numbers.sql was not applied:
-- service_invoices has a primary key, an organization_id index, and a
-- created_at index, and no service_invoices_org_number_uidx. The estimates
-- unique index from that same file is absent. purchase_orders_org_number_uidx
-- is present because 20260825 creates it with the table, not because of 20260813.
--
--   createdb invoice_uidx_proof
--   psql "postgresql:///invoice_uidx_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261025_service_invoice_number_uidx.sql
--   dropdb invoice_uidx_proof
\set ON_ERROR_STOP on
\if :{?mig}
\else
\set mig ../migrations/20261025_000947_service_invoice_number_uidx.sql
\endif
\if :{?rb}
\else
\set rb ../migrations/20261025_000947_service_invoice_number_uidx_rollback.sql
\endif
\if :{?backfill}
\else
\set backfill ../migrations/20261025_000946_service_invoice_number_backfill.sql
\endif

DO $$ BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION 'proof requires Postgres 17+ (got %)', current_setting('server_version');
  END IF;
  IF to_regclass('public.service_invoices') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.service_invoices already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);

CREATE TEMP TABLE proof_results (n serial, name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.proof(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void
LANGUAGE sql AS $$ INSERT INTO proof_results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail) $$;

-- Prod-equivalent tables. Index names for organization_id and created_at are
-- local stand-ins; prod's names were not copied. The unique invoice index is absent.
CREATE TABLE public.organizations (
  id bigint PRIMARY KEY,
  name text,
  ticket_prefix text,
  timezone text
);
CREATE TABLE public.service_invoices (
  id bigint PRIMARY KEY,
  organization_id bigint,
  created_at timestamptz,
  invoice_number text,
  invoice_data jsonb
);
CREATE INDEX service_invoices_organization_id_idx ON public.service_invoices (organization_id);
CREATE INDEX service_invoices_created_at_idx ON public.service_invoices (created_at);

CREATE TABLE public.service_estimates (
  id bigint PRIMARY KEY,
  organization_id bigint,
  estimate_number text,
  created_at timestamptz
);

CREATE TABLE public.purchase_orders (
  id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  po_number text
);
CREATE UNIQUE INDEX purchase_orders_org_number_uidx
  ON public.purchase_orders (organization_id, po_number)
  WHERE po_number IS NOT NULL AND po_number <> '';

INSERT INTO public.organizations (id, name, ticket_prefix, timezone) VALUES
  (7001, 'Lumen', 'LPX', 'America/Los_Angeles'),
  (7002, 'Other Shop', 'ZZ', 'America/New_York');

INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, invoice_data) VALUES
  (1, 7001, '2026-10-01 20:00:00+00', 'LPX-INV-20261001-01', NULL),
  (2, 7001, '2026-10-01 21:00:00+00', NULL, NULL),
  (3, 7001, '2026-10-02 20:00:00+00', NULL, '{"invoice_number":"LPX-INV-20261002-02"}'),
  (4, 7001, '2026-10-03 20:00:00+00', '   ', NULL),
  (5, 7002, '2026-10-01 20:00:00+00', 'LPX-INV-20261001-01', NULL),
  (6, 7002, '2026-10-01 20:00:00+00', NULL, NULL),
  (7, 7001, '2026-10-04 20:00:00+00', '   ', NULL),
  (8, 7001, '2026-10-01 22:00:00+00', NULL, NULL);

SELECT pg_temp.proof('prod-equivalent invoice indexes omit the unique number index',
  (SELECT array_agg(c.relname ORDER BY c.relname)
   FROM pg_index i
   JOIN pg_class c ON c.oid = i.indexrelid
   JOIN pg_class t ON t.oid = i.indrelid
   JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'service_invoices')
  = ARRAY['service_invoices_created_at_idx', 'service_invoices_organization_id_idx', 'service_invoices_pkey']::name[]);

SELECT pg_temp.proof('estimates org number index from 20260813 is missing',
  to_regclass('public.service_estimates_org_number_uidx') IS NULL);

SELECT pg_temp.proof('purchase order org number index from 20260825 is present',
  to_regclass('public.purchase_orders_org_number_uidx') IS NOT NULL);

-- ---------- duplicate nonblank numbers abort ----------
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number)
VALUES
  (90, 7001, '2026-10-01 12:00:00+00', 'DUP-1'),
  (91, 7001, '2026-10-01 13:00:00+00', 'DUP-1');

\set ON_ERROR_STOP off
\ir :mig
\set ON_ERROR_STOP on
ROLLBACK;

SELECT pg_temp.proof('duplicate (org, nonblank number) aborts before the index exists',
  to_regclass('public.service_invoices_org_number_uidx') IS NULL
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947')
  AND (SELECT count(*) FROM public.service_invoices WHERE invoice_number = 'DUP-1') = 2);

DELETE FROM public.service_invoices WHERE id IN (90, 91);

-- Null organization_id still counts as one group.
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number)
VALUES
  (92, NULL, '2026-10-01 12:00:00+00', 'SAME'),
  (93, NULL, '2026-10-01 13:00:00+00', 'SAME');

\set ON_ERROR_STOP off
\ir :mig
\set ON_ERROR_STOP on
ROLLBACK;

SELECT pg_temp.proof('duplicate null-org nonblank numbers abort',
  to_regclass('public.service_invoices_org_number_uidx') IS NULL
  AND (SELECT count(*) FROM public.service_invoices WHERE invoice_number = 'SAME') = 2);

DELETE FROM public.service_invoices WHERE id IN (92, 93);

-- Whitespace-only duplicates are outside the index predicate.
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number)
VALUES
  (94, 7001, '2026-10-08 20:00:00+00', ' '),
  (95, 7001, '2026-10-09 20:00:00+00', ' ');

-- ---------- 000946 still aborts while the index is missing ----------
\set ON_ERROR_STOP off
\ir :backfill
\set ON_ERROR_STOP on
ROLLBACK;

SELECT pg_temp.proof('000946 still aborts while the unique index is missing',
  to_regclass('public.service_invoice_number_backfill_audit') IS NULL
  AND NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number' AND NOT attisdropped)
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 2) IS NULL
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946'));

-- ---------- 000947 creates the index, then rolls back exactly ----------
\ir :mig

SELECT pg_temp.proof('000947 creates the 20260813 invoice unique index',
  (SELECT i.indisunique AND pg_get_indexdef(i.indexrelid) LIKE '%(organization_id, invoice_number)%'
        AND pg_get_indexdef(i.indexrelid) ILIKE '%invoice_number IS NOT NULL%'
        AND pg_get_indexdef(i.indexrelid) ILIKE '%btrim(invoice_number)%'
   FROM pg_index i
   JOIN pg_class c ON c.oid = i.indexrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx'));

SELECT pg_temp.proof('000947 records schema_migrations version 20261025_000947',
  (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947')
    = 'service_invoice_number_uidx'
  AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947') = 1);

SELECT pg_temp.proof('000947 does not number rows or set NOT NULL',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 2) IS NULL
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 4) = '   '
  AND NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number' AND NOT attisdropped));

SELECT pg_temp.proof('000947 leaves estimates missing and purchase orders untouched',
  to_regclass('public.service_estimates_org_number_uidx') IS NULL
  AND to_regclass('public.purchase_orders_org_number_uidx') IS NOT NULL);

\ir :mig
SELECT pg_temp.proof('re-apply keeps one index and one schema_migrations row',
  (SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx') = 1
  AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947') = 1);

\ir :rb
SELECT pg_temp.proof('rollback drops the index and the schema_migrations row',
  to_regclass('public.service_invoices_org_number_uidx') IS NULL
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947')
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 1) = 'LPX-INV-20261001-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 2) IS NULL
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 5) = 'LPX-INV-20261001-01');

\ir :rb
SELECT pg_temp.proof('rollback is idempotent when the index is already absent',
  to_regclass('public.service_invoices_org_number_uidx') IS NULL);

CREATE INDEX service_invoices_org_number_uidx ON public.service_invoices (organization_id);
\set ON_ERROR_STOP off
\ir :rb
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.proof('rollback refuses a different index with that name',
  to_regclass('public.service_invoices_org_number_uidx') IS NOT NULL
  AND NOT (SELECT i.indisunique
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx'));

\set ON_ERROR_STOP off
\ir :mig
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.proof('000947 refuses to bookkeep a different index with that name',
  NOT (SELECT i.indisunique
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'service_invoices_org_number_uidx')
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947'));

DROP INDEX public.service_invoices_org_number_uidx;

-- ---------- 000947 then 000946 on a database that was missing the index ----------
\ir :mig
\ir :backfill

SELECT pg_temp.proof('000946 applies after 000947',
  (SELECT attnotnull FROM pg_attribute
   WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number' AND NOT attisdropped)
  AND to_regclass('public.service_invoice_number_backfill_audit') IS NOT NULL
  AND (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946')
      = 'service_invoice_number_backfill'
  AND (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947')
      = 'service_invoice_number_uidx');

SELECT pg_temp.proof('000946 keeps an existing number and fills json and sequence',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 1) = 'LPX-INV-20261001-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 2) = 'LPX-INV-20261001-02'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 8) = 'LPX-INV-20261001-03'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 3) = 'LPX-INV-20261002-02'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 4) = 'LPX-INV-20261003-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 7) = 'LPX-INV-20261004-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 5) = 'LPX-INV-20261001-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 6) = 'ZZ-INV-20261001-01',
  (SELECT string_agg(id::text || '=' || coalesce(invoice_number, '<null>'), ', ' ORDER BY id)
   FROM public.service_invoices));

SELECT pg_temp.proof('no blank invoice numbers remain',
  NOT EXISTS (
    SELECT 1 FROM public.service_invoices
    WHERE invoice_number IS NULL OR btrim(invoice_number) = ''
  ));

SELECT pg_temp.proof('invoice indexes are pkey, organization_id, created_at, and the unique number',
  (SELECT array_agg(c.relname ORDER BY c.relname)
   FROM pg_index i
   JOIN pg_class c ON c.oid = i.indexrelid
   JOIN pg_class t ON t.oid = i.indrelid
   JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'service_invoices')
  = ARRAY['service_invoices_created_at_idx', 'service_invoices_org_number_uidx',
          'service_invoices_organization_id_idx', 'service_invoices_pkey']::name[]);

SELECT pg_temp.proof('000947 and 000946 did not create the estimates index or drop the PO index',
  to_regclass('public.service_estimates_org_number_uidx') IS NULL
  AND to_regclass('public.purchase_orders_org_number_uidx') IS NOT NULL);

\ir :mig
SELECT pg_temp.proof('re-apply after 000946 keeps the filled numbers',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 2) = 'LPX-INV-20261001-02'
  AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261025_000947') = 1
  AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946') = 1);

SELECT pg_temp.proof('proof never used org 1005',
  NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 1005)
  AND NOT EXISTS (SELECT 1 FROM public.service_invoices WHERE organization_id = 1005));

\echo '---- proof results ----'
SELECT n, CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status, name, detail
FROM proof_results ORDER BY n;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM proof_results WHERE NOT ok) THEN
    RAISE EXCEPTION 'invoice uidx proof failed: %',
      (SELECT string_agg(name || coalesce(' (' || nullif(detail, '') || ')', ''), '; ' ORDER BY n)
       FROM proof_results WHERE NOT ok);
  END IF;
END $$;
