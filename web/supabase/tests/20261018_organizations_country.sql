-- Local proof for 20261018_000929_organizations_country.sql, the
-- 20261018_country_backfill one-off and both rollbacks.
-- Empty Postgres 17 scratch database only (never production). Refuses to run
-- when public.organizations already exists. Fixture orgs are synthetic
-- (ids 9001+ and 2684-3505 shaped rows); no real org data.
--
--   createdb country_proof
--   psql "postgresql:///country_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_organizations_country.sql
--   dropdb country_proof
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

-- ---------------------------------------------------------------- fixture
-- 9001 free shop (Phoenix AZ), 9002 complimentary Premium shop (Phoenix, Arizona),
-- 9003 expired complimentary shop, 9004 customer org (non-service)
INSERT INTO public.organizations (id, name, type, city, state, zip, phone, is_premium, subscription_tier, premium_until, premium_grant) VALUES
 (9001, 'Free Shop', 'service_company', 'Phoenix', 'AZ', '85001', '+1 602 555 0100', false, 'free', NULL, NULL),
 (9002, 'Comp Shop', 'service_company', 'Phoenix', 'Arizona', '85002', '+1 602 555 0101', true, 'free', now() + interval '30 days', 'complimentary_signup'),
 (9003, 'Expired Comp Shop', 'service_company', 'Tucson', 'AZ', '85701', '6025550102', true, 'free', now() - interval '1 day', 'complimentary_signup'),
 (9004, 'A Clinic Org', 'customer', 'Phoenix', 'AZ', '85003', '6025550103', false, 'free', NULL, NULL);

-- users: a..e
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
 ('00000000-0000-0000-0000-00000000000a', 9001, 'company_admin'),
 ('00000000-0000-0000-0000-00000000000b', 9002, 'company_admin'),
 ('00000000-0000-0000-0000-00000000000c', 9002, 'fse'),
 ('00000000-0000-0000-0000-00000000000d', 9004, 'owner'),
 ('00000000-0000-0000-0000-00000000000e', 9003, 'owner');

-- Imported pool shaped like prod: 30 Phoenix AZ US clinics (ids 2684.. in the
-- Egypt range would be wrong, so US-local rows sit outside the ranges and are
-- linked to 9001/9002 instead), and the four batches.
INSERT INTO public.organizations (id, name, type, city, state, zip, phone, email, contact_name, laser_models)
SELECT 9100 + g, 'Local Clinic ' || g, 'laser_clinic', CASE WHEN g <= 25 THEN 'Phoenix' ELSE 'Mesa' END, 'AZ', '85004',
       '+1 480 555 ' || lpad(g::text, 4, '0'), 'local' || g || '@example.test', 'Dr Local ' || g, 'GentleMax'
  FROM generate_series(1, 30) g;
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id)
SELECT s, 9100 + g FROM generate_series(1, 30) g, (VALUES (9001), (9002)) v(s);

INSERT INTO public.organizations (id, name, type, address, city, state, phone, email, contact_name, laser_models, notes)
SELECT id, 'Imported ' || id, 'laser_clinic', 'Street ' || id || ', City, ' || c, 'City' || (id % 3), 'Region', p || ' 555 0' || id,
       'imp' || id || '@example.test', 'Contact ' || id, 'Candela GentleLase',
       'Country: ' || c || E'\nImport: ' || CASE WHEN c = 'Egypt' THEN 'egypt-clinics-1018' ELSE 'intl-clinics-1018' END
  FROM (VALUES (2684, 'Egypt', '+20'), (2700, 'Egypt', '+20'), (2849, 'United Arab Emirates', '+971'),
               (2980, 'Saudi Arabia', '+966'), (3139, 'India', '+91'), (3505, 'India', '+91')) v(id, c, p);
-- mismatch: in the India range but tagged Saudi Arabia -> must stay NULL
INSERT INTO public.organizations (id, name, type, city, notes) VALUES
 (3300, 'Mismatch Clinic', 'laser_clinic', 'Delhi', E'Country: Saudi Arabia\nImport: intl-clinics-1018');
-- generic inference rows
INSERT INTO public.organizations (id, name, type, city, state, zip, phone) VALUES
 (9201, 'Toronto Shop', 'service_company', 'Toronto', 'ON', NULL, '+1 416 555 0000'),
 (9202, 'Cairo Shop', 'service_company', 'Cairo', 'cairo', NULL, '+20 15 555 0000'),
 (9203, 'Conflict Shop', 'service_company', 'X', 'TX', NULL, '+44 20 5555 0000'),
 (9204, 'Blank Shop', 'service_company', NULL, NULL, NULL, NULL),
 (9205, 'Zip Only', 'customer', NULL, NULL, '90210', NULL),
 (9206, 'Mexico Shop', 'service_company', 'CDMX', NULL, NULL, '+52 55 5555 0000');

-- ---------------------------------------------------------------- apply
\ir ../migrations/20261018_000929_organizations_country.sql
-- re-run is a no-op (drift guards accept own objects)
\ir ../migrations/20261018_000929_organizations_country.sql

DO $$ BEGIN
  BEGIN
    UPDATE public.organizations SET country = ' Egypt' WHERE id = 9204;
    RAISE EXCEPTION 'FAIL untrimmed country accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.organizations SET country = '' WHERE id = 9204;
    RAISE EXCEPTION 'FAIL empty country accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT has_column_privilege('authenticated', 'public.organizations', 'country', 'UPDATE') THEN RAISE EXCEPTION 'FAIL no UPDATE(country)'; END IF;
  IF has_column_privilege('authenticated', 'public.organizations', 'prospect_pool', 'UPDATE') THEN RAISE EXCEPTION 'FAIL prospect_pool writable'; END IF;
  IF has_function_privilege('anon', 'public.find_clinic_prospects()', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL anon can execute find'; END IF;
  IF has_function_privilege('anon', 'public.add_prospect_customer(bigint)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL anon can execute add'; END IF;
  IF has_function_privilege('authenticated', 'public.org_is_paid_entitled(bigint)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL helper exposed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
               AND p.proname IN ('find_clinic_prospects','add_prospect_customer','org_is_paid_entitled','prospect_state_key')
               AND (NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=""']))) THEN
    RAISE EXCEPTION 'FAIL definer/search_path';
  END IF;
  RAISE NOTICE 'PASS migration shape';
END $$;

-- ---------------------------------------------------------------- backfill
\ir ../oneoff/20261018_country_backfill.sql
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES
    (2684, 'Egypt'), (2700, 'Egypt'), (2849, 'United Arab Emirates'), (2980, 'Saudi Arabia'), (3139, 'India'), (3505, 'India'),
    (9001, 'United States'), (9002, 'United States'), (9003, 'United States'), (9201, 'Canada'), (9202, 'Egypt'),
    (9205, 'United States'), (9206, 'Mexico'), (9101, 'United States')) v(id, c) LOOP
    IF (SELECT country FROM public.organizations WHERE id = r.id) IS DISTINCT FROM r.c THEN
      RAISE EXCEPTION 'FAIL backfill % expected % got %', r.id, r.c, (SELECT country FROM public.organizations WHERE id = r.id);
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.organizations WHERE id IN (3300, 9203, 9204) AND country IS NULL) <> 3 THEN RAISE EXCEPTION 'FAIL ambiguous rows filled'; END IF;
  IF (SELECT count(*) FROM public.organizations WHERE prospect_pool = 'intl-clinics-1018') <> 6 THEN RAISE EXCEPTION 'FAIL pool marker count'; END IF;
  IF (SELECT prospect_pool FROM public.organizations WHERE id = 3300) IS NOT NULL THEN RAISE EXCEPTION 'FAIL mismatch marked as pool'; END IF;
  IF (SELECT count(*) FROM public.migration_backup WHERE label = 'country-backfill-1018') <>
     (SELECT count(*) FROM public.organizations WHERE country IS NOT NULL OR prospect_pool IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL backup row count';
  END IF;
  RAISE NOTICE 'PASS backfill';
END $$;
-- idempotent: a user-edited country is kept and no new backup rows appear
UPDATE public.organizations SET country = 'Canada' WHERE id = 9205;
CREATE TEMP TABLE bk AS SELECT count(*) n FROM public.migration_backup;
\ir ../oneoff/20261018_country_backfill.sql
DO $$ BEGIN
  IF (SELECT country FROM public.organizations WHERE id = 9205) <> 'Canada' THEN RAISE EXCEPTION 'FAIL re-run overwrote'; END IF;
  IF (SELECT count(*) FROM public.migration_backup) <> (SELECT n FROM bk) THEN RAISE EXCEPTION 'FAIL re-run added backups'; END IF;
  RAISE NOTICE 'PASS backfill idempotent';
END $$;
UPDATE public.organizations SET country = 'United States' WHERE id = 9205;

-- ---------------------------------------------------------------- RPC gating
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', u, false);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO anon, authenticated;

-- anon: no EXECUTE at all
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.find_clinic_prospects();
    RAISE EXCEPTION 'FAIL anon executed find_clinic_prospects';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.add_prospect_customer(2684);
    RAISE EXCEPTION 'FAIL anon executed add_prospect_customer';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS anon gets nothing';
END $$;
RESET ROLE;

SET ROLE authenticated;
-- authenticated without a session: nothing
SELECT pg_temp.as_user('');
DO $$ BEGIN
  IF public.find_clinic_prospects() <> '{"error": "not_authenticated"}'::jsonb THEN RAISE EXCEPTION 'FAIL no-uid'; END IF;
END $$;

-- non-service org (customer owner): nothing
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
DO $$ DECLARE j jsonb := public.find_clinic_prospects(); BEGIN
  IF j <> '{"error": "not_service_org"}'::jsonb THEN RAISE EXCEPTION 'FAIL non-service got %', j; END IF;
  IF (public.add_prospect_customer(2684))->>'error' <> 'not_service_org' THEN RAISE EXCEPTION 'FAIL non-service add'; END IF;
  RAISE NOTICE 'PASS non-service org gets nothing';
END $$;

-- free shop: <= 20 rows, all local; no names/contacts/ids outside the 20
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
DO $$ DECLARE j jsonb := public.find_clinic_prospects(); t text; BEGIN
  t := j::text;
  IF j->>'tier' <> 'free' THEN RAISE EXCEPTION 'FAIL free tier %', j->>'tier'; END IF;
  IF jsonb_array_length(j->'clinics') <> 20 THEN RAISE EXCEPTION 'FAIL free rows %', jsonb_array_length(j->'clinics'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(j->'clinics') e WHERE e->>'city' <> 'Phoenix') THEN RAISE EXCEPTION 'FAIL free non-local row'; END IF;
  IF (SELECT sum((e->>'count')::int) FROM jsonb_array_elements(j->'aggregates') e) + 20 <> (j->>'total')::int THEN RAISE EXCEPTION 'FAIL aggregates do not add up'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(j->'aggregates') e, jsonb_object_keys(e) k WHERE k NOT IN ('country','city','count')) THEN
    RAISE EXCEPTION 'FAIL aggregate leaks a field';
  END IF;
  -- names / contacts / emails / phones / ids of the other rows never appear
  IF t ~ 'Imported |imp[0-9]+@|Contact [0-9]|\+20 555|Local Clinic (2[1-9]|30)"|local(2[1-9]|30)@|Dr Local (2[1-9]|30)"' THEN
    RAISE EXCEPTION 'FAIL free payload leaks gated rows';
  END IF;
  IF t ~ '"id": (2684|2700|2849|2980|3139|3505)\M' THEN RAISE EXCEPTION 'FAIL free payload leaks ids'; END IF;
  IF (public.add_prospect_customer(2684))->>'error' <> 'premium_required' THEN RAISE EXCEPTION 'FAIL free add allowed'; END IF;
  -- CTA counts: 10 more AZ/US local rows (5 Phoenix + 5 Mesa) gated, 16 gated in total
  IF j->'locked' <> '{"area": 10, "total": 16}'::jsonb THEN RAISE EXCEPTION 'FAIL free locked counts %', j->'locked'; END IF;
  RAISE NOTICE 'PASS free: 20 local rows + counts only';
END $$;

-- expired complimentary: free
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
DO $$ BEGIN
  IF public.find_clinic_prospects()->>'tier' <> 'free' THEN RAISE EXCEPTION 'FAIL expired comp not free'; END IF;
  RAISE NOTICE 'PASS expired complimentary is free';
END $$;

-- complimentary Premium: everything
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ DECLARE j jsonb := public.find_clinic_prospects(); BEGIN
  IF j->>'tier' <> 'premium' THEN RAISE EXCEPTION 'FAIL premium tier'; END IF;
  IF jsonb_array_length(j->'clinics') <> 36 OR (j->>'total')::int <> 36 THEN RAISE EXCEPTION 'FAIL premium rows %', jsonb_array_length(j->'clinics'); END IF;
  IF jsonb_array_length(j->'aggregates') <> 0 THEN RAISE EXCEPTION 'FAIL premium aggregates'; END IF;
  IF j->'locked' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL premium gets upgrade CTA counts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'clinics') e WHERE e->>'email' = 'imp3505@example.test' AND e->>'contact_name' = 'Contact 3505'
                 AND e->>'laser_models' = 'Candela GentleLase' AND e->>'country' = 'India') THEN RAISE EXCEPTION 'FAIL premium missing fields'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(j->'clinics') e WHERE (e->>'id')::bigint = 3300) THEN RAISE EXCEPTION 'FAIL unmarked org in pool'; END IF;
  RAISE NOTICE 'PASS premium gets everything';
END $$;

-- add: fse refused; admin links, idempotent, audited, no history rows touched
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
DO $$ BEGIN
  IF (public.add_prospect_customer(2684))->>'error' <> 'not_admin' THEN RAISE EXCEPTION 'FAIL fse add'; END IF;
END $$;
SELECT pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
DO $$ BEGIN
  IF (public.add_prospect_customer(2684))->>'status' <> 'linked' THEN RAISE EXCEPTION 'FAIL add'; END IF;
  IF (public.add_prospect_customer(2684))->>'status' <> 'already_linked' THEN RAISE EXCEPTION 'FAIL idempotent'; END IF;
  IF (public.add_prospect_customer(9004))->>'error' <> 'not_found' THEN RAISE EXCEPTION 'FAIL non-pool org linked'; END IF;
  IF (public.add_prospect_customer(3300))->>'error' <> 'not_found' THEN RAISE EXCEPTION 'FAIL unmarked org linked'; END IF;
  IF (SELECT (e->>'is_customer')::boolean FROM jsonb_array_elements(public.find_clinic_prospects()->'clinics') e WHERE (e->>'id')::bigint = 2684) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL is_customer flag';
  END IF;
  RAISE NOTICE 'PASS add idempotent + scoped';
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.prospect_customer_links WHERE service_organization_id = 9002 AND customer_organization_id = 2684) <> 1 THEN RAISE EXCEPTION 'FAIL audit'; END IF;
  IF (SELECT count(*) FROM public.service_reports) <> 0 THEN RAISE EXCEPTION 'FAIL history touched'; END IF;
  -- source of the add RPC writes only organization_customers + its audit table
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'add_prospect_customer') ~* '(service_reports|equipment|history|grant)' THEN
    RAISE EXCEPTION 'FAIL add RPC references history objects';
  END IF;
  -- cap: pretend 49 more adds today, the 51st is refused
  INSERT INTO public.prospect_customer_links (service_organization_id, customer_organization_id, user_id)
  SELECT 9002, 2684, '00000000-0000-0000-0000-00000000000b' FROM generate_series(1, 49);
END $$;
SET ROLE authenticated;
DO $$ BEGIN
  IF (public.add_prospect_customer(2700))->>'error' <> 'daily_cap' THEN RAISE EXCEPTION 'FAIL cap'; END IF;
  RAISE NOTICE 'PASS daily cap';
END $$;
RESET ROLE;

-- ---------------------------------------------------------------- rollbacks
\ir ../oneoff/20261018_country_backfill_rollback.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE country IS NOT NULL OR prospect_pool IS NOT NULL) THEN RAISE EXCEPTION 'FAIL backfill rollback'; END IF;
  RAISE NOTICE 'PASS backfill rollback';
END $$;
\ir ../migrations/20261018_000929_organizations_country_rollback.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name IN ('country','prospect_pool'))
     OR to_regclass('public.prospect_customer_links') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('find_clinic_prospects','add_prospect_customer','org_is_paid_entitled','prospect_state_key'))
     OR EXISTS (SELECT 1 FROM pg_indexes WHERE indexname IN ('organizations_country_idx','organizations_prospect_pool_idx')) THEN
    RAISE EXCEPTION 'FAIL migration rollback left objects';
  END IF;
  RAISE NOTICE 'PASS migration rollback';
END $$;
-- re-apply after rollback works
\ir ../migrations/20261018_000929_organizations_country.sql
DO $$ BEGIN RAISE NOTICE 'ALL PASS'; END $$;
