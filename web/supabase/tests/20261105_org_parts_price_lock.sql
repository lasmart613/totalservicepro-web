-- Isolated proof for the 000951 price lockdown.
-- Empty PostgreSQL 16 database only. Refuses to run if parts_catalog already exists.
-- Replays the 000700 table INSERT and the 000401 column UPDATE, then the 000951
-- revoke/regrant. Does not connect to production.
--
--   createdb parts_price_lock_proof
--   psql "postgresql:///parts_price_lock_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261105_org_parts_price_lock.sql
--   dropdb parts_price_lock_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.parts_catalog') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.parts_catalog already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE public.parts_catalog (
  id bigserial PRIMARY KEY,
  part_number text,
  name text,
  description text,
  brand text,
  sale_price numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid
);
CREATE TABLE public.part_vendors (
  id bigserial PRIMARY KEY,
  part_id bigint,
  vendor_name text,
  vendor_part_number text,
  unit_cost numeric,
  currency text,
  lead_time_days integer,
  url text,
  notes text,
  is_preferred boolean,
  is_active boolean,
  created_by uuid
);

-- Inherited grants the lockdown has to beat: 000700 table INSERT/UPDATE and
-- 000401 column UPDATE (every catalog column except created_by, including sale_price).
GRANT SELECT, INSERT ON TABLE public.parts_catalog TO authenticated;
GRANT UPDATE (is_active) ON TABLE public.parts_catalog TO authenticated;
GRANT UPDATE (part_number, name, description, brand, sale_price, is_active)
  ON TABLE public.parts_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.part_vendors TO authenticated;
GRANT INSERT ON TABLE public.parts_catalog TO PUBLIC;
GRANT INSERT ON TABLE public.part_vendors TO PUBLIC;

DO $$ BEGIN
  IF NOT has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'INSERT') THEN
    RAISE EXCEPTION 'setup failed: table INSERT should still allow sale_price before lockdown';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.part_vendors', 'unit_cost', 'INSERT') THEN
    RAISE EXCEPTION 'setup failed: table INSERT should still allow unit_cost before lockdown';
  END IF;
END $$;

-- Same lockdown as 20261105_000951_org_parts_inventory_bom.sql.
REVOKE ALL ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  r record;
  v_cols text;
BEGIN
  FOR r IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated', r.attname);
  END LOOP;
  FOR r IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated', r.attname);
  END LOOP;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'sale_price';
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.parts_catalog TO anon, authenticated', v_cols);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.parts_catalog TO authenticated', v_cols);
  GRANT UPDATE (is_active) ON TABLE public.parts_catalog TO authenticated;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> ALL (ARRAY['unit_cost', 'currency']);
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.part_vendors TO anon, authenticated', v_cols);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.part_vendors'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> ALL (ARRAY['id', 'part_id', 'created_by', 'unit_cost', 'currency']);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.part_vendors TO authenticated', v_cols);
  EXECUTE format('GRANT UPDATE (%s) ON TABLE public.part_vendors TO authenticated', v_cols);
  GRANT INSERT (part_id, created_by) ON TABLE public.part_vendors TO authenticated;
END $$;

DO $$ BEGIN
  IF has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'INSERT')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'SELECT')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'UPDATE') THEN
    RAISE EXCEPTION 'sale_price is still granted to authenticated';
  END IF;
  IF has_column_privilege('authenticated', 'public.parts_catalog', 'name', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'created_by', 'UPDATE') THEN
    RAISE EXCEPTION 'parts_catalog UPDATE is broader than is_active';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.parts_catalog', 'is_active', 'UPDATE') THEN
    RAISE EXCEPTION 'is_active UPDATE was removed';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.parts_catalog', 'name', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.parts_catalog', 'name', 'INSERT') THEN
    RAISE EXCEPTION 'non-price catalog columns are not usable';
  END IF;
  IF has_column_privilege('authenticated', 'public.part_vendors', 'unit_cost', 'INSERT')
     OR has_column_privilege('authenticated', 'public.part_vendors', 'unit_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.part_vendors', 'unit_cost', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.part_vendors', 'currency', 'SELECT') THEN
    RAISE EXCEPTION 'vendor price columns are still granted';
  END IF;
  IF has_column_privilege('authenticated', 'public.part_vendors', 'created_by', 'UPDATE') THEN
    RAISE EXCEPTION 'part_vendors.created_by UPDATE was reopened';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.part_vendors', 'vendor_name', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.part_vendors', 'created_by', 'INSERT') THEN
    RAISE EXCEPTION 'vendor name update or created_by insert was removed';
  END IF;
  IF has_column_privilege('public', 'public.parts_catalog', 'sale_price', 'INSERT') THEN
    RAISE EXCEPTION 'PUBLIC can still insert sale_price';
  END IF;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.parts_catalog (name, sale_price) VALUES ('probe', 50);
    RAISE EXCEPTION 'authenticated inserted sale_price';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM sale_price FROM public.parts_catalog;
    RAISE EXCEPTION 'authenticated selected sale_price';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  INSERT INTO public.parts_catalog (name, is_active) VALUES ('ok', true);
  BEGIN
    UPDATE public.parts_catalog SET name = 'rewritten' WHERE name = 'ok';
    RAISE EXCEPTION 'authenticated updated name';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.parts_catalog SET created_by = '00000000-0000-0000-0000-000000000009' WHERE name = 'ok';
    RAISE EXCEPTION 'authenticated updated created_by';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  UPDATE public.parts_catalog SET is_active = false WHERE name = 'ok';
  INSERT INTO public.part_vendors (part_id, vendor_name, created_by)
  VALUES (1, 'Candela', '00000000-0000-0000-0000-000000000001');
  BEGIN
    INSERT INTO public.part_vendors (part_id, vendor_name, unit_cost)
    VALUES (1, 'Candela', 4.25);
    RAISE EXCEPTION 'authenticated inserted unit_cost';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    UPDATE public.part_vendors SET created_by = '00000000-0000-0000-0000-000000000009' WHERE vendor_name = 'Candela';
    RAISE EXCEPTION 'authenticated updated vendor created_by';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  UPDATE public.part_vendors SET vendor_name = 'Candela Direct' WHERE vendor_name = 'Candela';
END $$;

-- No tracked view. An owner view would bypass column privileges; prove that,
-- then drop it so this database does not keep the leak.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
     WHERE schemaname = 'public' AND definition ILIKE '%sale_price%'
  ) THEN
    RAISE EXCEPTION 'a view already exposes sale_price';
  END IF;
END $$;
CREATE VIEW public.parts_price_owner_leak AS SELECT id, sale_price FROM public.parts_catalog;
GRANT SELECT ON public.parts_price_owner_leak TO authenticated;
DO $$
DECLARE
  n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.parts_price_owner_leak;
  IF n < 0 THEN
    RAISE EXCEPTION 'owner view probe failed unexpectedly';
  END IF;
END $$;
DROP VIEW public.parts_price_owner_leak;

CREATE PUBLICATION supabase_realtime FOR TABLE public.parts_catalog, public.part_vendors;
DO $$
DECLARE
  v_cols text;
  v_all boolean;
BEGIN
  SELECT puballtables INTO v_all FROM pg_publication WHERE pubname = 'supabase_realtime';
  IF v_all THEN
    RAISE EXCEPTION 'test publication should not be FOR ALL TABLES';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND n.nspname = 'public' AND c.relname = 'parts_catalog'
  ) THEN
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname <> 'sale_price';
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.parts_catalog';
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.parts_catalog (%s)', v_cols);
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'sale_price'
     WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND c.relname = 'parts_catalog'
       AND (pr.prattrs IS NULL OR a.attnum = ANY (pr.prattrs))
  ) THEN
    RAISE EXCEPTION 'realtime publication still includes sale_price';
  END IF;
END $$;

-- Rollback shape: price SELECT returns, price INSERT and created_by UPDATE do not.
REVOKE ALL ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.part_vendors FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
  r record;
  v_cols text;
BEGIN
  FOR r IN
    SELECT a.attname FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated', r.attname);
  END LOOP;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.parts_catalog TO anon, authenticated', v_cols);
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.parts_catalog'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'sale_price';
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.parts_catalog TO authenticated', v_cols);
  GRANT UPDATE (is_active) ON TABLE public.parts_catalog TO authenticated;
END $$;
DO $$ BEGIN
  IF NOT has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'SELECT') THEN
    RAISE EXCEPTION 'rollback should restore sale_price SELECT';
  END IF;
  IF has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'INSERT')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'created_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.parts_catalog', 'name', 'UPDATE') THEN
    RAISE EXCEPTION 'rollback reopened a price or identity write';
  END IF;
END $$;
