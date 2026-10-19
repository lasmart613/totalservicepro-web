-- Local proof for 20261018_000933_find_clinics_locality.sql and its rollback.
-- Empty Postgres 17 scratch database only (never production). Refuses to run
-- when public.organizations already exists. Fixture orgs are synthetic; no
-- real org data.
--
--   createdb locality_proof
--   psql "postgresql:///locality_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_find_clinics_locality.sql
--   dropdb locality_proof
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

-- Exactness baseline: every public function (definition, ACL, comment) before 000933.
CREATE TABLE public._pre_933 AS
SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) AS def,
       coalesce(p.proacl::text, '') AS acl, coalesce(obj_description(p.oid, 'pg_proc'), '') AS cmt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';

-- ---------------------------------------------------------------- fixture
-- Pool (prospect_pool = amer-clinics-1018, laser_clinic, active).
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

-- 000929 behaviour this fixes (recorded for the PR): an 'AB' Calgary viewer only
-- matches pool rows literally spelled 'AB' (8009); 'Alberta', 'A.B.', 'Alta.' fall to rank 2.
DO $$
DECLARE n0 int; n1 int;
BEGIN
  SELECT count(*) FILTER (WHERE rank = 0), count(*) FILTER (WHERE rank = 1) INTO n0, n1
    FROM public.prospect_pool_rows(9301, 'Canada', public.prospect_state_key('AB'), 'calgary');
  IF n0 <> 1 OR n1 <> 0 THEN RAISE EXCEPTION 'unexpected 000929 baseline % %', n0, n1; END IF;
  RAISE NOTICE 'BEFORE 000933 (000929 ranking): AB Calgary viewer rank0=% rank1=% (of 11 Alberta rows)', n0, n1;
END $$;

-- ---------------------------------------------------------------- apply 000933 (twice)
\ir ../migrations/20261018_000933_find_clinics_locality.sql
\ir ../migrations/20261018_000933_find_clinics_locality.sql

-- shape / security
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
               AND p.proname IN ('prospect_fold','prospect_city_key','prospect_country_code','prospect_region_key','prospect_pool_rows_local','find_clinic_prospects')
               AND (NOT p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=""']))) THEN
    RAISE EXCEPTION 'FAIL definer/search_path';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
       AND p.proname IN ('prospect_fold','prospect_city_key','prospect_country_code','prospect_region_key','prospect_pool_rows_local')) <> 5 THEN
    RAISE EXCEPTION 'FAIL helper count';
  END IF;
  IF has_function_privilege('anon', 'public.find_clinic_prospects(text,text,int,int)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL anon can execute find'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.find_clinic_prospects(text,text,int,int)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL authenticated lost find'; END IF;
  IF has_function_privilege('authenticated', 'public.prospect_region_key(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.prospect_region_key(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prospect_pool_rows_local(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.prospect_pool_rows_local(bigint,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prospect_fold(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prospect_city_key(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.prospect_country_code(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL helper exposed';
  END IF;
  -- untouched 000929 objects
  IF EXISTS (SELECT 1 FROM public._pre_933 b JOIN pg_proc p ON p.oid::regprocedure::text = b.f
              WHERE b.f NOT LIKE 'find_clinic_prospects(%'
                AND (md5(pg_get_functiondef(p.oid)) <> b.def OR coalesce(p.proacl::text, '') <> b.acl)) THEN
    RAISE EXCEPTION 'FAIL 000933 changed a function other than find_clinic_prospects';
  END IF;
  IF (SELECT acl FROM public._pre_933 WHERE f LIKE 'find_clinic_prospects(%')
     <> (SELECT coalesce(proacl::text, '') FROM pg_proc WHERE oid = 'public.find_clinic_prospects(text,text,int,int)'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL find_clinic_prospects ACL changed';
  END IF;
  RAISE NOTICE 'PASS 000933 shape, grants, idempotent re-run, other functions untouched';
END $$;

-- key helpers
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('AB','Canada','CA:AB'), ('Alberta','Canada','CA:AB'), ('alberta ','Canada','CA:AB'), ('A.B.','Canada','CA:AB'), ('Alta.','Canada','CA:AB'),
    ('AB', NULL, 'CA:AB'), ('Alberta', NULL, 'CA:AB'),
    ('QC','Canada','CA:QC'), ('Québec','Canada','CA:QC'), ('Quebec','Canada','CA:QC'), ('PQ','Canada','CA:QC'),
    ('Newfoundland and Labrador','Canada','CA:NL'), ('NL','Canada','CA:NL'),
    ('SP','Brazil','BR:SP'), ('São Paulo','Brazil','BR:SP'), ('Sao Paulo','Brazil','BR:SP'), ('SÃO PAULO','Brazil','BR:SP'), ('s.p.','Brazil','BR:SP'), ('SP', NULL, 'BR:SP'),
    ('Distrito Federal','Brazil','BR:DF'), ('DF','Brazil','BR:DF'), ('Espírito Santo','Brazil','BR:ES'), ('MA','Brazil','BR:MA'),
    ('NL','Mexico','MX:NLE'), ('Nuevo León','Mexico','MX:NLE'), ('Nuevo Leon','Mexico','MX:NLE'), ('NLE','Mexico','MX:NLE'),
    ('CDMX','Mexico','MX:CMX'), ('Ciudad de México','Mexico','MX:CMX'), ('Distrito Federal','Mexico','MX:CMX'), ('DF','Mexico','MX:CMX'),
    ('Estado de México','Mexico','MX:MEX'), ('Edomex','Mexico','MX:MEX'), ('Querétaro','Mexico','MX:QUE'), ('Qro.','Mexico','MX:QUE'), ('Quintana Roo','Mexico','MX:ROO'),
    ('Arizona','United States','US:AZ'), ('AZ','United States','US:AZ'), ('AZ', NULL, 'US:AZ'), ('Arizona', NULL, 'US:AZ'), ('MA','United States','US:MA'),
    ('Washington','USA','US:WA'), ('District of Columbia','United States','US:DC'),
    ('Cairo','Egypt','raw:cairo'), ('cairo','Egypt','raw:cairo'), ('AB','Egypt','raw:ab'),
    ('Prov of Alberta','Canada','raw:prov of alberta'), ('Multiple states','Brazil','raw:multiple states'),
    (NULL,'Canada',NULL), ('  ','Canada',NULL)
  ) v(s, c, want) LOOP
    IF public.prospect_region_key(t.s, t.c) IS DISTINCT FROM t.want THEN
      RAISE EXCEPTION 'FAIL region_key(%, %) = % want %', t.s, t.c, public.prospect_region_key(t.s, t.c), t.want;
    END IF;
  END LOOP;
  FOR t IN SELECT * FROM (VALUES
    ('São Paulo','sao paulo'), (' sao  paulo ','sao paulo'), ('SÃO PAULO','sao paulo'), ('São Paulo (Moema)','sao paulo'),
    ('Moema - São Paulo/','moema sao paulo'), ('(Québec)','quebec'), ('Montréal','montreal'), ('Montréal-Ouest','montreal ouest'),
    ('New Cairo','new cairo'), ('Calgary (Beltline)','calgary'), ('St. John''s','st johns'), ('',NULL), (NULL,NULL)
  ) v(s, want) LOOP
    IF public.prospect_city_key(t.s) IS DISTINCT FROM t.want THEN
      RAISE EXCEPTION 'FAIL city_key(%) = % want %', t.s, public.prospect_city_key(t.s), t.want;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS region/city keys (US, CA, BR, MX; codes, names, accents, dots, raw fallback)';
END $$;

-- ranking through the RPC (Free)
DO $$
DECLARE
  r jsonb; r2 jsonb;
  calgary bigint[] := ARRAY[8001,8002,8003,8004,8005,8009,8010,8011]::bigint[];
  alberta bigint[] := ARRAY[8001,8002,8003,8004,8005,8006,8007,8008,8009,8010,8011]::bigint[];
BEGIN
  -- AB viewer == Alberta viewer, Calgary rows first (rank 0), then Edmonton (rank 1), then other Canada (rank 2)
  PERFORM public._as(9301); r := public.find_clinic_prospects();
  PERFORM public._as(9302); r2 := public.find_clinic_prospects();
  IF public._ids(r) <> public._ids(r2) THEN RAISE EXCEPTION 'FAIL AB viewer differs from Alberta viewer: % vs %', public._ids(r), public._ids(r2); END IF;
  IF NOT public._ids(r) @> alberta THEN RAISE EXCEPTION 'FAIL AB viewer misses Alberta rows: %', public._ids(r); END IF;
  IF (SELECT array_agg((c->>'id')::bigint) FROM (SELECT c FROM jsonb_array_elements(r->'clinics') WITH ORDINALITY x(c, i) WHERE i <= 8) s)::bigint[] @> calgary IS NOT TRUE
     OR (SELECT count(*) FROM jsonb_array_elements(r->'clinics') WITH ORDINALITY x(c, i) WHERE i <= 8 AND (c->>'id')::bigint = ANY (calgary)) <> 8 THEN
    RAISE EXCEPTION 'FAIL Calgary rows are not first for AB viewer: %', r->'clinics';
  END IF;
  IF 8070 = ANY (public._ids(r)) THEN RAISE EXCEPTION 'FAIL inactive row shown'; END IF;
  IF r->'viewer'->>'state' <> 'CA:AB' OR r->'viewer'->>'city' <> 'calgary' OR (r->'viewer'->>'has_location')::boolean IS NOT TRUE
     OR (r->'viewer'->>'country_pool')::int <> 15 THEN
    RAISE EXCEPTION 'FAIL viewer block %', r->'viewer';
  END IF;
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9301, 'Canada', 'CA:AB', 'calgary') WHERE rank = 0) <> 8
     OR (SELECT count(*) FROM public.prospect_pool_rows_local(9301, 'Canada', 'CA:AB', 'calgary') WHERE rank = 1) <> 3
     OR (SELECT count(*) FROM public.prospect_pool_rows_local(9301, 'Canada', 'CA:AB', 'calgary') WHERE rank = 2) <> 4 THEN
    RAISE EXCEPTION 'FAIL AB rank counts';
  END IF;
  RAISE NOTICE 'PASS AB viewer = Alberta viewer: 8 Calgary at rank 0, 3 Edmonton at rank 1, 4 other Canada at rank 2';

  -- SP viewer and a messy-spelling viewer
  PERFORM public._as(9303); r := public.find_clinic_prospects();
  PERFORM public._as(9304); r2 := public.find_clinic_prospects();
  IF public._ids(r) <> public._ids(r2) THEN RAISE EXCEPTION 'FAIL SP viewers differ'; END IF;
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9303, 'Brazil', 'BR:SP', 'sao paulo') WHERE rank = 0) <> 5
     OR (SELECT count(*) FROM public.prospect_pool_rows_local(9303, 'Brazil', 'BR:SP', 'sao paulo') WHERE rank = 1) <> 2 THEN
    RAISE EXCEPTION 'FAIL SP rank counts';
  END IF;
  IF (SELECT array_agg(x ORDER BY x) FROM (SELECT (c->>'id')::bigint x FROM jsonb_array_elements(r->'clinics') WITH ORDINALITY y(c, i) WHERE i <= 5) s)
     <> ARRAY[8030,8031,8032,8033,8034]::bigint[] THEN
    RAISE EXCEPTION 'FAIL SP city rows not first: %', r->'clinics';
  END IF;
  RAISE NOTICE 'PASS SP viewer: 5 São Paulo city rows (all spellings) at rank 0, 2 Campinas at rank 1';

  -- unknown viewer state: city + country fallback gives Calgary at rank 0, no rank 1
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9305, 'Canada', public.prospect_region_key('Prov of Alberta','Canada'), 'calgary') WHERE rank = 0) <> 8
     OR (SELECT count(*) FROM public.prospect_pool_rows_local(9305, 'Canada', public.prospect_region_key('Prov of Alberta','Canada'), 'calgary') WHERE rank = 1) <> 0 THEN
    RAISE EXCEPTION 'FAIL city+country fallback';
  END IF;
  -- city-only viewer (no state, no country): Calgary rows rank 0
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9312, NULL, NULL, 'calgary') WHERE rank = 0) <> 8 THEN RAISE EXCEPTION 'FAIL city-only viewer'; END IF;
  RAISE NOTICE 'PASS city + country fallback when state keys are not both recognised';

  -- Springfield IL viewer: Springfield IL rank 0, Springfield MO never rank 0/1, Chicago IL rank 1
  IF (SELECT array_agg(id ORDER BY id) FROM public.prospect_pool_rows_local(9306, 'United States', 'US:IL', 'springfield') WHERE rank = 0) <> ARRAY[8050]::bigint[]
     OR (SELECT rank FROM public.prospect_pool_rows_local(9306, 'United States', 'US:IL', 'springfield') WHERE id = 8051) <> 2
     OR (SELECT rank FROM public.prospect_pool_rows_local(9306, 'United States', 'US:IL', 'springfield') WHERE id = 8052) <> 1 THEN
    RAISE EXCEPTION 'FAIL Springfield guard';
  END IF;
  RAISE NOTICE 'PASS recognised but different states never match on city (Springfield IL vs MO)';

  -- Mexico / Québec / Egypt raw
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9307, 'Mexico', 'MX:NLE', 'monterrey') WHERE rank = 0) <> 2 THEN RAISE EXCEPTION 'FAIL NL'; END IF;
  PERFORM public._as(9308); r := public.find_clinic_prospects();
  IF (r->'clinics'->0->>'id')::bigint <> 8042 THEN RAISE EXCEPTION 'FAIL CDMX first: %', r->'clinics'; END IF;
  IF (SELECT count(*) FROM public.prospect_pool_rows_local(9309, 'Canada', 'CA:QC', 'montreal') WHERE rank = 0) <> 2 THEN RAISE EXCEPTION 'FAIL QC'; END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.prospect_pool_rows_local(9313, 'Egypt', 'raw:cairo', 'cairo') WHERE rank = 0) <> ARRAY[8060]::bigint[]
     OR (SELECT rank FROM public.prospect_pool_rows_local(9313, 'Egypt', 'raw:cairo', 'cairo') WHERE id = 8061) <> 1 THEN
    RAISE EXCEPTION 'FAIL Egypt raw/New Cairo';
  END IF;
  RAISE NOTICE 'PASS NL/Nuevo León, CDMX/Ciudad de México, QC/Québec, Egypt raw keys; New Cairo stays rank 1 for Cairo';

  -- L-1 flags
  PERFORM public._as(9310); r := public.find_clinic_prospects();
  IF jsonb_array_length(r->'clinics') <> 0 OR (r->'viewer'->>'has_location')::boolean IS NOT TRUE OR (r->'viewer'->>'country_pool')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL L-1 located viewer outside pool: %', r->'viewer';
  END IF;
  PERFORM public._as(9311); r := public.find_clinic_prospects();
  IF jsonb_array_length(r->'clinics') <> 0 OR (r->'viewer'->>'has_location')::boolean IS NOT FALSE OR r->'viewer'->'country_pool' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL L-1 blank viewer: %', r->'viewer';
  END IF;
  IF r ? 'country_pool' THEN RAISE EXCEPTION 'FAIL country_pool leaked to top level'; END IF;
  RAISE NOTICE 'PASS L-1 viewer.has_location / viewer.country_pool';

  -- Free gating unchanged: <= 20 rows, locked counts only
  PERFORM public._as(9301); r := public.find_clinic_prospects('Brazil', 'São Paulo', 100, 0);
  IF jsonb_array_length(r->'clinics') > 20 OR r->>'tier' <> 'free' OR NOT (r ? 'locked') OR r->'locked' = 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL free gating changed';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r->'area_counts') a WHERE (SELECT count(*) FROM jsonb_object_keys(a)) <> 3) THEN
    RAISE EXCEPTION 'FAIL area_counts shape';
  END IF;
  IF (SELECT (a->>'count')::int FROM jsonb_array_elements(r->'area_counts') a WHERE a->>'country' = 'Brazil' AND a->>'city' = 'São Paulo') <> 5 THEN
    RAISE EXCEPTION 'FAIL area_counts not grouped by city key: %', r->'area_counts';
  END IF;
  RAISE NOTICE 'PASS free tier gating unchanged; area_counts merge city spellings';
END $$;

-- Premium: city filter by key, city_counts merged
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public._as(9401);
  r := public.find_clinic_prospects('Brazil', 'sao paulo', 100, 0);
  IF r->>'tier' <> 'premium' OR (r->'page'->>'filtered_total')::int <> 5 THEN RAISE EXCEPTION 'FAIL premium city filter: %', r->'page'; END IF;
  r := public.find_clinic_prospects('Brazil', 'São Paulo (Moema)', 100, 0);
  IF (r->'page'->>'filtered_total')::int <> 5 THEN RAISE EXCEPTION 'FAIL premium city filter (qualifier)'; END IF;
  IF (SELECT (c->>'count')::int FROM jsonb_array_elements(r->'city_counts') c WHERE c->>'city' = 'São Paulo') <> 5
     OR jsonb_array_length(r->'city_counts') <> 4 THEN
    RAISE EXCEPTION 'FAIL premium city_counts: %', r->'city_counts';
  END IF;
  r := public.find_clinic_prospects(NULL, NULL, 1000, 0);
  IF (r->'page'->>'limit')::int <> 100 OR r->'locked' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL premium cap'; END IF;
  IF (r->'clinics'->0->>'id')::bigint NOT IN (8001,8002,8003,8004,8005,8009,8010,8011) THEN RAISE EXCEPTION 'FAIL premium local first: %', r->'clinics'->0; END IF;
  RAISE NOTICE 'PASS premium city filter by key, merged city_counts, 100 cap, local rows first';
END $$;

-- as the real roles
SELECT public._as(9301);
SET ROLE authenticated;
DO $$ BEGIN
  IF jsonb_array_length(public.find_clinic_prospects()->'clinics') = 0 THEN RAISE EXCEPTION 'FAIL authenticated call'; END IF;
  BEGIN
    PERFORM public.prospect_region_key('AB', 'Canada');
    RAISE EXCEPTION 'FAIL helper callable by authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.find_clinic_prospects();
    RAISE EXCEPTION 'FAIL anon can call';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'PASS live roles: authenticated calls the RPC, helpers and anon refused'; END $$;

-- ---------------------------------------------------------------- rollback (exact), twice
\ir ../migrations/20261018_000933_find_clinics_locality_rollback.sql
\ir ../migrations/20261018_000933_find_clinics_locality_rollback.sql
DO $$ BEGIN
  IF EXISTS (
    (SELECT f, def, acl, cmt FROM public._pre_933)
    EXCEPT
    (SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, ''), coalesce(obj_description(p.oid, 'pg_proc'), '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%')
  ) OR EXISTS (
    (SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, ''), coalesce(obj_description(p.oid, 'pg_proc'), '')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%')
    EXCEPT
    (SELECT f, def, acl, cmt FROM public._pre_933)
  ) THEN
    RAISE EXCEPTION 'FAIL rollback not exact';
  END IF;
  RAISE NOTICE 'PASS rollback exact (definitions, ACLs, comments of every public function), rollback re-run OK';
END $$;

-- ---------------------------------------------------------------- drift guards
CREATE FUNCTION public.prospect_fold(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261018_000933_find_clinics_locality.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regprocedure('public.prospect_region_key(text,text)') IS NOT NULL
     OR obj_description('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure, 'pg_proc') NOT LIKE '000929:%' THEN
    RAISE EXCEPTION 'FAIL drift guard let a foreign prospect_fold through';
  END IF;
  RAISE NOTICE 'PASS drift guard: foreign helper name refused, nothing applied';
END $$;
DROP FUNCTION public.prospect_fold(text);
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS 'hand edited';
\set ON_ERROR_STOP off
\ir ../migrations/20261018_000933_find_clinics_locality.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regprocedure('public.prospect_region_key(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL drift guard replaced a foreign find_clinic_prospects';
  END IF;
  RAISE NOTICE 'PASS drift guard: foreign find_clinic_prospects refused';
END $$;
COMMENT ON FUNCTION public.find_clinic_prospects(text, text, int, int) IS
  '000929: Find clinics for service_company members. Server-side filter/page (max 100)/aggregates. Free = 20 local rows + counts; Premium = paged rows.';

-- re-apply after rollback works
\ir ../migrations/20261018_000933_find_clinics_locality.sql
DO $$ BEGIN
  IF to_regprocedure('public.prospect_region_key(text,text)') IS NULL THEN RAISE EXCEPTION 'FAIL re-apply'; END IF;
  RAISE NOTICE 'PASS re-apply after rollback';
END $$;
