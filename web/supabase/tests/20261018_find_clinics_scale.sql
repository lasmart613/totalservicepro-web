-- Scale proof for find_clinic_prospects (000929): ~5,000-row pool, like Luxor
-- (4,500 customer links) plus the imported pool. Times the RPC, checks the
-- page cap and that counts are aggregates, and prints EXPLAIN of the pool query.
-- Empty Postgres 17 scratch database only (never production). Refuses to run
-- when public.organizations already exists. Fixture orgs are synthetic
-- (ids 9001+ and 2684-3505 shaped rows); no real org data.
--
--   createdb country_scale
--   psql "postgresql:///country_scale" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_organizations_country.sql
--   dropdb country_scale
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
  id bigint PRIMARY KEY, name text NOT NULL, type text, address text, city text, state text, zip text,
  phone text, email text, website text, notes text, contact_name text, laser_models text, facility_type text,
  is_active boolean DEFAULT true, list_in_directory boolean DEFAULT false,
  is_premium boolean DEFAULT false, subscription_tier text, plan text, premium_until timestamptz, premium_grant text);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.organizations TO anon, authenticated;
CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL,
  organization_id bigint NOT NULL REFERENCES public.organizations(id), role text, is_home boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(), UNIQUE (user_id, organization_id));
CREATE TABLE public.organization_customers (id bigserial PRIMARY KEY,
  service_organization_id bigint REFERENCES public.organizations(id), customer_organization_id bigint REFERENCES public.organizations(id),
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz, first_service_date timestamptz, notes text,
  UNIQUE (service_organization_id, customer_organization_id));
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, organization_id bigint, active_organization_id bigint);
CREATE TABLE public.service_reports (id bigserial PRIMARY KEY, organization_id bigint, customer_organization_id bigint);
CREATE TABLE public.migration_backup (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL,
  source_table text NOT NULL, row_pk text NOT NULL, row_data jsonb NOT NULL, backed_up_at timestamptz NOT NULL DEFAULT now());

-- live helper shapes (000906)
CREATE OR REPLACE FUNCTION public.get_my_org_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT p.active_organization_id FROM public.user_profiles p WHERE p.id = auth.uid() AND p.active_organization_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.organization_id = p.active_organization_id) LIMIT 1),
    (SELECT m.organization_id FROM public.organization_memberships m WHERE m.user_id = auth.uid()
      ORDER BY m.is_home DESC NULLS LAST, m.created_at ASC NULLS LAST LIMIT 1));
$$;
CREATE OR REPLACE FUNCTION public.is_active_org_member(org_id bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = auth.uid() AND m.organization_id = org_id);
$$;


INSERT INTO public.organizations (id, name, type, city, state, is_premium, subscription_tier) VALUES
 (1, 'Big Shop', 'service_company', 'Somis', 'California', false, 'enterprise'),
 (2, 'Small Free Shop', 'service_company', 'Somis', 'CA', false, 'free');
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 1, 'owner'), ('00000000-0000-0000-0000-0000000000a2', 2, 'owner');
-- 4,500 linked US clinics for shop 1
INSERT INTO public.organizations (id, name, type, city, state, phone, email)
SELECT 10000 + g, 'Linked ' || g, 'laser_clinic', (ARRAY['Somis','Ventura','Oxnard','Austin','Miami'])[1 + g % 5],
       (ARRAY['CA','CA','CA','TX','FL'])[1 + g % 5], '+1 805 555 ' || lpad((g % 10000)::text, 4, '0'), 'l' || g || '@example.test'
  FROM generate_series(1, 4500) g;
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id)
SELECT 1, 10000 + g FROM generate_series(1, 4500) g;
-- other orgs that are not in anyone's pool (noise)
INSERT INTO public.organizations (id, name, type, city) SELECT 30000 + g, 'Noise ' || g, 'customer', 'X' FROM generate_series(1, 3000) g;
\ir ../migrations/20261018_000929_organizations_country.sql
-- imported pool: 3,000 rows across 7 countries
INSERT INTO public.organizations (id, name, type, city, country, prospect_pool)
SELECT 20000 + g, 'Pool ' || g, 'laser_clinic', 'City' || (g % 40),
       (ARRAY['Egypt','United Arab Emirates','Saudi Arabia','India','Mexico','Canada','Brazil'])[1 + g % 7],
       CASE WHEN g % 7 < 4 THEN 'intl-clinics-1018' ELSE 'amer-clinics-1018' END
  FROM generate_series(1, 3000) g;
UPDATE public.organizations SET country = 'United States' WHERE id IN (1, 2) OR id BETWEEN 10001 AND 14500;
ANALYZE public.organizations; ANALYZE public.organization_customers;

\timing on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ DECLARE j jsonb; t0 timestamptz := clock_timestamp(); ms numeric; BEGIN
  j := public.find_clinic_prospects(NULL, NULL, 1000, 0);
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  IF j->>'tier' <> 'premium' THEN RAISE EXCEPTION 'FAIL tier'; END IF;
  IF (j->>'total')::int <> 7500 THEN RAISE EXCEPTION 'FAIL total %', j->>'total'; END IF;
  IF jsonb_array_length(j->'clinics') <> 100 THEN RAISE EXCEPTION 'FAIL page cap %', jsonb_array_length(j->'clinics'); END IF;
  IF (SELECT sum((e->>'count')::int) FROM jsonb_array_elements(j->'country_counts') e) <> 7500 THEN RAISE EXCEPTION 'FAIL country counts'; END IF;
  IF pg_column_size(j) > 200000 THEN RAISE EXCEPTION 'FAIL payload % bytes', pg_column_size(j); END IF;
  RAISE NOTICE 'PASS premium 7,500-row pool: page=100 rows, % bytes, % ms', pg_column_size(j), round(ms);
  t0 := clock_timestamp();
  j := public.find_clinic_prospects('Mexico', NULL, 50, 300);
  RAISE NOTICE 'PASS premium filtered page (Mexico, offset 300): filtered_total=% rows=% % ms', j->'page'->>'filtered_total', jsonb_array_length(j->'clinics'), round(extract(epoch FROM clock_timestamp() - t0) * 1000);
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
DO $$ DECLARE j jsonb; t0 timestamptz := clock_timestamp(); BEGIN
  j := public.find_clinic_prospects();
  IF j->>'tier' <> 'free' OR jsonb_array_length(j->'clinics') <> 0 THEN RAISE EXCEPTION 'FAIL free shop sees % rows', jsonb_array_length(j->'clinics'); END IF;
  IF (j->'locked'->>'total')::int <> 3000 THEN RAISE EXCEPTION 'FAIL free locked %', j->'locked'; END IF;
  IF jsonb_array_length(j->'area_counts') > 300 THEN RAISE EXCEPTION 'FAIL area cap'; END IF;
  RAISE NOTICE 'PASS free shop (no linked clinics): 0 rows, locked=% , % bytes, % ms', j->'locked', pg_column_size(j), round(extract(epoch FROM clock_timestamp() - t0) * 1000);
END $$;
RESET ROLE;
\timing off

-- Plan of the pool query for the big shop (body of prospect_pool_rows with literals)
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON)
  WITH links AS (SELECT oc.customer_organization_id AS id FROM public.organization_customers oc WHERE oc.service_organization_id = 1),
  ids AS (SELECT o.id FROM public.organizations o WHERE o.prospect_pool IS NOT NULL UNION SELECT l.id FROM links l)
  SELECT o.id FROM ids JOIN public.organizations o ON o.id = ids.id LEFT JOIN links l ON l.id = o.id
   WHERE o.id <> 1 AND o.is_active IS DISTINCT FROM false AND (o.prospect_pool IS NOT NULL OR lower(coalesce(o.type, '')) = 'laser_clinic');
DO $$ BEGIN RAISE NOTICE 'ALL PASS'; END $$;
