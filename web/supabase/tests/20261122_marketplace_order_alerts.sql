-- Local proof for 20261122_000973_marketplace_order_alerts.sql and its rollback.
-- Scratch database only. Refuses to run when public.marketplace_order_alerts
-- already exists. Never point this at production.
--
--   createdb marketplace_order_alerts_proof
--   psql "postgresql:///marketplace_order_alerts_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261122_marketplace_order_alerts.sql
--   dropdb marketplace_order_alerts_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.marketplace_order_alerts') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.marketplace_order_alerts already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Supabase's service_role bypasses RLS. Match that on this scratch cluster.
ALTER ROLE service_role BYPASSRLS;

CREATE TABLE public.marketplace_orders (
  id uuid PRIMARY KEY
);

INSERT INTO public.marketplace_orders (id) VALUES
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

\ir ../migrations/20261122_000973_marketplace_order_alerts.sql

DO $$
DECLARE
  v_rls boolean;
  v_policies integer;
  v_inserted integer;
  v_rows integer;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'marketplace_order_alerts';
  IF v_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'marketplace_order_alerts RLS is not enabled';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'marketplace_order_alerts';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'marketplace_order_alerts has % member policies', v_policies;
  END IF;

  IF has_table_privilege('authenticated', 'public.marketplace_order_alerts', 'INSERT')
     OR has_table_privilege('anon', 'public.marketplace_order_alerts', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.marketplace_order_alerts', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.marketplace_order_alerts', 'DELETE') THEN
    RAISE EXCEPTION 'marketplace_order_alerts grants are not service_role only';
  END IF;

  INSERT INTO public.marketplace_order_alerts (order_id, status)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stock_pending')
  ON CONFLICT (order_id, status) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'first claim inserted % rows', v_inserted;
  END IF;

  INSERT INTO public.marketplace_order_alerts (order_id, status)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stock_pending')
  ON CONFLICT (order_id, status) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 0 THEN
    RAISE EXCEPTION 'duplicate claim inserted % rows', v_inserted;
  END IF;

  INSERT INTO public.marketplace_order_alerts (order_id, status)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'refund_review')
  ON CONFLICT (order_id, status) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'status change inserted % rows', v_inserted;
  END IF;

  SELECT count(*) INTO v_rows FROM public.marketplace_order_alerts
  WHERE order_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 alert rows, found %', v_rows;
  END IF;

  DELETE FROM public.marketplace_order_alerts
  WHERE order_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    AND status = 'stock_pending';
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'release deleted % rows', v_inserted;
  END IF;

  INSERT INTO public.marketplace_order_alerts (order_id, status)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stock_pending')
  ON CONFLICT (order_id, status) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'claim after release inserted % rows', v_inserted;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._000973_try_member_insert() RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.marketplace_order_alerts (order_id, status)
  VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'stock_pending');
  RAISE EXCEPTION 'member insert was allowed';
EXCEPTION
  WHEN insufficient_privilege THEN
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public._000973_try_member_insert() TO authenticated, anon;

SET ROLE authenticated;
SELECT public._000973_try_member_insert();
RESET ROLE;

SET ROLE anon;
SELECT public._000973_try_member_insert();
RESET ROLE;

SET ROLE service_role;
INSERT INTO public.marketplace_order_alerts (order_id, status)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'refund_review')
ON CONFLICT (order_id, status) DO NOTHING;
RESET ROLE;

DO $$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM public.marketplace_order_alerts
  WHERE order_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    AND status = 'refund_review';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'service_role claim did not insert';
  END IF;
END $$;

DROP FUNCTION public._000973_try_member_insert();

\ir ../migrations/20261122_000973_marketplace_order_alerts_rollback.sql

DO $$ BEGIN
  IF to_regclass('public.marketplace_order_alerts') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left marketplace_order_alerts in place';
  END IF;
  IF to_regclass('public.marketplace_orders') IS NULL THEN
    RAISE EXCEPTION 'rollback dropped marketplace_orders';
  END IF;
END $$;

\ir ../migrations/20261122_000973_marketplace_order_alerts.sql

INSERT INTO public.marketplace_order_alerts (order_id, status)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'stock_pending')
ON CONFLICT (order_id, status) DO NOTHING;

SELECT '000973 proof ok' AS status;
