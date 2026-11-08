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

-- A grant to another role survives REVOKE FROM authenticated when authenticated
-- inherits that role. 000951 must see qa_legacy_grant and stop. This test then
-- removes that grant itself, which is the reviewed follow-up, not the migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_legacy_grant') THEN
    CREATE ROLE qa_legacy_grant NOLOGIN;
  END IF;
END $$;
GRANT SELECT, INSERT ON TABLE public.parts_catalog TO qa_legacy_grant;
GRANT qa_legacy_grant TO authenticated;
DO $$
BEGIN
  REVOKE ALL ON TABLE public.parts_catalog FROM PUBLIC, anon, authenticated;
  IF NOT has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.parts_catalog', 'sale_price', 'INSERT') THEN
    RAISE EXCEPTION 'expected inherited qa_legacy_grant SELECT and INSERT to survive';
  END IF;
  RAISE EXCEPTION 'rollback inherited proof';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%rollback inherited proof%' THEN
      RAISE;
    END IF;
END $$;
DO $$
DECLARE
  v_hits text;
BEGIN
  SELECT string_agg(DISTINCT gr.rolname, ', ') INTO v_hits
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    JOIN pg_roles gr ON gr.oid = acl.grantee
   WHERE c.relname = 'parts_catalog'
     AND acl.privilege_type IN ('SELECT', 'INSERT')
     AND gr.rolname = 'qa_legacy_grant';
  IF v_hits IS NULL THEN
    RAISE EXCEPTION 'preflight missed qa_legacy_grant';
  END IF;
END $$;
REVOKE ALL ON TABLE public.parts_catalog FROM qa_legacy_grant;
REVOKE qa_legacy_grant FROM authenticated;

CREATE VIEW public.parts_price_owner_leak AS SELECT id, sale_price FROM public.parts_catalog;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'parts_price_owner_leak' AND c.relkind = 'v'
      AND pg_get_viewdef(c.oid, true) ILIKE '%sale_price%'
      AND coalesce(array_to_string(c.reloptions, ','), '') NOT ILIKE '%security_invoker=true%'
  ) THEN
    RAISE EXCEPTION 'owner view should fail the preflight';
  END IF;
END $$;
DROP VIEW public.parts_price_owner_leak;

CREATE PUBLICATION supabase_realtime FOR ALL TABLES;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND puballtables) THEN
    RAISE EXCEPTION 'FOR ALL TABLES publication should fail the preflight';
  END IF;
END $$;
DROP PUBLICATION supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE public.parts_catalog;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'sale_price'
     WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND (pr.prattrs IS NULL OR a.attnum = ANY (pr.prattrs))
  ) THEN
    RAISE EXCEPTION 'all-column publication should fail the preflight';
  END IF;
END $$;
DROP PUBLICATION supabase_realtime;

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
  GRANT DELETE ON TABLE public.part_vendors TO authenticated;
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

-- A publication that already omits the price column passes the preflight.
-- 000951 does not rewrite publications.
CREATE PUBLICATION supabase_realtime FOR TABLE public.parts_catalog (id, name);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'sale_price'
     WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND (pr.prattrs IS NULL OR a.attnum = ANY (pr.prattrs))
  ) THEN
    RAISE EXCEPTION 'column-list publication still includes sale_price';
  END IF;
END $$;
DROP PUBLICATION supabase_realtime;

-- Authorized vendor delete matches 000800 part_vendors_delete_owner.
-- Anon has no DELETE privilege (42501). A signed-in stranger deletes zero rows.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE IF NOT EXISTS public.organization_memberships (
  user_id uuid,
  organization_id bigint,
  role text,
  is_home boolean
);
CREATE OR REPLACE FUNCTION public.caller_is_part_creator_admin(p_creator uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET row_security = off AS $$
  WITH creator_orgs AS (
    SELECT organization_id, is_home FROM public.organization_memberships WHERE user_id = p_creator
  ), scope AS (
    SELECT organization_id FROM creator_orgs
    WHERE is_home OR NOT EXISTS (SELECT 1 FROM creator_orgs WHERE is_home)
  )
  SELECT p_creator IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_memberships a
    JOIN scope s ON s.organization_id = a.organization_id
    WHERE a.user_id = auth.uid() AND lower(btrim(a.role)) IN ('admin', 'company_admin'));
$$;
GRANT EXECUTE ON FUNCTION public.caller_is_part_creator_admin(uuid) TO authenticated;

INSERT INTO public.parts_catalog (id, name, created_by) VALUES
  (101, 'owned', '00000000-0000-0000-0000-00000000000a'),
  (102, 'other', '00000000-0000-0000-0000-00000000000e');
INSERT INTO public.part_vendors (id, part_id, vendor_name, created_by) VALUES
  (201, 101, 'owner vendor', '00000000-0000-0000-0000-00000000000a'),
  (202, 101, 'catalog vendor', '00000000-0000-0000-0000-00000000000b'),
  (203, 102, 'stranger vendor', '00000000-0000-0000-0000-00000000000e');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-00000000000a', 7, 'tech', true),
  ('00000000-0000-0000-0000-00000000000c', 7, 'company_admin', true),
  ('00000000-0000-0000-0000-00000000000d', 8, 'company_admin', true);

ALTER TABLE public.parts_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parts_catalog_read ON public.parts_catalog;
CREATE POLICY parts_catalog_read ON public.parts_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS part_vendors_read ON public.part_vendors;
CREATE POLICY part_vendors_read ON public.part_vendors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS part_vendors_delete_owner ON public.part_vendors;
CREATE POLICY part_vendors_delete_owner ON public.part_vendors
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.parts_catalog p
      WHERE p.id = part_vendors.part_id AND p.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.parts_catalog p
      WHERE p.id = part_vendors.part_id
        AND public.caller_is_part_creator_admin(p.created_by)
    )
  );

DO $$ BEGIN
  IF NOT has_table_privilege('authenticated', 'public.part_vendors', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated lost part_vendors DELETE';
  END IF;
  IF has_table_privilege('anon', 'public.part_vendors', 'DELETE') THEN
    RAISE EXCEPTION 'anon was granted part_vendors DELETE';
  END IF;
END $$;

DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.part_vendors WHERE id = 201;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'stranger deleted % vendor rows', n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'stranger DELETE returned 42501; RLS should hide the row instead';
END $$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    DELETE FROM public.part_vendors WHERE id = 201;
    RAISE EXCEPTION 'anon delete succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.part_vendors WHERE id = 201;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'vendor creator deleted % rows', n;
  END IF;
  DELETE FROM public.part_vendors WHERE id = 202;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'catalog creator deleted % rows', n;
  END IF;
END $$;

DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.part_vendors WHERE id = 203;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'admin of another org deleted % rows', n;
  END IF;
END $$;

INSERT INTO public.part_vendors (id, part_id, vendor_name, created_by)
VALUES (204, 101, 'admin vendor', '00000000-0000-0000-0000-00000000000b');

DO $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.part_vendors WHERE id = 203;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'creator admin deleted a part owned by someone else (% rows)', n;
  END IF;
  DELETE FROM public.part_vendors WHERE id = 204;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'creator admin deleted % rows', n;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.part_vendors WHERE id IN (201, 202, 204)) THEN
    RAISE EXCEPTION 'authorized deletes left vendor rows behind';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.part_vendors WHERE id = 203) THEN
    RAISE EXCEPTION 'unauthorized delete removed the stranger vendor';
  END IF;
END $$;

-- Hold trigger: other manuals stay held until every seeded source file is
-- recorded finished and manual 9 is extracted or no_bom.
CREATE TABLE public.manual_nine_source (
  storage_path text PRIMARY KEY,
  status text NOT NULL
);
CREATE TABLE public.manual_bom_sweep (
  manual_id bigint PRIMARY KEY,
  status text NOT NULL
);
INSERT INTO public.manual_nine_source VALUES ('a.pdf', 'pending'), ('b.pdf', 'error');
INSERT INTO public.manual_bom_sweep VALUES (9, 'pending');
CREATE OR REPLACE FUNCTION public.manual_bom_sweep_hold_proof()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ready boolean;
BEGIN
  IF NEW.manual_id IS NOT DISTINCT FROM 9 THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('pending', 'error') THEN
    RETURN NEW;
  END IF;
  SELECT count(*) = 2 AND coalesce(bool_and(status IN ('extracted', 'no_line_items')), false)
    INTO v_ready FROM public.manual_nine_source;
  IF NOT v_ready THEN
    RAISE EXCEPTION '000951: refusing to queue manual % until all 37 Mini GentleYAG source files are recorded extracted or no_line_items', NEW.manual_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manual_bom_sweep WHERE manual_id = 9 AND status IN ('extracted', 'no_bom')) THEN
    RAISE EXCEPTION '000951: refusing to queue manual % until manuals.id 9 is extracted or no_bom', NEW.manual_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER manual_bom_sweep_hold_proof
  BEFORE INSERT OR UPDATE ON public.manual_bom_sweep
  FOR EACH ROW EXECUTE FUNCTION public.manual_bom_sweep_hold_proof();
DO $$
BEGIN
  BEGIN
    INSERT INTO public.manual_bom_sweep VALUES (40, 'pending');
    RAISE EXCEPTION 'partial source inventory queued another manual';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 40%' THEN RAISE; END IF;
  END;
  INSERT INTO public.manual_bom_sweep VALUES (40, 'held');
  UPDATE public.manual_nine_source SET status = 'extracted' WHERE storage_path = 'a.pdf';
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'pending' WHERE manual_id = 40;
    RAISE EXCEPTION 'error source still queued another manual';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 40%' THEN RAISE; END IF;
  END;
  UPDATE public.manual_nine_source SET status = 'no_line_items' WHERE storage_path = 'b.pdf';
  BEGIN
    UPDATE public.manual_bom_sweep SET status = 'pending' WHERE manual_id = 40;
    RAISE EXCEPTION 'manual 9 still pending queued another manual';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%refusing to queue manual 40%' THEN RAISE; END IF;
  END;
  UPDATE public.manual_bom_sweep SET status = 'extracted' WHERE manual_id = 9;
  UPDATE public.manual_bom_sweep SET status = 'pending' WHERE manual_id = 40;
  IF NOT EXISTS (SELECT 1 FROM public.manual_bom_sweep WHERE manual_id = 40 AND status = 'pending') THEN
    RAISE EXCEPTION 'completed source inventory did not release manual 40';
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
