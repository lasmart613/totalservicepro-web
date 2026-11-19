-- Local proof for 20261119_000964_customer_equipment_record.sql and its rollback.
-- Empty Postgres scratch database only. Never a live database.
-- Fixture orgs are 9301, 9304, and 9309. Live orgs 4, 153, 154, 1005, 2616,
-- 5509, 5515, and 5516 are refused.
--
--   createdb equipment_record_proof
--   psql "postgresql:///equipment_record_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261119_000964_customer_equipment_record.sql
--   dropdb equipment_record_proof
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  type text
);
CREATE TABLE public.organization_memberships (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL REFERENCES public.organizations(id),
  role text,
  UNIQUE (user_id, organization_id)
);
CREATE TABLE public.organization_customers (
  id bigserial PRIMARY KEY,
  service_organization_id bigint REFERENCES public.organizations(id),
  customer_organization_id bigint REFERENCES public.organizations(id)
);
CREATE TABLE public.locations (
  id bigint PRIMARY KEY,
  organization_id bigint REFERENCES public.organizations(id),
  name text NOT NULL
);
-- The existing customer unit. New columns are added by 000964, not a new table.
CREATE TABLE public.equipment (
  id bigint PRIMARY KEY,
  customer_organization_id bigint REFERENCES public.organizations(id),
  manufacturer text NOT NULL,
  model text NOT NULL,
  serial_number text,
  notes text,
  location_id bigint REFERENCES public.locations(id)
);
CREATE TABLE public.service_tickets (
  id bigint PRIMARY KEY,
  organization_id bigint,
  customer_organization_id bigint,
  equipment_id bigint REFERENCES public.equipment(id),
  ticket_number text
);
CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY,
  organization_id bigint,
  customer_organization_id bigint,
  equipment_id bigint REFERENCES public.equipment(id),
  report_number text
);

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = auth.uid() AND m.organization_id = p_org
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(bigint) TO authenticated;

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipment_member_select ON public.equipment
  FOR SELECT TO authenticated
  USING (public.is_active_org_member(customer_organization_id));
CREATE POLICY equipment_facility_manage ON public.equipment
  FOR ALL TO authenticated
  USING (public.is_active_org_member(customer_organization_id))
  WITH CHECK (public.is_active_org_member(customer_organization_id));
CREATE POLICY equipment_service_org_manage ON public.equipment
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.customer_organization_id = equipment.customer_organization_id
        AND public.is_active_org_member(oc.service_organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.customer_organization_id = equipment.customer_organization_id
        AND public.is_active_org_member(oc.service_organization_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment TO authenticated;
GRANT SELECT ON public.organization_customers TO authenticated;
GRANT SELECT ON public.service_tickets, public.service_reports TO authenticated;

-- 9301 service shop, 9304 customer clinic, 9309 unrelated org.
INSERT INTO public.organizations (id, name, type) VALUES
  (9301, 'Proof Shop', 'service_company'),
  (9304, 'Proof Clinic', 'customer'),
  (9309, 'Other Shop', 'service_company');
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 9301, 'company_admin'),
  ('00000000-0000-0000-0000-0000000000d4', 9304, 'owner'),
  ('00000000-0000-0000-0000-0000000000f9', 9309, 'company_admin');
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id)
  VALUES (9301, 9304);
INSERT INTO public.locations (id, organization_id, name) VALUES (31, 9304, 'Surgery');
INSERT INTO public.equipment (id, customer_organization_id, manufacturer, model, serial_number, location_id)
  VALUES (1, 9304, 'Candela', 'GentleMax Pro', 'SN-1', 31);
INSERT INTO public.service_tickets (id, organization_id, customer_organization_id, equipment_id, ticket_number)
  VALUES (70, 9301, 9304, 1, 'T-70');
INSERT INTO public.service_reports (id, organization_id, customer_organization_id, equipment_id, report_number)
  VALUES ('00000000-0000-0000-0000-000000000070', 9301, 9304, 1, 'SR-1');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id IN (4, 153, 154, 1005, 2616, 5509, 5515, 5516)
  ) THEN
    RAISE EXCEPTION 'refusing to run: live org id present';
  END IF;
END $$;

\ir ../migrations/20261119_000964_customer_equipment_record.sql
\ir ../migrations/20261119_000964_customer_equipment_record.sql

DO $$
DECLARE
  v_install text;
  v_warranty text;
  v_removed text;
BEGIN
  IF to_regclass('public.customer_equipment') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL a second equipment table was created';
  END IF;
  SELECT data_type INTO v_install FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'install_date';
  SELECT data_type INTO v_warranty FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'warranty_or_contract';
  SELECT data_type INTO v_removed FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'removed_at';
  IF v_install IS DISTINCT FROM 'date' THEN RAISE EXCEPTION 'FAIL install_date type %', v_install; END IF;
  IF v_warranty IS DISTINCT FROM 'text' THEN RAISE EXCEPTION 'FAIL warranty type %', v_warranty; END IF;
  IF v_removed IS DISTINCT FROM 'timestamp with time zone' THEN RAISE EXCEPTION 'FAIL removed_at type %', v_removed; END IF;
  IF NOT has_column_privilege('authenticated', 'public.equipment', 'install_date', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated cannot update install_date';
  END IF;
  IF has_column_privilege('anon', 'public.equipment', 'warranty_or_contract', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon can read warranty_or_contract';
  END IF;
  RAISE NOTICE 'PASS columns and grants';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u, false);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;

-- Customer member can write the new columns.
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000d4');
SET ROLE authenticated;
UPDATE public.equipment
  SET install_date = DATE '2024-03-01', warranty_or_contract = 'Contract 42'
  WHERE id = 1;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT install_date FROM public.equipment WHERE id = 1) IS DISTINCT FROM DATE '2024-03-01' THEN
    RAISE EXCEPTION 'FAIL customer member did not save install_date';
  END IF;
  IF (SELECT warranty_or_contract FROM public.equipment WHERE id = 1) IS DISTINCT FROM 'Contract 42' THEN
    RAISE EXCEPTION 'FAIL customer member did not save warranty';
  END IF;
  RAISE NOTICE 'PASS customer member writes new columns';
END $$;

-- Linked service-shop member, not a member of the customer org, can read them.
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
SET ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.equipment WHERE warranty_or_contract = 'Contract 42';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL linked shop could not read equipment'; END IF;
  RAISE NOTICE 'PASS linked service org reads equipment';
END $$;
RESET ROLE;

-- Unrelated org sees nothing.
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000000f9');
SET ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.equipment;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL stranger saw % equipment rows', n; END IF;
  UPDATE public.equipment SET notes = 'stolen' WHERE id = 1;
  RAISE NOTICE 'PASS stranger cannot read equipment';
END $$;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT notes FROM public.equipment WHERE id = 1) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL stranger updated equipment';
  END IF;
END $$;

-- Soft-remove keeps the ticket and the report on the same equipment id.
UPDATE public.equipment SET removed_at = now() WHERE id = 1;
DO $$
BEGIN
  IF (SELECT equipment_id FROM public.service_tickets WHERE id = 70) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL ticket lost its equipment link';
  END IF;
  IF (SELECT equipment_id FROM public.service_reports WHERE report_number = 'SR-1') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL report lost its equipment link';
  END IF;
  IF (SELECT removed_at FROM public.equipment WHERE id = 1) IS NULL THEN
    RAISE EXCEPTION 'FAIL removed_at was not stored';
  END IF;
  RAISE NOTICE 'PASS soft-remove keeps ticket and report links';
END $$;

\ir ../migrations/20261119_000964_customer_equipment_record_rollback.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment'
      AND column_name IN ('install_date', 'warranty_or_contract', 'removed_at')
  ) THEN
    RAISE EXCEPTION 'FAIL rollback left a 000964 column';
  END IF;
  IF (SELECT count(*) FROM public.equipment WHERE id = 1) <> 1 THEN
    RAISE EXCEPTION 'FAIL rollback removed the equipment row';
  END IF;
  IF (SELECT equipment_id FROM public.service_tickets WHERE id = 70) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL rollback broke the ticket link';
  END IF;
  IF to_regclass('public.equipment') IS NULL THEN
    RAISE EXCEPTION 'FAIL rollback dropped public.equipment';
  END IF;
  RAISE NOTICE 'PASS rollback drops only the new columns';
END $$;
