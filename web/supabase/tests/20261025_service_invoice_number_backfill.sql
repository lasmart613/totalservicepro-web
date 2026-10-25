-- Local proof for 20261025_000946_service_invoice_number_backfill.sql and its rollback.
-- Empty Postgres 17 database only. Refuses to run when public.service_invoices
-- already exists. Fixture orgs are 7001-7004. Never org 1005 (real customer).
--
--   createdb invoice_number_proof
--   psql "postgresql:///invoice_number_proof" -v ON_ERROR_STOP=1 \
--     -v mig=/path/to/20261025_000946_service_invoice_number_backfill.sql \
--     -v rb=/path/to/20261025_000946_service_invoice_number_backfill_rollback.sql \
--     -f web/supabase/tests/20261025_service_invoice_number_backfill.sql
--   dropdb invoice_number_proof
\set ON_ERROR_STOP on

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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, SELECT, UPDATE, DELETE, MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

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

-- ---------- drift: unique index missing, migration must abort ----------
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
INSERT INTO public.organizations (id, name, ticket_prefix, timezone)
VALUES (7001, 'Lumen', 'LPX', 'America/Los_Angeles');
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, invoice_data)
VALUES (1, 7001, '2026-10-01 20:00:00+00', NULL, '{"invoice_number":"SHOULD-NOT-STICK"}');

\set ON_ERROR_STOP off
\i :mig
\set ON_ERROR_STOP on
ROLLBACK;

SELECT pg_temp.proof(
  'drift missing index aborts before audit or NOT NULL',
  to_regclass('public.service_invoice_number_backfill_audit') IS NULL
  AND EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'invoice_number' AND NOT attnotnull AND NOT attisdropped
  )
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 1) IS NULL
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946')
);

DROP TABLE public.service_invoices;
DROP TABLE public.organizations;

-- ---------- fixture (orgs 7001-7004 only) ----------
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
  invoice_data jsonb,
  status text,
  customer_name text
);
CREATE UNIQUE INDEX service_invoices_org_number_uidx
  ON public.service_invoices (organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND btrim(invoice_number) <> '';

INSERT INTO public.organizations (id, name, ticket_prefix, timezone) VALUES
  (7001, 'Lumen', 'LPX', 'America/Los_Angeles'),
  (7002, 'Other Shop', 'ZZ', 'America/New_York'),
  (7003, 'Acme Lasers', NULL, 'America/Los_Angeles'),
  (7004, NULL, NULL, 'America/Los_Angeles');

INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, invoice_data, status) VALUES
  (1,  7001, '2026-10-01 20:00:00+00', 'LPX-INV-20261001-01', NULL, 'sent'),
  (2,  7001, '2026-10-01 21:00:00+00', 'LPX-INV-20261001-04', NULL, 'draft'),
  (8,  7001, '2026-10-20 18:00:00+00', 'LPX-INV-20261020-12', NULL, 'paid'),
  (3,  7001, '2026-10-02 20:00:00+00', NULL, '{"invoice_number":"LPX-INV-20261002-02"}', 'sent'),
  (4,  7001, '2026-10-03 20:00:00+00', NULL, '{"invNumber":"LPX-INV-20261003-09"}', 'partially_paid'),
  (9,  7001, '2026-10-04 20:00:00+00', NULL, '{"invoice_number":"  ","invNumber":"LPX-INV-20261004-08"}', 'partial'),
  (5,  7001, '2026-09-15 20:00:00+00', NULL, '{"invoice_number":"LPX-INV-20261001-01"}', 'sent'),
  (6,  7001, '2026-09-01 20:00:00+00', NULL, '{}', 'draft'),
  (7,  7001, '2026-10-20 20:00:00+00', NULL, NULL, 'paid'),
  (20, 7002, '2026-10-01 20:00:00+00', 'ZZ-INV-20261001-03', NULL, 'sent'),
  (21, 7002, '2026-08-01 20:00:00+00', NULL, '{"invoice_number":"15"}', 'paid'),
  (22, 7002, '2026-08-02 20:00:00+00', NULL, NULL, 'draft'),
  (50, 7002, '2026-08-03 20:00:00+00', NULL, '{"invNumber":"15"}', 'partial'),
  (30, 7003, '2026-09-01 20:00:00+00', NULL, NULL, 'draft'),
  (40, 7004, '2026-09-01 20:00:00+00', NULL, NULL, 'draft');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = 1005)
     OR EXISTS (SELECT 1 FROM public.service_invoices WHERE organization_id = 1005) THEN
    RAISE EXCEPTION 'refusing to run: org 1005 is a real customer';
  END IF;
END $$;

GRANT INSERT, SELECT, UPDATE ON public.service_invoices TO authenticated;

\i :mig

SELECT pg_temp.proof('json invoice_number key',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 3) = 'LPX-INV-20261002-02');
SELECT pg_temp.proof('json invNumber key',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 4) = 'LPX-INV-20261003-09');
SELECT pg_temp.proof('blank invoice_number falls through to invNumber',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 9) = 'LPX-INV-20261004-08');
SELECT pg_temp.proof('json collision is not copied',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 5) IS DISTINCT FROM 'LPX-INV-20261001-01');
SELECT pg_temp.proof('plain numeric json is copied',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 21) = '15');
SELECT pg_temp.proof('duplicate json number is sequenced instead',
  (SELECT source FROM public.service_invoice_number_backfill_audit WHERE invoice_id = '50') = 'sequence');

-- Max numeric on 7001 after JSON is 12 (LPX-INV-20261020-12). Remaining nulls
-- in created_at order continue 13, 14, 15 and must not reuse -12.
SELECT pg_temp.proof('per-org sequence oldest',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 6) = 'LPX-INV-20260901-13');
SELECT pg_temp.proof('per-org sequence middle',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 5) = 'LPX-INV-20260915-14');
SELECT pg_temp.proof('collision with existing same-day number is skipped',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 7) = 'LPX-INV-20261020-15');
SELECT pg_temp.proof('pre-existing numbers stay',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 1) = 'LPX-INV-20261001-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 2) = 'LPX-INV-20261001-04'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 8) = 'LPX-INV-20261020-12'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 20) = 'ZZ-INV-20261001-03');
SELECT pg_temp.proof('other org continues after its own max',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 22) = 'ZZ-INV-20260802-16'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 50) = 'ZZ-INV-20260803-17');
SELECT pg_temp.proof('prefix from org name when ticket_prefix is null',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 30) = 'ACM-INV-20260901-01');
SELECT pg_temp.proof('prefix TSP when org has no prefix or name',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 40) = 'TSP-INV-20260901-01');

SELECT pg_temp.proof('audit maps every filled id and nothing else',
  (SELECT count(*) FROM public.service_invoice_number_backfill_audit) = 11
  AND (SELECT count(*) FROM public.service_invoice_number_backfill_audit WHERE source = 'json') = 4
  AND (SELECT count(*) FROM public.service_invoice_number_backfill_audit WHERE old_invoice_number IS NULL) = 11
  AND NOT EXISTS (
    SELECT 1 FROM public.service_invoice_number_backfill_audit a
    JOIN public.service_invoices si ON si.id::text = a.invoice_id
    WHERE si.invoice_number IS DISTINCT FROM a.new_invoice_number
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.service_invoice_number_backfill_audit
    WHERE invoice_id IN ('1', '2', '8', '20')
  ));

SELECT pg_temp.proof('invoice_number is NOT NULL',
  (SELECT attnotnull FROM pg_attribute
   WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number' AND NOT attisdropped));

SELECT pg_temp.proof('audit RLS on and closed to anon/authenticated',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.service_invoice_number_backfill_audit'::regclass)
  AND NOT has_table_privilege('anon', 'public.service_invoice_number_backfill_audit', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.service_invoice_number_backfill_audit', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.service_invoice_number_backfill_audit', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.service_invoice_number_backfill_audit', 'INSERT,UPDATE,DELETE')
  AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.service_invoice_number_backfill_audit'::regclass) = 0);

SELECT pg_temp.proof('allocator functions are not executable by anon/authenticated',
  NOT has_function_privilege('anon', 'public.service_invoice_next_number(bigint,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.service_invoice_next_number(bigint,timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.service_invoices_assign_invoice_number()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.service_invoice_number_seq(text)', 'EXECUTE'));

SELECT pg_temp.proof('schema_migrations records 20261025_000946',
  (SELECT name FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946')
    = 'service_invoice_number_backfill');

-- Idempotent re-apply.
\i :mig
SELECT pg_temp.proof('re-apply does not renumber or duplicate audit rows',
  (SELECT count(*) FROM public.service_invoice_number_backfill_audit) = 11
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 6) = 'LPX-INV-20260901-13'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 7) = 'LPX-INV-20261020-15'
  AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946') = 1);

-- Trigger: explicit number kept, null and blank assigned, collision skipped.
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, status)
VALUES (60, 7001, '2026-11-01 20:00:00+00', 'LPX-KEEP-9', 'draft');
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, status)
VALUES (61, 7001, '2026-11-02 20:00:00+00', NULL, 'paid');
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, status)
VALUES (62, 7001, '2026-12-15 20:00:00+00', 'LPX-INV-20261215-17', 'sent');
INSERT INTO public.service_invoices (id, organization_id, created_at, status)
VALUES (63, 7001, '2026-12-15 20:00:00+00', 'partial');
INSERT INTO public.service_invoices (id, organization_id, created_at, invoice_number, status)
VALUES (64, 7001, '2026-12-16 20:00:00+00', '   ', 'partially_paid');

SELECT pg_temp.proof('trigger keeps an explicit number',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 60) = 'LPX-KEEP-9');
SELECT pg_temp.proof('trigger assigns next per-org number when null',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 61) = 'LPX-INV-20261102-16');
SELECT pg_temp.proof('trigger skips a number the unique index already holds',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 63) = 'LPX-INV-20261215-18');
SELECT pg_temp.proof('trigger assigns when the insert sends a blank',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 64) = 'LPX-INV-20261216-19');

SET ROLE authenticated;
INSERT INTO public.service_invoices (id, organization_id, created_at, status)
VALUES (65, 7002, '2026-08-04 20:00:00+00', 'paid');
RESET ROLE;
SELECT pg_temp.proof('trigger assigns under authenticated (definer + advisory lock)',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 65) = 'ZZ-INV-20260804-18');

-- Bookkeeping failure rolls the backfill back.
\i :rb
SELECT pg_temp.proof('rollback nulls exactly the rows it filled',
  (SELECT count(*) FROM public.service_invoices
    WHERE id IN (3, 4, 9, 5, 6, 7, 21, 22, 50, 30, 40) AND invoice_number IS NULL) = 11);
SELECT pg_temp.proof('rollback keeps pre-existing and trigger-assigned numbers',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 1) = 'LPX-INV-20261001-01'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 8) = 'LPX-INV-20261020-12'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 61) = 'LPX-INV-20261102-16'
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 63) = 'LPX-INV-20261215-18');
SELECT pg_temp.proof('rollback drops trigger, NOT NULL, audit, functions, and version',
  NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'service_invoices_assign_invoice_number'
      AND tgrelid = 'public.service_invoices'::regclass AND NOT tgisinternal
  )
  AND NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number')
  AND to_regclass('public.service_invoice_number_backfill_audit') IS NULL
  AND to_regprocedure('public.service_invoice_next_number(bigint,timestamptz)') IS NULL
  AND to_regprocedure('public.service_invoices_assign_invoice_number()') IS NULL
  AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261025_000946'));

-- A later edit is not wiped. JSON id 3 is filled with the same number again.
\i :mig
UPDATE public.service_invoices SET invoice_number = 'EDITED-1' WHERE id = 3;
\i :rb
SELECT pg_temp.proof('rollback leaves a number edited after the backfill',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 3) = 'EDITED-1');
SELECT pg_temp.proof('rollback still nulls the other filled rows',
  (SELECT invoice_number FROM public.service_invoices WHERE id = 6) IS NULL
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 30) IS NULL
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 1) = 'LPX-INV-20261001-01');

-- Missing schema_migrations aborts the whole migration, including the backfill.
DROP TABLE supabase_migrations.schema_migrations;
\set ON_ERROR_STOP off
\i :mig
\set ON_ERROR_STOP on
ROLLBACK;
SELECT pg_temp.proof('missing schema_migrations rolls back the backfill',
  to_regclass('public.service_invoice_number_backfill_audit') IS NULL
  AND NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.service_invoices'::regclass AND attname = 'invoice_number')
  AND (SELECT invoice_number FROM public.service_invoices WHERE id = 6) IS NULL);

CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);

SELECT pg_temp.proof('proof never used org 1005',
  NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 1005)
  AND NOT EXISTS (SELECT 1 FROM public.service_invoices WHERE organization_id = 1005));

\echo '---- proof results ----'
SELECT n, CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS status, name, detail
FROM proof_results ORDER BY n;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM proof_results WHERE NOT ok) THEN
    RAISE EXCEPTION 'invoice number proof failed: %',
      (SELECT string_agg(name || coalesce(' (' || nullif(detail, '') || ')', ''), '; ' ORDER BY n)
       FROM proof_results WHERE NOT ok);
  END IF;
END $$;
