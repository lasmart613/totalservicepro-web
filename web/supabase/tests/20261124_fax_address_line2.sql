-- Local proof for 20261124_000976_fax_address_line2.sql and its rollback.
-- Empty Postgres scratch database only (never production, never the live project).
-- Synthetic ids only. Does not use orgs 4, 153, 154, 1005, 2616, 5509, 5515, 5516, 5517.
--
--   createdb fax_line2_proof
--   psql "postgresql:///fax_line2_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261124_fax_address_line2.sql
--   dropdb fax_line2_proof
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id bigint PRIMARY KEY,
  name text,
  type text,
  address text,
  city text,
  state text,
  zip text,
  country text,
  phone text,
  alt_phone text,
  email text,
  tax_id text,
  created_by uuid,
  laser_models text,
  facility_type text
);
CREATE TABLE public.contacts (
  id bigint PRIMARY KEY,
  organization_id bigint,
  phone text,
  first_name text
);
CREATE TABLE public.locations (
  id bigint PRIMARY KEY,
  organization_id bigint,
  address text,
  city text,
  state text,
  zip text,
  phone text
);
CREATE TABLE public.sites (
  id bigint PRIMARY KEY,
  organization_id bigint,
  address text,
  city text,
  state text,
  zip text
);
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY,
  phone text,
  address_line1 text,
  role text
);
CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY,
  customer_address text,
  customer_phone text,
  tech_company_address text,
  tech_company_phone text,
  tech_phone text
);
CREATE TABLE public.service_tickets (
  id bigint PRIMARY KEY,
  address text,
  customer_address text,
  customer_phone text
);
CREATE TABLE public.clinic_service_leads (
  id uuid PRIMARY KEY,
  phone text
);
CREATE TABLE public.directory_registrations (
  id uuid PRIMARY KEY,
  organization_id bigint,
  details jsonb
);

-- organizations: column SELECT, like 000932. tax_id stays private.
REVOKE ALL ON public.organizations FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, address, phone) ON public.organizations TO anon, authenticated;
GRANT INSERT (name, address, phone), UPDATE (name, address, phone) ON public.organizations TO authenticated;

REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_profiles TO anon, authenticated;
GRANT INSERT (phone, address_line1), UPDATE (phone, address_line1) ON public.user_profiles TO authenticated;

REVOKE ALL ON public.contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.contacts TO authenticated;
GRANT UPDATE (phone) ON public.contacts TO authenticated;

REVOKE ALL ON public.sites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sites TO authenticated;
GRANT UPDATE (address) ON public.sites TO authenticated;

GRANT SELECT ON public.locations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_reports TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_tickets TO anon, authenticated;
REVOKE ALL ON public.clinic_service_leads FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.directory_clean_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(coalesce(p, '')) $$;

CREATE OR REPLACE FUNCTION public.find_clinic_prospects(
  p_country text, p_city text, p_limit integer, p_offset integer)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  o public.organizations;
BEGIN
  RETURN jsonb_build_object(
    'address', o.address, 'city', o.city,
    'state', o.state, 'zip', o.zip, 'country', o.country, 'phone', o.phone,
    'address', o.address, 'city', o.city,
    'phone', o.phone
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.directory_registration_step2(p_registration_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  f jsonb := p_fields;
  v_clean jsonb;
BEGIN
  v_clean := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'contact_name', nullif(pg_catalog.left(public.directory_clean_text(f->>'contact_name'), 120), ''),
    'phone', nullif(pg_catalog.left(public.directory_clean_text(f->>'phone'), 40), ''),
    'alt_phone', nullif(pg_catalog.left(public.directory_clean_text(f->>'alt_phone'), 40), ''),
    'website', nullif(pg_catalog.left(public.directory_clean_text(f->>'website'), 200), ''),
    'address', nullif(pg_catalog.left(public.directory_clean_text(f->>'address'), 200), ''),
    'city', nullif(pg_catalog.left(public.directory_clean_text(f->>'city'), 80), ''),
    'state', nullif(pg_catalog.left(public.directory_clean_text(f->>'state'), 80), '')
  ));
  UPDATE public.organizations SET
    phone             = coalesce(v_clean->>'phone', phone),
    alt_phone         = coalesce(v_clean->>'alt_phone', alt_phone),
    address           = coalesce(v_clean->>'address', address),
    city              = coalesce(v_clean->>'city', city)
  WHERE false;
  RETURN v_clean;
END
$fn$;

CREATE OR REPLACE FUNCTION public.directory_registrations_for_review(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(pg_catalog.jsonb_agg(x), '[]'::jsonb)
  FROM (
    SELECT coalesce(o.phone, r.details->>'phone') AS phone,
           coalesce(o.email, r.details->>'email') AS email
    FROM public.organizations o
    JOIN public.directory_registrations r ON r.organization_id = o.id
    LIMIT p_limit
  ) x
$$;

CREATE OR REPLACE FUNCTION public.create_shop_customer_org(
  p_service_org bigint,
  p_name text,
  p_address text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text,
  p_state text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_laser_models text DEFAULT NULL::text,
  p_facility_type text DEFAULT 'Clinic'::text)
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE
  new_id bigint;
BEGIN
  IF char_length(btrim(p_name)) > 200
     OR char_length(btrim(coalesce(p_address, ''))) > 500
     OR char_length(btrim(coalesce(p_city, ''))) > 100
     OR char_length(btrim(coalesce(p_state, ''))) > 100
     OR char_length(btrim(coalesce(p_phone, ''))) > 50
     OR char_length(btrim(coalesce(p_laser_models, ''))) > 1000
     OR char_length(btrim(coalesce(p_facility_type, ''))) > 100 THEN
    RAISE EXCEPTION 'customer field too long (name 200, address 500, city 100, state 100, phone 50, laser models 1000, facility type 100 characters)'
      USING ERRCODE = '22001';
  END IF;
  INSERT INTO public.organizations (name, type, created_by, address, city, state, phone, laser_models, facility_type)
  VALUES (
    btrim(p_name), 'customer', NULL,
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_laser_models, '')), ''),
    coalesce(nullif(btrim(coalesce(p_facility_type, '')), ''), 'Clinic')
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shop_customer_org(bigint, text, text, text, text, text, text, text) TO authenticated, service_role;

CREATE TABLE public._snap_pre AS
SELECT 'col:' || c.table_name || '.' || c.column_name AS k,
       c.data_type || ':' || c.is_nullable AS v
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'organizations','contacts','locations','sites','user_profiles',
    'service_reports','service_tickets','clinic_service_leads'
  )
UNION ALL
SELECT 'con:' || conrelid::regclass::text || '.' || conname,
       pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype = 'c'
UNION ALL
SELECT 'acl:' || table_name || '.' || column_name || ':' || grantee || ':' || privilege_type,
       '1'
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'organizations','contacts','locations','sites','user_profiles',
    'service_reports','service_tickets','clinic_service_leads'
  )
UNION ALL
SELECT 'fn:' || p.oid::regprocedure::text,
       md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%';

-- ---------------------------------------------------------------- apply twice
\ir ../migrations/20261124_000976_fax_address_line2.sql
\ir ../migrations/20261124_000976_fax_address_line2.sql

DO $$
DECLARE
  fax_col text;
  line_col text;
BEGIN
  FOREACH fax_col IN ARRAY ARRAY[
    'organizations.fax','contacts.fax','locations.fax','user_profiles.fax',
    'service_reports.customer_fax','service_reports.tech_company_fax','service_reports.tech_fax',
    'service_tickets.customer_fax','clinic_service_leads.fax'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(fax_col, '.', 1)
        AND column_name = split_part(fax_col, '.', 2)
        AND data_type = 'text' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'FAIL missing nullable text %', fax_col;
    END IF;
  END LOOP;
  FOREACH line_col IN ARRAY ARRAY[
    'organizations.address_line2','locations.address_line2','sites.address_line2',
    'user_profiles.address_line2','service_reports.customer_address_line2',
    'service_reports.tech_company_address_line2','service_tickets.address_line2',
    'service_tickets.customer_address_line2'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = split_part(line_col, '.', 1)
        AND column_name = split_part(line_col, '.', 2)
        AND data_type = 'text' AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'FAIL missing nullable text %', line_col;
    END IF;
  END LOOP;

  IF NOT has_column_privilege('anon', 'public.organizations', 'fax', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.organizations', 'address_line2', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.organizations', 'fax', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.organizations', 'address_line2', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL organizations fax/line2 not granted like phone/address';
  END IF;
  IF has_column_privilege('anon', 'public.organizations', 'tax_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.organizations', 'tax_id', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL tax_id became selectable';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.user_profiles', 'fax', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.user_profiles', 'address_line2', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL user_profiles write grant';
  END IF;
  IF has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL user_profiles.role became writable';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.contacts', 'fax', 'UPDATE')
     OR has_column_privilege('anon', 'public.contacts', 'fax', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL contacts.fax grants';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.sites', 'address_line2', 'UPDATE')
     OR has_column_privilege('anon', 'public.sites', 'address_line2', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL sites.address_line2 grants';
  END IF;
  IF NOT has_column_privilege('anon', 'public.locations', 'fax', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.service_reports', 'customer_fax', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL inherited SELECT missing where phone was already public';
  END IF;
  IF has_column_privilege('anon', 'public.clinic_service_leads', 'fax', 'SELECT')
     OR has_column_privilege('authenticated', 'public.clinic_service_leads', 'fax', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL clinic_service_leads.fax widened to clients';
  END IF;

  IF position('''fax'', o.fax' IN pg_get_functiondef('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure)) = 0
     OR position('''address_line2'', o.address_line2' IN pg_get_functiondef('public.find_clinic_prospects(text,text,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL find_clinic_prospects did not gain fax/address_line2';
  END IF;
  IF position('AS fax' IN pg_get_functiondef('public.directory_registrations_for_review(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL review RPC did not gain fax';
  END IF;
  IF position('v_clean->>''fax''' IN pg_get_functiondef('public.directory_registration_step2(uuid,jsonb)'::regprocedure)) = 0
     OR position('address_line2' IN pg_get_functiondef('public.directory_registration_step2(uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL directory step2 did not store fax/address_line2';
  END IF;
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL old create_shop_customer_org signature still present';
  END IF;
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL new create_shop_customer_org signature missing';
  END IF;
  IF has_function_privilege('anon', 'public.fax_phone_ok(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fax_phone_ok(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL fax_phone_ok is callable by clients';
  END IF;
  RAISE NOTICE 'PASS columns, checks grants, and RPC lists';
END $$;

DO $$ BEGIN
  INSERT INTO public.organizations (id, name, fax, address_line2) VALUES (88001, 'QA Fax', '(602) 555-0123', 'Suite 4');
  BEGIN
    INSERT INTO public.organizations (id, name, fax) VALUES (88002, 'Bad', 'call me');
    RAISE EXCEPTION 'FAIL invalid fax accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.organizations (id, name, address_line2) VALUES (88003, 'Blank', '');
    RAISE EXCEPTION 'FAIL blank line 2 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.organizations (id, name, address_line2) VALUES (88004, 'Long', repeat('a', 201));
    RAISE EXCEPTION 'FAIL long line 2 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT fax FROM public.organizations WHERE id = 88001) <> '(602) 555-0123' THEN
    RAISE EXCEPTION 'FAIL stored fax';
  END IF;
  RAISE NOTICE 'PASS fax shape and line 2 length';
END $$;

-- ---------------------------------------------------------------- rollback exact, twice
\ir ../migrations/20261124_000976_fax_address_line2_rollback.sql
\ir ../migrations/20261124_000976_fax_address_line2_rollback.sql

CREATE TABLE public._snap_post AS
SELECT 'col:' || c.table_name || '.' || c.column_name AS k,
       c.data_type || ':' || c.is_nullable AS v
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'organizations','contacts','locations','sites','user_profiles',
    'service_reports','service_tickets','clinic_service_leads'
  )
UNION ALL
SELECT 'con:' || conrelid::regclass::text || '.' || conname,
       pg_get_constraintdef(oid)
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype = 'c'
UNION ALL
SELECT 'acl:' || table_name || '.' || column_name || ':' || grantee || ':' || privilege_type,
       '1'
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'organizations','contacts','locations','sites','user_profiles',
    'service_reports','service_tickets','clinic_service_leads'
  )
UNION ALL
SELECT 'fn:' || p.oid::regprocedure::text,
       md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, '')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname NOT LIKE '\_%';

DO $$
DECLARE d text;
BEGIN
  IF to_regprocedure('public.fax_phone_ok(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL fax_phone_ok survived rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name IN ('fax', 'address_line2', 'customer_fax', 'customer_address_line2')
      AND table_name IN (
        'organizations','contacts','locations','sites','user_profiles',
        'service_reports','service_tickets','clinic_service_leads'
      )
  ) THEN
    RAISE EXCEPTION 'FAIL a fax/line2 column survived rollback';
  END IF;
  SELECT string_agg(x.k || ' = ' || x.v, '; ' ORDER BY x.k) INTO d FROM (
    (SELECT 'pre ' || k AS k, v FROM public._snap_pre EXCEPT SELECT 'pre ' || k, v FROM public._snap_post)
    UNION ALL
    (SELECT 'post ' || k, v FROM public._snap_post EXCEPT SELECT 'post ' || k, v FROM public._snap_pre)
  ) x;
  IF d IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL rollback not exact: %', d;
  END IF;
  RAISE NOTICE 'PASS rollback exact (columns, checks, column ACLs, function bodies and ACLs), rollback re-run OK';
END $$;
