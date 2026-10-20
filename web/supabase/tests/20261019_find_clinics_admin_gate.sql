-- Local proof for 20261018_000934_find_clinics_admin_gate.sql and its rollback.
-- Empty Postgres 17 scratch database only (never production). Refuses to run
-- when public.organizations already exists. Fixture orgs are synthetic; no
-- real org data.
--
--   createdb admin_gate_proof
--   psql "postgresql:///admin_gate_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261019_find_clinics_admin_gate.sql
--   dropdb admin_gate_proof
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


-- ---------------------------------------------------------------- 000929 first
\ir ../migrations/20261018_000929_organizations_country.sql
INSERT INTO public.organizations (id, name, type, city, state, country, prospect_pool, phone) VALUES
 -- Alberta: 5 Calgary + 3 Edmonton spelled 'Alberta', 2 Calgary spelled 'AB', 1 Calgary in 'Alta.'
 (8001,'AB Calgary 1','laser_clinic','Calgary','Alberta','Canada','amer-clinics-1018','+1 403 555 0001'),
 (8002,'AB Calgary 2','laser_clinic','calgary ','Alberta','Canada','amer-clinics-1018','+1 403 555 0002'),
 (8003,'AB Calgary 3','laser_clinic','Calgary','Alberta','Canada','amer-clinics-1018','+1 403 555 0003'),
 (8004,'AB Calgary 4','laser_clinic','Calgary (Beltline)','Alberta','Canada','amer-clinics-1018','+1 403 555 0004'),
 (8005,'AB Calgary 5','laser_clinic','CALGARY','alberta','Canada','amer-clinics-1018','+1 403 555 0005'),
 (8006,'AB Edmonton 1','laser_clinic','Edmonton','Alberta','Canada','amer-clinics-1018','+1 780 555 0006'),
 (8007,'AB Edmonton 2','laser_clinic','Edmonton','Alberta','Canada','amer-clinics-1018','+1 780 555 0007'),
 (8008,'AB Edmonton 3','laser_clinic','Edmonton','Alberta','Canada','amer-clinics-1018','+1 780 555 0008'),
 (8009,'AB Calgary code 1','laser_clinic','Calgary','AB','Canada','amer-clinics-1018','+1 403 555 0009'),
 (8010,'AB Calgary code 2','laser_clinic','Calgary','A.B.','Canada','amer-clinics-1018','+1 403 555 0010'),
 (8011,'AB Calgary alta','laser_clinic','Calgary','Alta.','Canada','amer-clinics-1018','+1 403 555 0011'),
 -- Ontario / Québec
 (8020,'ON Toronto 1','laser_clinic','Toronto','Ontario','Canada','amer-clinics-1018','+1 416 555 0020'),
 (8021,'ON Toronto 2','laser_clinic','Toronto','Ontario','Canada','amer-clinics-1018','+1 416 555 0021'),
 (8022,'QC Montreal 1','laser_clinic','Montréal','Québec','Canada','amer-clinics-1018','+1 514 555 0022'),
 (8023,'QC Montreal 2','laser_clinic','Montreal','Quebec','Canada','amer-clinics-1018','+1 514 555 0023'),
 -- Newfoundland (code NL collides with Mexico's Nuevo León) and a pool row whose country is not canonical
 (8024,'NL St Johns','laser_clinic','St. John''s','NL','Canada','amer-clinics-1018','+1 709 555 0024'),
 (8025,'ON Toronto upper','laser_clinic','Toronto','ON','CANADA','amer-clinics-1018','+1 416 555 0025'),
 -- Brazil: São Paulo state, several city spellings; Rio
 (8030,'SP Capital 1','laser_clinic','São Paulo','São Paulo','Brazil','amer-clinics-1018','+55 11 5555 0030'),
 (8031,'SP Capital 2','laser_clinic','São Paulo','São Paulo','Brazil','amer-clinics-1018','+55 11 5555 0031'),
 (8032,'SP Capital 3','laser_clinic','São Paulo (Moema)','São Paulo','Brazil','amer-clinics-1018','+55 11 5555 0032'),
 (8033,'SP Capital 4','laser_clinic','Sao Paulo','Sao Paulo','Brazil','amer-clinics-1018','+55 11 5555 0033'),
 (8034,'SP Capital 5','laser_clinic','SÃO PAULO','SP','Brazil','amer-clinics-1018','+55 11 5555 0034'),
 (8035,'SP Campinas 1','laser_clinic','Campinas','São Paulo','Brazil','amer-clinics-1018','+55 19 5555 0035'),
 (8036,'SP Campinas 2','laser_clinic','Campinas','São Paulo','Brazil','amer-clinics-1018','+55 19 5555 0036'),
 (8037,'RJ Rio 1','laser_clinic','Rio de Janeiro','Rio de Janeiro','Brazil','amer-clinics-1018','+55 21 5555 0037'),
 (8038,'BR multi','laser_clinic','São Paulo / Recife','Multiple states','Brazil','amer-clinics-1018','+55 11 5555 0038'),
 -- Mexico
 (8040,'MX Monterrey 1','laser_clinic','Monterrey','Nuevo León','Mexico','amer-clinics-1018','+52 81 5555 0040'),
 (8041,'MX Monterrey 2','laser_clinic','Monterrey','Nuevo Leon','Mexico','amer-clinics-1018','+52 81 5555 0041'),
 (8042,'MX CDMX 1','laser_clinic','Ciudad de México','Ciudad de México','Mexico','amer-clinics-1018','+52 55 5555 0042'),
 (8043,'MX Guadalajara','laser_clinic','Guadalajara','Jalisco','Mexico','amer-clinics-1018','+52 33 5555 0043'),
 -- US (only for the Springfield guard; the live pool has no US rows)
 (8050,'US Springfield IL','laser_clinic','Springfield','Illinois','United States','amer-clinics-1018','+1 217 555 0050'),
 (8051,'US Springfield MO','laser_clinic','Springfield','Missouri','United States','amer-clinics-1018','+1 417 555 0051'),
 (8052,'US Chicago','laser_clinic','Chicago','IL','United States','amer-clinics-1018','+1 312 555 0052'),
 -- Egypt: unknown (raw) states on both sides still match each other
 (8060,'EG Cairo 1','laser_clinic','Cairo','Cairo','Egypt','intl-clinics-1018','+20 2 5555 0060'),
 (8061,'EG New Cairo 1','laser_clinic','New Cairo','Cairo','Egypt','intl-clinics-1018','+20 2 5555 0061'),
 (8062,'EG Giza 1','laser_clinic','Giza','Giza','Egypt','intl-clinics-1018','+20 2 5555 0062'),
 -- inactive pool row never shows
 (8070,'AB Calgary inactive','laser_clinic','Calgary','AB','Canada','amer-clinics-1018','+1 403 555 0070');
UPDATE public.organizations SET is_active = false WHERE id = 8070;

-- Viewers (service companies). 93xx free, 94xx complimentary Premium.
INSERT INTO public.organizations (id, name, type, city, state, country, is_premium, premium_until, premium_grant) VALUES
 (9301,'Calgary AB shop','service_company','Calgary','AB','Canada',false,NULL,NULL),
 (9302,'Calgary Alberta shop','service_company','Calgary','Alberta','Canada',false,NULL,NULL),
 (9303,'Sao Paulo SP shop','service_company','São Paulo','SP','Brazil',false,NULL,NULL),
 (9304,'sao paulo s.p. shop','service_company',' sao  paulo ','s.p.','Brazil',false,NULL,NULL),
 (9305,'Calgary unknown-state shop','service_company','Calgary','Prov of Alberta','Canada',false,NULL,NULL),
 (9306,'Springfield IL shop','service_company','Springfield','IL','United States',false,NULL,NULL),
 (9307,'Monterrey NL shop','service_company','Monterrey','NL','Mexico',false,NULL,NULL),
 (9308,'CDMX shop','service_company','CDMX','CDMX','Mexico',false,NULL,NULL),
 (9309,'Montreal QC shop','service_company','Montreal','QC','Canada',false,NULL,NULL),
 (9310,'Sydney shop','service_company','Sydney','NSW','Australia',false,NULL,NULL),
 (9311,'Blank shop','service_company',NULL,NULL,NULL,false,NULL,NULL),
 (9312,'City-only shop','service_company','Calgary',NULL,NULL,false,NULL,NULL),
 (9313,'Cairo shop','service_company','cairo','cairo','Egypt',false,NULL,NULL),
 (9314,'Calgary AB lowercase-country shop','service_company','Calgary','AB','canada',false,NULL,NULL),
 (9315,'Monterrey NL no-country shop','service_company','Monterrey','NL',NULL,false,NULL,NULL),
 (9316,'Cairo lowercase-country shop','service_company','Cairo','Cairo','egypt',false,NULL,NULL),
 (9401,'Premium Calgary AB','service_company','Calgary','AB','Canada',true,now() + interval '30 days','complimentary_signup');

INSERT INTO public.organization_memberships (user_id, organization_id, role)
SELECT ('00000000-0000-0000-0000-0000000' || lpad(id::text, 5, '0'))::uuid, id, 'company_admin'
  FROM public.organizations WHERE id BETWEEN 9301 AND 9401 AND type = 'service_company';

CREATE FUNCTION public._as(p_org bigint) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000' || lpad(p_org::text, 5, '0'), false)::text::void
$$;
CREATE FUNCTION public._ids(j jsonb) RETURNS bigint[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg((c->>'id')::bigint ORDER BY (c->>'id')::bigint), '{}') FROM jsonb_array_elements(j->'clinics') c
$$;

\ir ../migrations/20261018_000933_find_clinics_locality.sql

-- Exactness baseline after 000933 (every public function: definition, ACL, comment).
CREATE TABLE public._pre_934 AS
SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) AS def,
       coalesce(p.proacl::text, '') AS acl, coalesce(obj_description(p.oid, 'pg_proc'), '') AS cmt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%';

-- Extra members of 9301 (Calgary AB, Free): technician, owner, parts_supplier, fse+admin.
CREATE FUNCTION public._as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid, false)::text::void $$;
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES
 ('11111111-0000-0000-0000-000000000001', 9301, 'fse'),
 ('11111111-0000-0000-0000-000000000002', 9301, 'owner'),
 ('11111111-0000-0000-0000-000000000003', 9301, 'parts_supplier'),
 ('11111111-0000-0000-0000-000000000004', 9301, NULL),
 ('11111111-0000-0000-0000-000000000005', 9301, ' Admin ');

-- Before 000934: a technician sees clinic contacts (the bug).
DO $$ DECLARE r jsonb; BEGIN
  PERFORM public._as_user('11111111-0000-0000-0000-000000000001');
  r := public.find_clinic_prospects();
  IF r ? 'error' OR jsonb_array_length(r->'clinics') = 0 OR (r->'clinics'->0->>'phone') IS NULL THEN
    RAISE EXCEPTION 'FAIL baseline: expected 000933 to leak to fse, got %', r;
  END IF;
  RAISE NOTICE 'BEFORE 000934: fse member got % clinics with phone', jsonb_array_length(r->'clinics');
END $$;

-- ---------------------------------------------------------------- apply twice
\ir ../migrations/20261019_000934_find_clinics_admin_gate.sql
\ir ../migrations/20261019_000934_find_clinics_admin_gate.sql
DO $$ DECLARE p record; BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid = 'public.find_clinic_prospects(text,text,integer,integer)'::regprocedure;
  IF NOT p.prosecdef OR p.provolatile <> 'v' OR p.proconfig <> ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'FAIL shape: secdef % vol % cfg %', p.prosecdef, p.provolatile, p.proconfig;
  END IF;
  IF has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL grants';
  END IF;
  IF has_table_privilege('authenticated', 'public.prospect_org_locality', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.prospect_org_locality', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.prospect_query_log', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('anon', 'public.prospect_query_log', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'FAIL table grants';
  END IF;
  IF EXISTS (
    (SELECT f, def, acl, cmt FROM public._pre_934 WHERE f <> 'find_clinic_prospects(text,text,integer,integer)')
    EXCEPT
    (SELECT p2.oid::regprocedure::text, md5(pg_get_functiondef(p2.oid)), coalesce(p2.proacl::text, ''), coalesce(obj_description(p2.oid, 'pg_proc'), '')
       FROM pg_proc p2 JOIN pg_namespace n ON n.oid = p2.pronamespace WHERE n.nspname = 'public')
  ) THEN
    RAISE EXCEPTION 'FAIL 000934 changed another function';
  END IF;
  RAISE NOTICE 'PASS 000934 shape (SECURITY DEFINER, VOLATILE, search_path ''''), grants, tables private, idempotent re-run, other functions untouched';
END $$;

-- ---------------------------------------------------------------- A-1 admin gate
DO $$ DECLARE r jsonb; BEGIN
  PERFORM public._as_user('11111111-0000-0000-0000-000000000001'); r := public.find_clinic_prospects();
  IF r->>'error' IS DISTINCT FROM 'not_admin' OR r ? 'clinics' THEN RAISE EXCEPTION 'FAIL fse: %', r; END IF;
  PERFORM public._as_user('11111111-0000-0000-0000-000000000003'); r := public.find_clinic_prospects();
  IF r->>'error' IS DISTINCT FROM 'not_admin' THEN RAISE EXCEPTION 'FAIL parts_supplier: %', r; END IF;
  PERFORM public._as_user('11111111-0000-0000-0000-000000000004'); r := public.find_clinic_prospects();
  IF r->>'error' IS DISTINCT FROM 'not_admin' THEN RAISE EXCEPTION 'FAIL null role: %', r; END IF;
  PERFORM public._as_user('11111111-0000-0000-0000-000000000002'); r := public.find_clinic_prospects();
  IF r ? 'error' OR jsonb_array_length(r->'clinics') = 0 THEN RAISE EXCEPTION 'FAIL owner: %', r; END IF;
  PERFORM public._as_user('11111111-0000-0000-0000-000000000005'); r := public.find_clinic_prospects();
  IF r ? 'error' THEN RAISE EXCEPTION 'FAIL " Admin ": %', r; END IF;
  PERFORM public._as(9301); r := public.find_clinic_prospects();
  IF r ? 'error' THEN RAISE EXCEPTION 'FAIL company_admin: %', r; END IF;
  PERFORM public._as_user('22222222-0000-0000-0000-000000000009'); r := public.find_clinic_prospects();
  IF r->>'error' IS DISTINCT FROM 'no_org' THEN RAISE EXCEPTION 'FAIL non-member: %', r; END IF;
  RAISE NOTICE 'PASS A-1: fse, parts_supplier, NULL role -> not_admin (no rows); owner, company_admin, admin -> rows; non-member -> no_org';
END $$;

-- ---------------------------------------------------------------- A-2 locality snapshot
DELETE FROM public.prospect_query_log;
DO $$ DECLARE r jsonb; r2 jsonb; n int; BEGIN
  PERFORM public._as(9301); r := public.find_clinic_prospects();
  IF NOT EXISTS (SELECT 1 FROM public.prospect_org_locality WHERE organization_id = 9301 AND city = 'Calgary' AND state = 'AB') THEN
    RAISE EXCEPTION 'FAIL snapshot not taken';
  END IF;
  -- client edits the org address (organizations is client-editable by admins)
  UPDATE public.organizations SET city = 'Toronto', state = 'ON' WHERE id = 9301;
  r2 := public.find_clinic_prospects();
  IF public._ids(r) <> public._ids(r2) OR r2->'viewer'->>'city' IS DISTINCT FROM 'calgary' THEN
    RAISE EXCEPTION 'FAIL city edit moved the free window: % vs %', public._ids(r), public._ids(r2);
  END IF;
  SELECT count(*) INTO n FROM public.prospect_org_locality WHERE organization_id = 9301;
  IF n <> 1 OR NOT EXISTS (SELECT 1 FROM public.prospect_org_locality WHERE organization_id = 9301 AND city = 'Calgary') THEN
    RAISE EXCEPTION 'FAIL snapshot changed';
  END IF;
  -- support reset (service role) re-snapshots once
  DELETE FROM public.prospect_org_locality WHERE organization_id = 9301;
  r2 := public.find_clinic_prospects();
  IF r2->'viewer'->>'city' IS DISTINCT FROM 'toronto' THEN RAISE EXCEPTION 'FAIL reset: %', r2->'viewer'; END IF;
  UPDATE public.organizations SET city = 'Calgary', state = 'AB' WHERE id = 9301;
  DELETE FROM public.prospect_org_locality WHERE organization_id = 9301;
  -- blank org: no snapshot until it has a location, then exactly once
  PERFORM public._as(9311); r := public.find_clinic_prospects();
  IF EXISTS (SELECT 1 FROM public.prospect_org_locality WHERE organization_id = 9311)
     OR (r->'viewer'->>'has_location')::boolean THEN RAISE EXCEPTION 'FAIL blank org snapshotted'; END IF;
  UPDATE public.organizations SET city = 'Montreal', state = 'QC', country = 'Canada' WHERE id = 9311;
  r := public.find_clinic_prospects();
  UPDATE public.organizations SET city = 'Calgary', state = 'AB' WHERE id = 9311;
  r2 := public.find_clinic_prospects();
  IF r2->'viewer'->>'city' IS DISTINCT FROM 'montreal' OR public._ids(r) <> public._ids(r2) THEN
    RAISE EXCEPTION 'FAIL blank org second edit moved window';
  END IF;
  UPDATE public.organizations SET city = NULL, state = NULL, country = NULL WHERE id = 9311;
  DELETE FROM public.prospect_org_locality WHERE organization_id = 9311;
  RAISE NOTICE 'PASS A-2: first located call snapshots; later organizations edits do not move the Free window; reset by deleting the row';
END $$;

-- ---------------------------------------------------------------- A-3 rate limit + offset cap
DELETE FROM public.prospect_query_log;
DO $$ DECLARE r jsonb; i int; BEGIN
  PERFORM public._as(9401);
  FOR i IN 1..30 LOOP
    r := public.find_clinic_prospects(NULL, NULL, 100, 0);
    IF r ? 'error' THEN RAISE EXCEPTION 'FAIL call % refused: %', i, r; END IF;
  END LOOP;
  r := public.find_clinic_prospects(NULL, NULL, 100, 0);
  IF r->>'error' IS DISTINCT FROM 'rate_limited' OR r ? 'clinics' THEN RAISE EXCEPTION 'FAIL 31st call: %', r; END IF;
  -- another user is not affected
  PERFORM public._as(9301); r := public.find_clinic_prospects();
  IF r ? 'error' THEN RAISE EXCEPTION 'FAIL other user limited: %', r; END IF;
  -- window rolls
  UPDATE public.prospect_query_log SET created_at = created_at - interval '61 seconds';
  PERFORM public._as(9401); r := public.find_clinic_prospects(NULL, NULL, 100, 5000);
  IF r ? 'error' OR (r->'page'->>'offset')::int <> 5000 THEN RAISE EXCEPTION 'FAIL offset 5000: %', r; END IF;
  r := public.find_clinic_prospects(NULL, NULL, 100, 5001);
  IF r->>'error' IS DISTINCT FROM 'offset_too_large' OR r ? 'clinics' THEN RAISE EXCEPTION 'FAIL offset 5001: %', r; END IF;
  r := public.find_clinic_prospects(NULL, NULL, 100, 50000);
  IF r->>'error' IS DISTINCT FROM 'offset_too_large' THEN RAISE EXCEPTION 'FAIL offset 50000: %', r; END IF;
  -- Free ignores offset (fixed 20) and is not refused for it
  PERFORM public._as(9302); r := public.find_clinic_prospects(NULL, NULL, 100, 99999);
  IF r ? 'error' OR r->>'tier' <> 'free' THEN RAISE EXCEPTION 'FAIL free offset: %', r; END IF;
  -- prune: rows older than 1 day go on the next call
  UPDATE public.prospect_query_log SET created_at = now() - interval '2 days' WHERE user_id = '00000000-0000-0000-0000-000000009302';
  r := public.find_clinic_prospects();
  IF (SELECT count(*) FROM public.prospect_query_log WHERE user_id = '00000000-0000-0000-0000-000000009302') <> 1 THEN
    RAISE EXCEPTION 'FAIL prune';
  END IF;
  RAISE NOTICE 'PASS A-3: 30 calls/min/user then rate_limited (no rows), per user, rolling; Premium offset 5000 ok, 5001 refused; Free unaffected; 1-day prune';
END $$;

-- live roles: authenticated through SET ROLE
SET ROLE authenticated;
SELECT public._as(9301);
DO $$ DECLARE r jsonb; BEGIN
  r := public.find_clinic_prospects();
  IF r ? 'error' THEN RAISE EXCEPTION 'FAIL authenticated admin: %', r; END IF;
  BEGIN
    PERFORM 1 FROM public.prospect_org_locality;
    RAISE EXCEPTION 'FAIL authenticated reads prospect_org_locality';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.prospect_org_locality (organization_id, city) VALUES (9301, 'Toronto');
    RAISE EXCEPTION 'FAIL authenticated writes prospect_org_locality';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.prospect_query_log;
    RAISE EXCEPTION 'FAIL authenticated clears prospect_query_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public._as_user('11111111-0000-0000-0000-000000000001');
DO $$ BEGIN
  IF public.find_clinic_prospects()->>'error' IS DISTINCT FROM 'not_admin' THEN RAISE EXCEPTION 'FAIL authenticated fse'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS live role authenticated: admin ok, fse refused, cannot read/write/reset the snapshot or the log'; END $$;

-- ---------------------------------------------------------------- rollback (exact), twice
\ir ../migrations/20261019_000934_find_clinics_admin_gate_rollback.sql
\ir ../migrations/20261019_000934_find_clinics_admin_gate_rollback.sql
DO $$ BEGIN
  IF EXISTS (
    (SELECT f, def, acl, cmt FROM public._pre_934)
    EXCEPT
    (SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, ''), coalesce(obj_description(p.oid, 'pg_proc'), '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%')
  ) OR EXISTS (
    (SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, ''), coalesce(obj_description(p.oid, 'pg_proc'), '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%')
    EXCEPT
    (SELECT f, def, acl, cmt FROM public._pre_934)
  ) THEN
    RAISE EXCEPTION 'FAIL rollback not exact';
  END IF;
  IF to_regclass('public.prospect_org_locality') IS NOT NULL OR to_regclass('public.prospect_query_log') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL rollback left tables';
  END IF;
  RAISE NOTICE 'PASS rollback exact (every public function definition/ACL/comment = 000933), tables dropped, rollback re-run OK';
END $$;

-- ---------------------------------------------------------------- drift guards
CREATE TABLE public.prospect_query_log (id int);
\set ON_ERROR_STOP off
\ir ../migrations/20261019_000934_find_clinics_admin_gate.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc') NOT LIKE '000933:%'
     OR to_regclass('public.prospect_org_locality') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL drift guard let a foreign prospect_query_log through';
  END IF;
  RAISE NOTICE 'PASS drift guard: foreign prospect_query_log refused, nothing applied';
END $$;
DROP TABLE public.prospect_query_log;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS 'hand edited';
\set ON_ERROR_STOP off
\ir ../migrations/20261019_000934_find_clinics_admin_gate.sql
\ir ../migrations/20261019_000934_find_clinics_admin_gate_rollback.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.prospect_org_locality') IS NOT NULL
     OR obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc') <> 'hand edited' THEN
    RAISE EXCEPTION 'FAIL drift guard replaced a foreign find_clinic_prospects';
  END IF;
  RAISE NOTICE 'PASS drift guard: foreign find_clinic_prospects refused by apply and by rollback';
END $$;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS
  '000933: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates; normalized state/city keys. Free = 20 local rows + counts; Premium = paged rows.';

-- re-apply after rollback works
\ir ../migrations/20261019_000934_find_clinics_admin_gate.sql
DO $$ BEGIN
  IF obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc') NOT LIKE '000934:%'
     OR to_regclass('public.prospect_org_locality') IS NULL THEN RAISE EXCEPTION 'FAIL re-apply'; END IF;
  PERFORM public._as_user('11111111-0000-0000-0000-000000000001');
  IF public.find_clinic_prospects()->>'error' IS DISTINCT FROM 'not_admin' THEN RAISE EXCEPTION 'FAIL re-apply gate'; END IF;
  RAISE NOTICE 'PASS re-apply after rollback';
END $$;
