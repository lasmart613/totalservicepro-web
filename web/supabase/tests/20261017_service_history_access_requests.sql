-- Local proof for 20261017_000922_service_history_access_requests.sql and its
-- rollback. Empty Postgres 17 only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
-- Works from any directory (\ir paths are relative to this file).
--
--   createdb history_requests_proof
--   psql "postgresql:///history_requests_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261017_service_history_access_requests.sql
--
-- Base = prod order: 000919 -> 000920 -> 000921 (all live since 2026-10-17),
-- on the 000921 proof's fixture (live helper bodies), then 000923 (fixture
-- copy of fix/clinic-claim-invite-binding @ 168d4f6a), then 000922.
--
-- Negative run (QA #314 L-B: 000922 must fail cleanly without 000923):
--   psql ... -v ON_ERROR_STOP=1 -v skip923=1 -f <this file>
-- must exit non-zero, and its only ERROR must be
--   "000922 requires 000923 (clinic owner invite binding): apply 000923 first"
-- with nothing of 000922 created (the run stops at its first statement).
-- Fixture data only. T01..T30 are the plan's test cases (/workspace/teaser/PLAN.md §6);
-- T14 (true two-session race) also runs in the harness race script; T29/T30
-- (route + preview) are covered by the Node tests / build.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

BEGIN;

BEGIN;

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

CREATE TABLE public.organizations (id bigint PRIMARY KEY, name text NOT NULL, type text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  address text, city text, state text, phone text, laser_models text, facility_type text, updated_at timestamptz);
CREATE TABLE public.service_tickets (id bigserial PRIMARY KEY, organization_id bigint, customer_organization_id bigint);
-- 000910's table (live), needed only so 000919 can be applied on top.
CREATE TABLE public.document_send_slots (id bigserial PRIMARY KEY, organization_id text NOT NULL, document_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_send_slots_document_type_check CHECK (document_type IN ('invoice', 'estimate', 'report', 'purchase_order')));
CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL, organization_id bigint NOT NULL REFERENCES public.organizations(id), role text, is_home boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now(), UNIQUE (user_id, organization_id));
CREATE TABLE public.organization_customers (id bigserial PRIMARY KEY, service_organization_id bigint REFERENCES public.organizations(id), customer_organization_id bigint REFERENCES public.organizations(id), created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz, first_service_date timestamptz, notes text, UNIQUE (service_organization_id, customer_organization_id));
CREATE TABLE public.engineer_invitations (id bigserial PRIMARY KEY, organization_id bigint, email text, role text, accepted boolean, invited_by uuid);
CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, organization_id bigint, active_organization_id bigint);
CREATE TABLE public.equipment (id bigserial PRIMARY KEY, customer_organization_id bigint REFERENCES public.organizations(id), serial_number text, model text, CONSTRAINT equipment_unique_sn_per_customer UNIQUE (customer_organization_id, serial_number));
CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id bigint, created_by uuid, customer_organization_id bigint,
  equipment_id bigint, serial_number text, title text, report_number text, status text, service_type text, model_type text,
  equipment_name text, equipment_type text, date_out date, next_pm_due date, created_at timestamptz DEFAULT now(),
  finalized_at timestamptz, tech_company_name text, comments text, pdf_url text, tech_signature text, customer_phone text);

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = p_org
  );
$function$;
CREATE OR REPLACE FUNCTION public.get_my_org_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT p.active_organization_id
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.active_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships m
          WHERE m.user_id = auth.uid()
            AND m.organization_id = p.active_organization_id
        )
      LIMIT 1
    ),
    (
      SELECT m.organization_id
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
      ORDER BY m.is_home DESC NULLS LAST, m.created_at ASC NULLS LAST
      LIMIT 1
    )
  );
$function$;
CREATE OR REPLACE FUNCTION public.org_unclaimed_new(p_org bigint, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_at IS NOT NULL
    AND p_created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.customer_organization_id = p_org
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_org
    );
$function$;
CREATE OR REPLACE FUNCTION public.org_creator_access(p_org bigint, p_created_by uuid, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_by IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_created_by = auth.uid()
    AND (
      public.is_active_org_member(p_org)
      OR EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = p_org
          AND public.is_active_org_member(oc.service_organization_id)
      )
      OR public.org_unclaimed_new(p_org, p_created_at)
    );
$function$;
CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    org_id IS NOT NULL
    AND (
      (
        org_id = public.get_my_org_id()
        AND public.is_active_org_member(org_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND public.org_creator_access(o.id, o.created_by, o.created_at)
      )
    );
$function$;
CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND public.is_active_org_member(p_service)
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_customer
        AND o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_customer
          AND o.type = 'customer'
          AND o.created_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = o.created_by
              AND m.organization_id = p_service
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
         AND lower(m.role) IN ('company_admin', 'owner', 'service_manager', 'crm')
        WHERE i.organization_id = p_customer
          AND i.accepted IS TRUE
          AND lower(coalesce(i.role, '')) = 'owner'
      )
    );
$function$;

-- Live ACL: customer_org_link_allowed is not executable by PUBLIC/anon.
REVOKE ALL ON FUNCTION public.customer_org_link_allowed(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_org_link_allowed(bigint, bigint) TO authenticated, service_role;

-- Live ACL: org_creator_access is not executable by PUBLIC/anon.
REVOKE ALL ON FUNCTION public.org_creator_access(bigint, uuid, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_creator_access(bigint, uuid, timestamp with time zone) TO authenticated, service_role;

-- Extra live columns this feature reads (prod information_schema, 2026-10-17).
ALTER TABLE public.service_tickets ADD COLUMN assigned_to uuid, ADD COLUMN status text, ADD COLUMN service_date date,
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.user_profiles ADD COLUMN email text, ADD COLUMN first_name text, ADD COLUMN last_name text,
  ADD COLUMN notification_prefs jsonb, ADD COLUMN is_active boolean DEFAULT true;
ALTER TABLE public.equipment ADD COLUMN manufacturer text;
-- Live columns / tables 000923 needs (prod information_schema).
ALTER TABLE public.organizations ADD COLUMN email text, ADD COLUMN directory_contacts jsonb;
ALTER TABLE public.user_profiles ADD COLUMN role text;
CREATE TABLE public.contacts (id bigserial PRIMARY KEY, organization_id bigint, first_name text, last_name text, title text,
  phone text, email text, is_primary boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

-- Prod order: 000919 -> 000920 -> 000921.
\ir ../migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql
\ir ../migrations/20261017_000920_service_history_owner_consent.sql

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_organizations_select ON public.organizations FOR SELECT USING (true);
CREATE POLICY equipment_facility_manage ON public.equipment TO authenticated
  USING (public.user_owns_or_created_org(customer_organization_id))
  WITH CHECK (public.user_owns_or_created_org(customer_organization_id));
CREATE POLICY service_reports_equipment_history_select ON public.service_reports FOR SELECT TO authenticated
  USING (public.can_view_service_report_for_history(service_reports.*));
CREATE POLICY service_reports_select ON public.service_reports FOR SELECT TO authenticated
  USING ((((organization_id)::text = (SELECT (user_profiles.organization_id)::text FROM public.user_profiles WHERE user_profiles.id = auth.uid() LIMIT 1)) AND public.is_active_org_member(organization_id)) OR ((created_by = auth.uid()) AND public.is_active_org_member(organization_id)));
CREATE POLICY organization_customers_insert_linked ON public.organization_customers FOR INSERT TO authenticated
  WITH CHECK (public.customer_org_link_allowed(service_organization_id, customer_organization_id));
GRANT SELECT ON public.organizations, public.organization_memberships, public.user_profiles, public.engineer_invitations, public.service_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment, public.service_reports, public.organization_customers TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Fixtures (all local, fake ids).
--  1 Shop L: linked to Clinic C and Clinic U. b1 company_admin, b2 fse assigned
--    a C ticket, b3 fse with no C ticket.
--  2 Shop P: C's previous shop (link gone). a1 company_admin. Wrote P-1..P-4.
--  3 Shop Z: stranger, linked to Clinic D. e1 company_admin.
-- 10 Clinic C: claimed. c1 owner, c2 staff, c3 manager (email opt-out).
-- 11 Clinic D: claimed. f1 owner. Its laser E3 has C's laser serial (SN-1).
-- 12 Clinic U: linked to L, NO members (unclaimed).
INSERT INTO public.organizations (id, name, type, created_by, created_at) VALUES
  (1, 'Shop L', 'service_company', NULL, now() - interval '1 year'),
  (2, 'Shop P', 'service_company', NULL, now() - interval '1 year'),
  (3, 'Shop Z', 'service_company', NULL, now() - interval '1 year'),
  (10, 'Clinic C', 'customer', NULL, now() - interval '1 year'),
  (11, 'Clinic D', 'laser_clinic', NULL, now() - interval '1 year'),
  (12, 'Clinic U', 'customer', NULL, now() - interval '1 year');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 1, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000b2', 1, 'fse', true),
  ('00000000-0000-0000-0000-0000000000b3', 1, 'fse', true),
  ('00000000-0000-0000-0000-0000000000a1', 2, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000e1', 3, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000c1', 10, 'owner', true),
  ('00000000-0000-0000-0000-0000000000c2', 10, 'staff', true),
  ('00000000-0000-0000-0000-0000000000c3', 10, 'manager', true),
  ('00000000-0000-0000-0000-0000000000f1', 11, 'owner', true);
INSERT INTO public.user_profiles (id, organization_id, active_organization_id, email, first_name, last_name, notification_prefs) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 1, 1, 'b1@shop-l.test', 'Bea', 'Admin', NULL),
  ('00000000-0000-0000-0000-0000000000b2', 1, 1, 'b2@shop-l.test', 'Ben', 'Tech', NULL),
  ('00000000-0000-0000-0000-0000000000b3', 1, 1, 'b3@shop-l.test', 'Bo', 'Tech', NULL),
  ('00000000-0000-0000-0000-0000000000a1', 2, 2, 'a1@shop-p.test', 'Al', 'P', NULL),
  ('00000000-0000-0000-0000-0000000000e1', 3, 3, 'e1@shop-z.test', 'Ed', 'Z', NULL),
  ('00000000-0000-0000-0000-0000000000c1', 10, 10, 'c1@clinic-c.test', 'Cara', 'Owner', NULL),
  ('00000000-0000-0000-0000-0000000000c2', 10, 10, 'c2@clinic-c.test', 'Cy', 'Staff', NULL),
  ('00000000-0000-0000-0000-0000000000c3', 10, 10, 'c3@clinic-c.test', 'Cam', 'Manager', '{"notif_history_request_email": false}'),
  ('00000000-0000-0000-0000-0000000000f1', 11, 11, 'f1@clinic-d.test', 'Fay', 'Owner', NULL);
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (1, 10), (1, 12), (3, 11);
INSERT INTO public.service_tickets (id, organization_id, customer_organization_id, assigned_to, status, service_date) VALUES
  (1, 1, 10, '00000000-0000-0000-0000-0000000000b2', 'Scheduled', current_date + 3);
INSERT INTO public.equipment (id, customer_organization_id, serial_number, model, manufacturer) VALUES
  (1, 10, 'SN-1', 'GentleMax', 'Candela'),
  (2, 10, 'SN-2', 'Vbeam', 'Candela'),
  (3, 11, 'SN-1', 'GentleMax', 'Candela'),
  (4, 12, 'SN-U', 'Lumenis M22', 'Lumenis');
SELECT setval('public.equipment_id_seq', 100);
INSERT INTO public.service_reports (id, organization_id, created_by, customer_organization_id, equipment_id, serial_number, title, report_number, status, service_type, equipment_name, tech_company_name, comments, date_out, finalized_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000a1', 10, 1, 'SN-1', 'P-1', 'ACME-SR-1', 'complete', 'PM', 'ACME special', 'ACME Lasers', 'SECRET P1', '2026-03-04', NULL),
  ('10000000-0000-0000-0000-000000000002', 2, '00000000-0000-0000-0000-0000000000a1', 10, NULL, ' sn-1 ', 'P-2', 'ACME-SR-2', 'draft', 'Repair', 'ACME', 'ACME Lasers', 'SECRET P2', '2026-02-01', now()),
  ('10000000-0000-0000-0000-000000000003', 2, '00000000-0000-0000-0000-0000000000a1', 10, 1, 'SN-1', 'P-3', 'ACME-SR-3', 'complete', 'ACME deluxe tune by Al', 'ACME', 'ACME Lasers', 'SECRET P3', '2026-01-15', NULL),
  ('10000000-0000-0000-0000-000000000004', 2, '00000000-0000-0000-0000-0000000000a1', 10, 1, 'SN-1', 'P-4', 'ACME-SR-4', 'draft', 'PM', 'ACME', 'ACME Lasers', 'SECRET P4', '2026-04-01', NULL),
  ('10000000-0000-0000-0000-000000000005', 2, '00000000-0000-0000-0000-0000000000a1', 10, 1, 'SN-1', 'P-5', 'ACME-SR-5', 'complete', 'PM+Repair', 'ACME', 'ACME Lasers', 'SECRET P5', '2025-12-01', NULL),
  ('20000000-0000-0000-0000-000000000001', 1, '00000000-0000-0000-0000-0000000000b1', 10, 1, 'SN-1', 'L-1', 'LSH-SR-1', 'complete', 'PM', 'L', 'Shop L', 'L own', '2026-05-01', NULL),
  ('30000000-0000-0000-0000-000000000001', 3, '00000000-0000-0000-0000-0000000000e1', 11, 3, 'SN-1', 'D-1', 'ZZZ-SR-1', 'complete', 'PM', 'Z', 'Shop Z', 'SECRET D1', '2026-06-01', NULL),
  ('30000000-0000-0000-0000-000000000002', 3, '00000000-0000-0000-0000-0000000000e1', 11, NULL, 'SN-1', 'D-2', 'ZZZ-SR-2', 'complete', 'PM', 'Z', 'Shop Z', 'SECRET D2', '2026-06-02', NULL),
  ('40000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000a1', 12, 4, 'SN-U', 'U-1', 'ACME-SR-U', 'complete', 'PM', 'ACME', 'ACME Lasers', 'SECRET U', '2026-02-02', NULL);

CREATE FUNCTION pg_temp.as_user(u text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE stmt INTO t;
    t := 'OK ' || COALESCE(t, '(null)');
  EXCEPTION WHEN others THEN
    t := 'ERR ' || SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.as_role(r text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE stmt INTO t;
    t := 'OK ' || COALESCE(t, '(null)');
  EXCEPTION WHEN others THEN
    t := 'ERR ' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '% FAILED: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS %: %', label, got;
END $$;
CREATE FUNCTION pg_temp.expect_like(label text, got text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NULL OR got NOT LIKE pat THEN RAISE EXCEPTION '% FAILED: got %, want LIKE %', label, got, pat; END IF;
  RAISE NOTICE 'PASS %: %', label, got;
END $$;
CREATE FUNCTION pg_temp.fingerprint() RETURNS text LANGUAGE sql AS $$
  SELECT md5(
    COALESCE((SELECT string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), ''), '|' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'), '')
    || '#' ||
    COALESCE((SELECT string_agg(tablename || '.' || policyname || ':' || cmd || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, '') || ':' || roles::text, '|' ORDER BY tablename, policyname)
       FROM pg_policies WHERE schemaname = 'public'), '')
    || '#' ||
    COALESCE((SELECT string_agg(c.relname || ':' || COALESCE(array_to_string(c.relacl, ','), ''), ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace) AND c.relkind IN ('r', 'S', 'i')), '')
  )
$$;
CREATE FUNCTION pg_temp.policies() RETURNS text LANGUAGE sql AS $$
  SELECT md5(COALESCE(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, '') || ':' || roles::text, '|' ORDER BY tablename, policyname), ''))
  FROM pg_policies WHERE schemaname = 'public'
$$;
CREATE TEMP TABLE fp (k text PRIMARY KEY, v text);
GRANT SELECT ON fp TO authenticated;

-- Short names for the users.
\set L_ADMIN '00000000-0000-0000-0000-0000000000b1'
\set L_TECH  '00000000-0000-0000-0000-0000000000b2'
\set L_TECH2 '00000000-0000-0000-0000-0000000000b3'
\set P_ADMIN '00000000-0000-0000-0000-0000000000a1'
\set Z_ADMIN '00000000-0000-0000-0000-0000000000e1'
\set C_OWNER '00000000-0000-0000-0000-0000000000c1'
\set C_STAFF '00000000-0000-0000-0000-0000000000c2'
\set C_MGR   '00000000-0000-0000-0000-0000000000c3'
\set D_OWNER '00000000-0000-0000-0000-0000000000f1'
-- d1: QA #314 M-1 dual member (clinic C admin AND shop L member), added later.
\set DUAL    '00000000-0000-0000-0000-0000000000d1'

\ir ../migrations/20261017_000921_linked_shop_own_reports.sql
SELECT pg_temp.expect('BASE 000919 applied (creator_shop_org_id column)', (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'public.organizations'::regclass AND attname = 'creator_shop_org_id' AND NOT attisdropped), '1');
SELECT pg_temp.expect('BASE 000921 applied (link blocks)', (to_regclass('public.organization_customer_link_blocks') IS NOT NULL)::text, 'true');
SELECT pg_temp.expect('BASE linked shop L reads only its own C report', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(title, ',' ORDER BY title) FROM public.service_reports WHERE customer_organization_id = 10$q$), 'OK L-1');

-- 000923 first (L-B). The negative run (-v skip923=1) leaves it out.
\if :{?skip923}
SELECT pg_temp.expect('NEG 000923 deliberately NOT applied', (to_regclass('public.clinic_owner_invites') IS NULL)::text, 'true');
\ir ../migrations/20261017_000922_service_history_access_requests.sql
SELECT pg_temp.expect('NEG FAILED: 000922 applied without 000923', 'applied', 'refused');
\else
\ir fixtures/000923_clinic_claim_invite_binding_at_168d4f6a.sql
SELECT pg_temp.expect('BASE 000923 applied (clinic_owner_invites, membership guard)',
  (to_regclass('public.clinic_owner_invites') IS NOT NULL AND to_regprocedure('public.guard_clinic_owner_membership()') IS NOT NULL)::text, 'true');
\endif

INSERT INTO fp VALUES ('pre922', pg_temp.fingerprint()), ('policies', pg_temp.policies());
INSERT INTO fp SELECT 'md5:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f';

-- ===================================================================== 000922
\ir ../migrations/20261017_000922_service_history_access_requests.sql

SELECT pg_temp.expect('base grant_service_history body = live prod body (md5 c4b6de79...)',
  (SELECT v FROM fp WHERE k = 'md5:grant_service_history(bigint,bigint,bigint)'), 'c4b6de797b5e6ee4efcb918aa5137d69');
SELECT pg_temp.expect('M-1 000922 redefines grant_service_history (and only that existing function)',
  (SELECT string_agg(substr(k, 5), ',') FROM fp WHERE k LIKE 'md5:%' AND v <> md5(pg_get_functiondef(substr(k, 5)::regprocedure))), 'grant_service_history(bigint,bigint,bigint)');
SELECT pg_temp.expect('M-1 grant_service_history keeps SECURITY DEFINER, search_path "", no anon/PUBLIC',
  (SELECT prosecdef::text || ':' || array_to_string(proconfig, ',') || ':' || has_function_privilege('anon', oid, 'EXECUTE')::text || ':' || has_function_privilege('authenticated', oid, 'EXECUTE')::text
     FROM pg_proc WHERE oid = 'public.grant_service_history(bigint,bigint,bigint)'::regprocedure), 'true:search_path="":false:true');
SELECT pg_temp.expect('no RLS policy added or changed by 000922 (no widening)', pg_temp.policies(), (SELECT v FROM fp WHERE k = 'policies'));
SELECT pg_temp.expect('re-run is safe (idempotent)', 'ok', 'ok');
\ir ../migrations/20261017_000922_service_history_access_requests.sql
SELECT pg_temp.expect('one HMAC key after re-run', (SELECT count(*)::text FROM private.service_history_ref_keys), '1');

-- Function hygiene.
SELECT pg_temp.expect('all 000922 functions SECURITY DEFINER, search_path ""',
  (SELECT string_agg(proname || '=' || prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' ORDER BY proname)
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
       'take_service_history_slot','service_history_teaser_eligible','service_history_title','service_history_teaser_rows',
       'service_history_can_request','get_locked_service_history_teaser','request_service_history_access',
       'list_my_service_history_requests','list_incoming_service_history_requests','list_owner_service_history_grants',
       'respond_to_service_history_request','service_history_request_notice')),
  'get_locked_service_history_teaser=true:search_path="" list_incoming_service_history_requests=true:search_path="" list_my_service_history_requests=true:search_path="" list_owner_service_history_grants=true:search_path="" request_service_history_access=true:search_path="" respond_to_service_history_request=true:search_path="" service_history_can_request=true:search_path="" service_history_request_notice=true:search_path="" service_history_teaser_eligible=true:search_path="" service_history_teaser_rows=true:search_path="" service_history_title=true:search_path="" take_service_history_slot=true:search_path=""');

-- T06 anon and client privileges.
SELECT pg_temp.expect('T06 anon executes none of the 000922 functions',
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
       'take_service_history_slot','service_history_teaser_eligible','service_history_title','service_history_teaser_rows',
       'service_history_can_request','get_locked_service_history_teaser','request_service_history_access',
       'list_my_service_history_requests','list_incoming_service_history_requests','list_owner_service_history_grants',
       'respond_to_service_history_request','service_history_request_notice')), 'false');
SELECT pg_temp.expect('T06 authenticated cannot run internal helpers / slot / notice',
  (has_function_privilege('authenticated', 'public.take_service_history_slot(text,text,integer,interval)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.service_history_request_notice(bigint)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.service_history_teaser_rows(bigint,bigint,bigint)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.service_history_teaser_eligible(bigint,bigint,bigint)', 'EXECUTE')
   OR has_function_privilege('authenticated', 'public.service_history_can_request(bigint,bigint)', 'EXECUTE'))::text, 'false');
SELECT pg_temp.expect('T06 service_role may take email slots and read notices',
  (has_function_privilege('service_role', 'public.take_service_history_slot(text,text,integer,interval)', 'EXECUTE')
   AND has_function_privilege('service_role', 'public.service_history_request_notice(bigint)', 'EXECUTE'))::text, 'true');
SELECT pg_temp.expect('T06 clients cannot read requests / slots / key tables',
  pg_temp.as_user(:'C_OWNER', 'SELECT count(*)::text FROM public.service_history_requests') || ' | ' ||
  pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.service_history_slots') || ' | ' ||
  pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM private.service_history_ref_keys'),
  'ERR 42501 permission denied for table service_history_requests | ERR 42501 permission denied for table service_history_slots | ERR 42501 permission denied for schema private');
SELECT pg_temp.expect('T06 anon cannot call the teaser', pg_temp.as_role('anon', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501');
SELECT pg_temp.expect('T06 signed-out authenticated is refused', pg_temp.as_user('', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not signed in');

-- T01 enumeration: one error for every not-eligible case.
SELECT pg_temp.expect('T01 stranger shop Z on C/E1', pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 stranger: non-existent equipment', pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 99999)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 stranger: random owner id', pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(424242, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 stranger: own clinic D with C''s laser id', pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(11, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 previous shop P (link gone)', pg_temp.as_user(:'P_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 clinic member is not a shop', pg_temp.as_user(:'C_OWNER', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 request refused the same way', pg_temp.as_user(:'Z_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T01 failed probes take no slot', (SELECT count(*)::text FROM public.service_history_slots), '0');

-- T02 linked shop, other clinic's laser.
SELECT pg_temp.expect('T02 L asks C for D''s laser E3', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 3)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T02 L asks D (not linked) for E3', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(11, 3)'), 'ERR 42501 not available for this laser');

-- T07 output is exactly (ref, title, service_date).
SELECT pg_temp.expect('T07 teaser result columns',
  pg_get_function_result('public.get_locked_service_history_teaser(bigint,bigint)'::regprocedure),
  'TABLE(ref text, title text, service_date date)');

-- T09/T08 teaser content for L on C/E1.
SELECT pg_temp.expect('T09 L sees P-1, P-2 (null equipment, serial of C''s row), P-3, P-5; not draft P-4, own L-1, D''s D-1/D-2',
  pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(service_date::text || ' ' || title, ' | ' ORDER BY service_date DESC) FROM public.get_locked_service_history_teaser(10, 1)$q$),
  'OK 2026-03-04 Preventive maintenance | 2026-02-01 Repair | 2026-01-15 Service report | 2025-12-01 PM + repair');
SELECT pg_temp.expect('T08 no shop / tech / report number / notes / free text in any teaser value',
  pg_temp.as_user(:'L_ADMIN', $q$SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1) t
     WHERE (t.ref || t.title || t.service_date::text) ~* '(acme|shop|secret|sr-|al\b|deluxe|special|lasers)'$q$), 'OK 0');
SELECT pg_temp.expect('T08 weird service_type falls back to "Service report"', public.service_history_title('ACME deluxe tune by Al'), 'Service report');
SELECT pg_temp.expect('T08 title list', public.service_history_title(' pm ') || '/' || public.service_history_title('PM + Repair') || '/' || public.service_history_title(NULL), 'Preventive maintenance/PM + repair/Service report');
SELECT pg_temp.expect('T09 empty laser E2: no rows', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 2)'), 'OK 0');
SELECT pg_temp.expect('T09 any active L member sees the teaser (tech without ticket)', pg_temp.as_user(:'L_TECH2', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 4');

-- T10 refs.
SELECT pg_temp.expect('T10 refs are 32 hex chars, not uuids, not report ids',
  pg_temp.as_user(:'L_ADMIN', $q$SELECT bool_and(ref ~ '^[0-9a-f]{32}$' AND ref NOT IN (SELECT id::text FROM public.service_reports) AND ref NOT LIKE '%-%')::text FROM public.get_locked_service_history_teaser(10, 1)$q$), 'OK true');
INSERT INTO fp SELECT 'refL', string_agg(ref, ',' ORDER BY report_id) FROM public.service_history_teaser_rows(1, 10, 1);
SELECT pg_temp.expect('T10 refs differ per shop for the same report',
  ((SELECT string_agg(ref, ',' ORDER BY report_id) FROM public.service_history_teaser_rows(3, 10, 1)) <> (SELECT v FROM fp WHERE k = 'refL'))::text, 'true');
SELECT pg_temp.expect('T10 refs are stable across calls',
  ((SELECT string_agg(ref, ',' ORDER BY report_id) FROM public.service_history_teaser_rows(1, 10, 1)) = (SELECT v FROM fp WHERE k = 'refL'))::text, 'true');

-- T03 serial attack (H2): shop Z puts C's serial on its own clinic D; D's
-- teaser never includes C's reports, and C's teaser never includes D's.
SELECT pg_temp.expect('T03 Z on its own clinic D/E3 (serial SN-1) sees none of C''s reports',
  pg_temp.as_user(:'Z_ADMIN', $q$SELECT count(*)::text FROM public.service_history_teaser_rows(3, 11, 3)$q$), 'ERR 42501 permission denied for function service_history_teaser_rows');
SELECT pg_temp.expect('T03 (as definer) D/E3 rows for Z = none of C''s (Z wrote D''s)', (SELECT count(*)::text FROM public.service_history_teaser_rows(3, 11, 3)), '0');
SELECT pg_temp.expect('T03 (as definer) D/E3 rows for another shop = only D''s own reports', (SELECT string_agg(service_date::text, ',' ORDER BY service_date) FROM public.service_history_teaser_rows(1, 11, 3)), '2026-06-01,2026-06-02');
SELECT pg_temp.expect('T03 Z (linked to D) teaser on D/E3: D is claimed, Z wrote everything -> empty',
  pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(11, 3)'), 'OK 0');
-- Z creates a fresh customer org X and adds C's serial: not claimed -> no teaser.
INSERT INTO public.organizations (id, name, type, created_by, created_at) VALUES (20, 'Fake X', 'customer', :'Z_ADMIN', now() - interval '2 days');
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (3, 20);
INSERT INTO public.equipment (id, customer_organization_id, serial_number, model) VALUES (20, 20, 'SN-1', 'GentleMax');
SELECT pg_temp.expect('T03 fake clinic X with C''s serial: unclaimed, no teaser',
  pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(20, 20)'), 'ERR 42501 clinic_unclaimed');

-- T04 claim attack (000919): an L tech cannot join U to make it "claimed".
SELECT pg_temp.expect('T04 unclaimed linked U: teaser says clinic_unclaimed',
  pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(12, 4)'), 'ERR 42501 clinic_unclaimed');
SELECT pg_temp.expect_like('T04 shop staff cannot become a member of the shop''s clinic (000919 trigger)',
  (SELECT pg_temp.as_role('service_role', $q$INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES ('00000000-0000-0000-0000-0000000000b2', 12, 'owner') RETURNING 'x'$q$)), 'ERR %');
SELECT pg_temp.expect('T04 still unclaimed after the attempt',
  pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(12, 4)'), 'ERR 42501 clinic_unclaimed');

-- Requesters (decision: shop owner/admin + techs assigned to that clinic).
SELECT pg_temp.expect('REQ tech with no ticket for C is refused',
  pg_temp.as_user(:'L_TECH2', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 only a shop owner or admin, or a tech assigned to this clinic, can ask for history');
SELECT pg_temp.expect('T17 a laser with no locked rows cannot be requested',
  pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 2)'), 'ERR 22023 no locked history on this laser');

-- L-3 tech eligibility: assigned to an open ticket, or one serviced/updated in 90 days; never Cancelled.
UPDATE public.service_tickets SET status = 'Completed', service_date = current_date - 200, created_at = now() - interval '200 days', updated_at = now() - interval '120 days' WHERE id = 1;
SELECT pg_temp.expect('L-3 tech whose only C ticket was completed > 90 days ago is refused',
  pg_temp.as_user(:'L_TECH', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 only a shop owner or admin, or a tech assigned to this clinic, can ask for history');
UPDATE public.service_tickets SET status = 'Cancelled', service_date = current_date + 3, updated_at = now() WHERE id = 1;
SELECT pg_temp.expect('L-3 tech assigned only to a Cancelled C ticket is refused',
  pg_temp.as_user(:'L_TECH', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 only a shop owner or admin, or a tech assigned to this clinic, can ask for history');
UPDATE public.service_tickets SET status = 'Completed', service_date = current_date + 3650, updated_at = now() WHERE id = 1;
SELECT pg_temp.expect('I-3 tech whose C ticket is Completed but future-dated is refused',
  pg_temp.as_user(:'L_TECH', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 only a shop owner or admin, or a tech assigned to this clinic, can ask for history');
UPDATE public.service_tickets SET status = 'Completed', service_date = current_date - 200, updated_at = now() WHERE id = 1;
SELECT pg_temp.expect('I-3 an edit (updated_at bump) on an old Completed ticket does not re-open eligibility',
  pg_temp.as_user(:'L_TECH', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 only a shop owner or admin, or a tech assigned to this clinic, can ask for history');
UPDATE public.service_tickets SET status = 'Completed', service_date = current_date - 10, updated_at = now() - interval '200 days' WHERE id = 1;
SELECT pg_temp.expect('L-3 helper: tech with a C ticket completed 10 days ago may request',
  pg_temp.as_user(:'L_TECH', 'SELECT 1::text') || ':' || (SELECT pg_temp.as_role('postgres', $q$SELECT (set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true) IS NOT NULL AND public.service_history_can_request(1, 10))::text$q$)), 'OK 1:OK true');
UPDATE public.service_tickets SET status = 'Awaiting Scheduling', service_date = NULL, created_at = now() - interval '400 days', updated_at = now() - interval '400 days' WHERE id = 1;
SELECT pg_temp.expect('L-3 helper: tech on an OPEN (old) C ticket may request',
  (SELECT pg_temp.as_role('postgres', $q$SELECT (set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true) IS NOT NULL AND public.service_history_can_request(1, 10))::text$q$)), 'OK true');
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.service_tickets SET status = 'Scheduled', service_date = current_date + 3, created_at = now(), updated_at = now() WHERE id = 1;

-- T12 dedupe.
SELECT pg_temp.expect('T12 assigned tech requests E1 (with a clicked ref)',
  pg_temp.as_user(:'L_TECH', format($q$SELECT status || ':' || created::text FROM public.request_service_history_access(10, 1, %L)$q$,
     (SELECT ref FROM public.service_history_teaser_rows(1, 10, 1) WHERE report_id = '10000000-0000-0000-0000-000000000003'))), 'OK pending:true');
SELECT pg_temp.expect('T12 same request again: same row, created=false',
  pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:false');
SELECT pg_temp.expect('T12 one pending row', (SELECT count(*)::text FROM public.service_history_requests WHERE status = 'pending'), '1');
SELECT pg_temp.expect('T12 the dedupe hit took no request slot', (SELECT count(*)::text FROM public.service_history_slots WHERE bucket = 'request_shop'), '1');
SELECT pg_temp.expect('T12 ref resolved server-side to P-3, teaser_count 4, expires in 14 days',
  (SELECT requested_report_id::text || ' ' || teaser_count || ' ' || (expires_at - created_at)::text FROM public.service_history_requests), '10000000-0000-0000-0000-000000000003 4 14 days');
SELECT pg_temp.expect('T12 shop list has the one request', pg_temp.as_user(:'L_ADMIN', $q$SELECT count(*)::text FROM public.list_my_service_history_requests(1)$q$), 'OK 1');
-- T14 (single session): the partial unique index refuses a second pending row.
SELECT pg_temp.expect('T14 duplicate pending row refused by the unique index',
  pg_temp.as_role('postgres', $q$INSERT INTO public.service_history_requests (owner_org_id, requester_shop_org_id, equipment_id, requested_by) VALUES (10, 1, 1, '00000000-0000-0000-0000-0000000000b1') RETURNING 'x'$q$), 'ERR 23505');

-- Shop sees its request, without user ids.
SELECT pg_temp.expect('shop list shows the request', pg_temp.as_user(:'L_TECH2', 'SELECT status FROM public.list_my_service_history_requests(1)'), 'OK pending');
SELECT pg_temp.expect('shop list has no user ids', pg_temp.as_user(:'L_TECH2', 'SELECT requested_by::text FROM public.list_my_service_history_requests(1)'), 'ERR 42703 column "requested_by" does not exist');
SELECT pg_temp.expect('other shop lists nothing', pg_temp.as_user(:'Z_ADMIN', 'SELECT count(*)::text FROM public.list_my_service_history_requests()'), 'OK 0');

-- Owner inbox.
SELECT pg_temp.expect('owner inbox: real shop name, laser, count, requested row title/date, requester name',
  pg_temp.as_user(:'C_OWNER', $q$SELECT shop_name || '|' || manufacturer || ' ' || model || '|' || serial_number || '|' || teaser_count || '|' || requested_title || '|' || requested_date || '|' || requested_by_name || '|' || status || '|' || total_count FROM public.list_incoming_service_history_requests(10)$q$),
  'OK Shop L|Candela GentleMax|SN-1|4|Service report|2026-01-15|Ben Tech|pending|1');
SELECT pg_temp.expect('manager (owner-admin role) sees the inbox', pg_temp.as_user(:'C_MGR', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'OK 1');
SELECT pg_temp.expect('plain clinic staff cannot see the inbox', pg_temp.as_user(:'C_STAFF', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'ERR 42501 only an owner or admin of this facility can see its history requests');
SELECT pg_temp.expect('shop cannot see the clinic inbox', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'ERR 42501 only an owner or admin of this facility can see its history requests');
SELECT pg_temp.expect('other clinic owner cannot see C''s inbox', pg_temp.as_user(:'D_OWNER', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'ERR 42501 only an owner or admin of this facility can see its history requests');

-- Notice for the server route: owner admins only, opt-out honoured.
SELECT pg_temp.expect('notice: owner recipients = owner + manager (not staff); manager opted out of email',
  (SELECT string_agg((r->>'email') || ':' || (r->>'email_ok'), ',' ORDER BY r->>'email') FROM jsonb_array_elements(public.service_history_request_notice((SELECT id FROM public.service_history_requests LIMIT 1))->'owner_recipients') r),
  'c1@clinic-c.test:true,c3@clinic-c.test:false');
SELECT pg_temp.expect('notice: shop recipients = requester + shop admins',
  (SELECT string_agg((r->>'email') || ':' || (r->>'is_requester'), ',' ORDER BY r->>'email') FROM jsonb_array_elements(public.service_history_request_notice((SELECT id FROM public.service_history_requests LIMIT 1))->'shop_recipients') r),
  'b1@shop-l.test:false,b2@shop-l.test:true');
SELECT pg_temp.expect('notice: names', (SELECT n->>'shop_name' || '|' || (n->>'owner_name') || '|' || (n->>'laser') FROM public.service_history_request_notice((SELECT id FROM public.service_history_requests LIMIT 1)) n), 'Shop L|Clinic C|Candela GentleMax');
SELECT pg_temp.expect('notice: unknown id -> null', (public.service_history_request_notice(999999) IS NULL)::text, 'true');

-- T18-T22 forged / unsafe approvals.
INSERT INTO fp SELECT 'req1', id::text FROM public.service_history_requests;
SELECT pg_temp.expect('T18 shop tech approves its own request', pg_temp.as_user(:'L_TECH', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 42501 only an owner or admin of this facility can answer this request');
SELECT pg_temp.expect('T18 shop admin approves', pg_temp.as_user(:'L_ADMIN', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$, $$all$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 42501 only an owner or admin of this facility can answer this request');
SELECT pg_temp.expect('T19 other clinic owner approves C''s request', pg_temp.as_user(:'D_OWNER', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 42501 only an owner or admin of this facility can answer this request');
SELECT pg_temp.expect('T19 plain clinic staff approves', pg_temp.as_user(:'C_STAFF', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 42501 only an owner or admin of this facility can answer this request');
SELECT pg_temp.expect('T20 non-existent id: same error', pg_temp.as_user(:'C_OWNER', 'SELECT status FROM public.respond_to_service_history_request(987654, $$approve$$)'), 'ERR 42501 only an owner or admin of this facility can answer this request');
SELECT pg_temp.expect('T18-20 no grant was created', (SELECT count(*)::text FROM public.service_history_grants), '0');
SELECT pg_temp.expect('T21 respond takes no owner/shop parameters',
  pg_get_function_identity_arguments('public.respond_to_service_history_request(bigint,text,text)'::regprocedure), 'p_request_id bigint, p_decision text, p_scope text');
SELECT pg_temp.expect('T21 bad decision', pg_temp.as_user(:'C_OWNER', format('SELECT status FROM public.respond_to_service_history_request(%s, $$maybe$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 22023 decision must be approve or deny');
SELECT pg_temp.expect('T21 grant_service_history still refuses the shop directly', pg_temp.as_user(:'L_ADMIN', 'SELECT public.grant_service_history(10, 1, 1)::text'), 'ERR 42501 only an owner or admin of this facility can share its service history');

-- M-1 dual member: d1 becomes a C admin AND an L member after the link was made
-- (simulates a membership gained through a path 000919 does not cover, e.g.
-- the pre-000923 claim; triggers are bypassed only to build the fixture).
SET LOCAL session_replication_role = replica;
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  (:'DUAL', 10, 'company_admin', false), (:'DUAL', 1, 'fse', true);
INSERT INTO public.user_profiles (id, organization_id, active_organization_id, email, first_name, last_name)
  VALUES (:'DUAL', 10, 10, 'd1@dual.test', 'Dee', 'Dual');
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect('M-1 dual member approves its own shop''s request (this laser): refused',
  pg_temp.as_user(:'DUAL', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))),
  'ERR 42501 only an owner or admin who is not part of the requesting company can answer this request');
SELECT pg_temp.expect('M-1 dual member approves with scope all: refused',
  pg_temp.as_user(:'DUAL', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$, $$all$$)', (SELECT v FROM fp WHERE k = 'req1'))),
  'ERR 42501 only an owner or admin who is not part of the requesting company can answer this request');
SELECT pg_temp.expect('M-1 dual member calls grant_service_history directly (all lasers): refused',
  pg_temp.as_user(:'DUAL', 'SELECT public.grant_service_history(10, 1, NULL)::text'),
  'ERR 42501 only an owner or admin who is not part of that service company can share with it');
SELECT pg_temp.expect('M-1 dual member calls grant_service_history directly (one laser): refused',
  pg_temp.as_user(:'DUAL', 'SELECT public.grant_service_history(10, 1, 1)::text'),
  'ERR 42501 only an owner or admin who is not part of that service company can share with it');
SELECT pg_temp.expect('I-1 dual member cannot DENY its own shop''s request either',
  pg_temp.as_user(:'DUAL', format('SELECT status FROM public.respond_to_service_history_request(%s, $$deny$$)', (SELECT v FROM fp WHERE k = 'req1'))),
  'ERR 42501 only an owner or admin who is not part of the requesting company can answer this request');
SELECT pg_temp.expect('I-1 dual member is not an owner recipient of its own shop''s request',
  (SELECT string_agg(r->>'email', ',' ORDER BY r->>'email') FROM jsonb_array_elements(public.service_history_request_notice((SELECT v FROM fp WHERE k = 'req1')::bigint)->'owner_recipients') r),
  'c1@clinic-c.test,c3@clinic-c.test');
SELECT pg_temp.expect('M-1 no grant, request still pending',
  (SELECT count(*)::text FROM public.service_history_grants) || ':' || (SELECT status FROM public.service_history_requests WHERE id = (SELECT v FROM fp WHERE k = 'req1')::bigint), '0:pending');
-- A clinic whose ONLY approver is a member of the shop is unclaimed for that shop.
SET LOCAL session_replication_role = replica;
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'DUAL', 12, 'owner', false);
SET LOCAL session_replication_role = origin;
SELECT pg_temp.expect('M-1 clinic U whose only approver is an L member: still clinic_unclaimed for L',
  pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(12, 4)'), 'ERR 42501 clinic_unclaimed');
SELECT pg_temp.expect('M-1 ... and L cannot request it',
  pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(12, 4)'), 'ERR 42501 clinic_unclaimed');
DELETE FROM public.organization_memberships WHERE user_id = :'DUAL';
DELETE FROM public.user_profiles WHERE id = :'DUAL';
DELETE FROM public.service_history_slots WHERE bucket LIKE 'teaser%';

-- T23 approve (equipment scope) -> exactly one grant, unlocks exactly the teased rows.
INSERT INTO fp SELECT 'teased', string_agg(report_id::text, ',' ORDER BY report_id) FROM public.service_history_teaser_rows(1, 10, 1);
SELECT pg_temp.expect('T23 C owner approves (default scope = this laser)', pg_temp.as_user(:'C_OWNER', format('SELECT status || $$:$$ || (grant_id IS NOT NULL)::text FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'OK approved:true');
SELECT pg_temp.expect('T23 exactly one grant: C -> L on E1 by c1',
  (SELECT count(*) || ' ' || string_agg(owner_org_id || '>' || grantee_shop_org_id || ':' || equipment_id || ':' || granted_by, ',') FROM public.service_history_grants), '1 10>1:1:00000000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect('T23 request row: approved, scope equipment, grant linked',
  (SELECT status || ' ' || approved_scope || ' ' || (grant_id = (SELECT id FROM public.service_history_grants))::text || ' ' || responded_by FROM public.service_history_requests), 'approved equipment true 00000000-0000-0000-0000-0000000000c1');
INSERT INTO fp SELECT 'shared', substr(pg_temp.as_user(:'L_ADMIN', 'SELECT string_agg(id::text, $$,$$ ORDER BY id) FROM public.get_shared_service_history(10, 1) WHERE service_organization_id <> 1'), 4);
SELECT pg_temp.expect('T23 every teased row is unlocked by the grant',
  (SELECT bool_and(t = ANY (string_to_array((SELECT v FROM fp WHERE k = 'shared'), ','))) FROM unnest(string_to_array((SELECT v FROM fp WHERE k = 'teased'), ',')) t)::text, 'true');
-- get_shared_service_history (000920/000921) also returns drafts; the teaser
-- lists only finished reports. The only extra unlocked row is the draft P-4.
SELECT pg_temp.expect('T23 unlocked minus teased = only the draft P-4',
  (SELECT string_agg(x, ',') FROM unnest(string_to_array((SELECT v FROM fp WHERE k = 'shared'), ',')) x
    WHERE NOT (x = ANY (string_to_array((SELECT v FROM fp WHERE k = 'teased'), ',')))), '10000000-0000-0000-0000-000000000004');
SELECT pg_temp.expect('T23 after approval: other shop names visible (decision)', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(DISTINCT service_company_name, ',') FROM public.get_shared_service_history(10, 1) WHERE service_organization_id <> 1$q$), 'OK Shop P');
SELECT pg_temp.expect('T23 teaser now empty (rows unlocked)', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 0');
SELECT pg_temp.expect('T23 RLS unchanged: L still reads only its own report rows directly', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(title, ',' ORDER BY title) FROM public.service_reports WHERE customer_organization_id = 10$q$), 'OK L-1');
SELECT pg_temp.expect('T22 approve again: no longer open', pg_temp.as_user(:'C_OWNER', format('SELECT status FROM public.respond_to_service_history_request(%s, $$approve$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 22023 request is no longer open');
SELECT pg_temp.expect('T22 deny after approve: no longer open', pg_temp.as_user(:'C_MGR', format('SELECT status FROM public.respond_to_service_history_request(%s, $$deny$$)', (SELECT v FROM fp WHERE k = 'req1'))), 'ERR 22023 request is no longer open');
SELECT pg_temp.expect('T22 still exactly one grant', (SELECT count(*)::text FROM public.service_history_grants), '1');
SELECT pg_temp.expect('request after approval: already shared, nothing created', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK approved:false');
SELECT pg_temp.expect('owner Shared-with list shows the grant with the real shop name', pg_temp.as_user(:'C_OWNER', 'SELECT shop_name || $$:$$ || equipment_id FROM public.list_owner_service_history_grants(10, 1)'), 'OK Shop L:1');
SELECT pg_temp.expect('Shared-with list: staff / shop refused', pg_temp.as_user(:'C_STAFF', 'SELECT count(*)::text FROM public.list_owner_service_history_grants(10)') || ' | ' || pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.list_owner_service_history_grants(10)'),
  'ERR 42501 only an owner or admin of this facility can list its shared history | ERR 42501 only an owner or admin of this facility can list its shared history');

-- T27 revoke -> locked again immediately, teaser back.
SELECT pg_temp.expect('T27 owner revokes', pg_temp.as_user(:'C_OWNER', 'SELECT public.revoke_service_history((SELECT id FROM public.list_owner_service_history_grants(10) LIMIT 1))::text'), 'OK true');
SELECT pg_temp.expect('T27 shared history locked again', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10, 1)'), 'OK 0');
SELECT pg_temp.expect('T27 teaser shows the rows again', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 4');

-- T26 deny -> stays locked; T15 cooldown.
SELECT pg_temp.expect('T26 new request after revoke', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');
SELECT pg_temp.expect('T26 manager denies', pg_temp.as_user(:'C_MGR', $q$SELECT status FROM public.respond_to_service_history_request((SELECT id FROM public.list_incoming_service_history_requests(10) LIMIT 1), 'deny')$q$), 'OK denied');
SELECT pg_temp.expect('T26 denied: no new grant', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '0');
SELECT pg_temp.expect('T26 denied: shared history still locked', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10, 1)'), 'OK 0');
SELECT pg_temp.expect('T26 denied: teaser still shows the rows', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 4');
SELECT pg_temp.expect('T15 re-request inside 30 days: cooldown', pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR P0001 request_cooldown');
SELECT pg_temp.expect('L-2 cooldown is per (clinic, shop): another laser of C is refused too',
  pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 2)'), 'ERR P0001 request_cooldown');
SELECT pg_temp.expect('L-2 another clinic is not affected (Z/D path unchanged; L has no D link)',
  pg_temp.as_user(:'Z_ADMIN', 'SELECT status FROM public.request_service_history_access(11, 3)'), 'ERR 22023 no locked history on this laser');
SELECT pg_temp.expect('T15 shop sees retry_after = denial + 30 days', pg_temp.as_user(:'L_ADMIN', $q$SELECT (retry_after - responded_at)::text FROM public.list_my_service_history_requests(1) WHERE status = 'denied'$q$), 'OK 30 days');
UPDATE public.service_history_requests SET responded_at = now() - interval '31 days', created_at = now() - interval '32 days', expires_at = now() - interval '18 days' WHERE status = 'denied';
SELECT pg_temp.expect('T15 after 30 days: request allowed again', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');

-- Expiry (14 days, lazy).
UPDATE public.service_history_requests SET created_at = now() - interval '15 days', expires_at = now() - interval '1 day' WHERE status = 'pending';
SELECT pg_temp.expect('T15 expired pending shows as expired to the shop', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(status, ',' ORDER BY id) FROM public.list_my_service_history_requests(1)$q$), 'OK approved,denied,expired');
SELECT pg_temp.expect('T15 expired request is not in the owner''s pending inbox', pg_temp.as_user(:'C_OWNER', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'OK 0');
SELECT pg_temp.expect('T22 responding to an expired request closes it, no grant', pg_temp.as_user(:'C_OWNER', format($q$SELECT status || ':' || coalesce(grant_id::text, 'none') FROM public.respond_to_service_history_request(%s, 'approve')$q$, (SELECT max(id) FROM public.service_history_requests))), 'OK expired:none');
SELECT pg_temp.expect('T15 after expiry: a fresh request (index not blocked)', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');

-- T25 laser moved to another owner before approval.
UPDATE public.equipment SET customer_organization_id = 12 WHERE id = 1;
SELECT pg_temp.expect('T25 moved laser: inbox marks it expired (equipment_moved)', pg_temp.as_user(:'C_OWNER', $q$SELECT status || ':' || close_reason FROM public.list_incoming_service_history_requests(10, 'all') ORDER BY created_at DESC LIMIT 1$q$), 'OK expired:equipment_moved');
SELECT pg_temp.expect('T25 approving it: expired, no grant', pg_temp.as_user(:'C_OWNER', format($q$SELECT status || ':' || close_reason FROM public.respond_to_service_history_request(%s, 'approve')$q$, (SELECT max(id) FROM public.service_history_requests))), 'OK expired:equipment_moved');
SELECT pg_temp.expect('T25 no grant', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '0');
SELECT pg_temp.expect('T25 moved laser: L gets no teaser for it under C', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not available for this laser');
UPDATE public.equipment SET customer_organization_id = 10 WHERE id = 1;

-- T24 scope "all": one NULL-equipment grant; other pending requests covered.
INSERT INTO public.service_reports (organization_id, created_by, customer_organization_id, equipment_id, serial_number, title, report_number, status, service_type, date_out)
  VALUES (2, '00000000-0000-0000-0000-0000000000a1', 10, 2, 'SN-2', 'P-6', 'ACME-SR-6', 'complete', 'Repair', '2026-02-20');
-- The earlier steps used up L's 5/day budget for C (T13 tests the cap itself).
DELETE FROM public.service_history_slots;
SELECT pg_temp.expect('T24 fresh request for E1', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');
SELECT pg_temp.expect('T24 request for E2 too', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 2)'), 'OK pending:true');
SELECT pg_temp.expect('T24 two pending', pg_temp.as_user(:'C_OWNER', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'OK 2');
SELECT pg_temp.expect('T24 approve E2 with scope all', pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve', 'all')$q$, (SELECT id FROM public.service_history_requests WHERE status = 'pending' AND equipment_id = 2))), 'OK approved');
SELECT pg_temp.expect('T24 one active grant, all equipment', (SELECT count(*) || ':' || coalesce(max(equipment_id)::text, 'all') FROM public.service_history_grants WHERE revoked_at IS NULL), '1:all');
SELECT pg_temp.expect('T24 the E1 request closed as covered by the same grant',
  (SELECT string_agg(status || ':' || coalesce(close_reason, '-') || ':' || (grant_id = (SELECT id FROM public.service_history_grants WHERE revoked_at IS NULL))::text, ',' ORDER BY equipment_id) FROM public.service_history_requests WHERE status = 'approved' AND approved_scope = 'all'),
  'approved:covered:true,approved:-:true');
SELECT pg_temp.expect('T24 no pending left', pg_temp.as_user(:'C_OWNER', 'SELECT count(*)::text FROM public.list_incoming_service_history_requests(10)'), 'OK 0');
SELECT pg_temp.expect('T24 L reads both lasers'' history (P-1..P-6 incl. the draft)', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10) WHERE service_organization_id <> 1'), 'OK 6');
UPDATE public.service_history_grants SET revoked_at = now(), revoked_by = :'C_OWNER' WHERE revoked_at IS NULL;

-- T05 blocked pair.
SELECT pg_temp.expect('T05 pending request before block', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');
SELECT pg_temp.expect('T05 owner removes and blocks L', pg_temp.as_user(:'C_OWNER', 'SELECT public.remove_linked_service_shop(10, 1, true, false)::text'), 'OK true');
SELECT pg_temp.expect('T05 blocked: teaser refused', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T05 blocked: request refused', pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR 42501 not available for this laser');
SELECT pg_temp.expect('T05 blocked: pending request shows closed (blocked)', pg_temp.as_user(:'C_OWNER', $q$SELECT status || ':' || close_reason FROM public.list_incoming_service_history_requests(10, 'all') ORDER BY created_at DESC, id DESC LIMIT 1$q$), 'OK expired:blocked');
SELECT pg_temp.expect('L-1 owner approves the blocked shop''s pending request by direct RPC: closed as blocked, no grant',
  pg_temp.as_user(:'C_OWNER', format($q$SELECT status || ':' || coalesce(grant_id::text, 'none') || ':' || close_reason FROM public.respond_to_service_history_request(%s, 'approve', 'all')$q$, (SELECT max(id) FROM public.service_history_requests))), 'OK expired:none:blocked');
SELECT pg_temp.expect('I-2 direct grant_service_history to a blocked shop is refused',
  pg_temp.as_user(:'C_OWNER', 'SELECT public.grant_service_history(10, 1, 1)::text') || ' | ' || pg_temp.as_user(:'C_OWNER', 'SELECT public.grant_service_history(10, 1, NULL)::text'),
  'ERR 42501 this facility has blocked that service company | ERR 42501 this facility has blocked that service company');
SELECT pg_temp.expect('L-1 no active grant after approving a blocked shop', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '0');
SELECT pg_temp.expect('L-1 the row is closed, approving again is refused',
  (SELECT status || ':' || close_reason FROM public.service_history_requests WHERE id = (SELECT max(id) FROM public.service_history_requests)) || ' | ' ||
  pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, (SELECT max(id) FROM public.service_history_requests))), 'expired:blocked | ERR 22023 request is no longer open');
-- Restore the link for the rate-limit tests.
DELETE FROM public.organization_customer_link_blocks;
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (1, 10);
UPDATE public.service_history_requests SET status = 'expired', close_reason = 'blocked' WHERE status = 'pending';
-- L-1 link removed without a block (direct delete): approve closes it as link_removed.
SELECT pg_temp.expect('L-1 pending request before the link is removed', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');
DELETE FROM public.organization_customers WHERE service_organization_id = 1 AND customer_organization_id = 10;
SELECT pg_temp.expect('L-1 inbox shows it closed (link_removed)', pg_temp.as_user(:'C_OWNER', $q$SELECT status || ':' || close_reason FROM public.list_incoming_service_history_requests(10, 'all') ORDER BY created_at DESC, id DESC LIMIT 1$q$), 'OK expired:link_removed');
SELECT pg_temp.expect('L-1 approving an unlinked shop: closed as link_removed, no grant',
  pg_temp.as_user(:'C_OWNER', format($q$SELECT status || ':' || coalesce(grant_id::text, 'none') || ':' || close_reason FROM public.respond_to_service_history_request(%s, 'approve')$q$, (SELECT max(id) FROM public.service_history_requests))), 'OK expired:none:link_removed');
SELECT pg_temp.expect('L-1 still no active grant', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '0');
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (1, 10);

-- L-A leave -> approve -> re-join: gaining a membership in the grantee shop
-- revokes the grants that user gave it (trigger, every writer).
DELETE FROM public.service_history_slots;
INSERT INTO fp SELECT 'grant0', coalesce(max(id), 0)::text FROM public.service_history_grants;
SELECT pg_temp.expect('L-A request from L for E1', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1)'), 'OK pending:true');
SELECT pg_temp.expect('L-A manager (not in L) approves scope all', pg_temp.as_user(:'C_MGR', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve', 'all')$q$, (SELECT max(id) FROM public.service_history_requests))), 'OK approved');
SELECT pg_temp.expect('L-A owner (not in L) also shares E2 explicitly', pg_temp.as_user(:'C_OWNER', 'SELECT (public.grant_service_history(10, 1, 2) IS NOT NULL)::text'), 'OK true');
SELECT pg_temp.expect('L-A L reads the shared history', pg_temp.as_user(:'L_ADMIN', 'SELECT (count(*) > 0)::text FROM public.get_shared_service_history(10) WHERE service_organization_id <> 1'), 'OK true');
-- the manager joins shop Z first (not the grantee): nothing changes
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES (:'C_MGR', 3, 'fse');
SELECT pg_temp.expect('L-A joining an unrelated shop revokes nothing', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '2');
-- then moves that membership to L (UPDATE path) = re-join
UPDATE public.organization_memberships SET organization_id = 1 WHERE user_id = :'C_MGR' AND organization_id = 3;
SELECT pg_temp.expect('L-A re-join (UPDATE into L): the manager''s all-lasers grant is revoked, by the manager',
  (SELECT string_agg(coalesce(equipment_id::text, 'all') || ':' || (revoked_at IS NOT NULL)::text || ':' || coalesce(revoked_by::text, '-'), ',' ORDER BY equipment_id NULLS FIRST) FROM public.service_history_grants WHERE id > (SELECT v FROM fp WHERE k = 'grant0')::bigint),
  'all:true:00000000-0000-0000-0000-0000000000c3,2:false:-');
SELECT pg_temp.expect('L-A the owner''s own E2 grant survives (different granter)', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10, 2) WHERE service_organization_id <> 1') || ' | ' || pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10, 1)'), 'OK 1 | OK 0');
DELETE FROM public.organization_memberships WHERE user_id = :'C_MGR' AND organization_id = 1;
-- INSERT path: owner leaves? (owner was never in L) -> owner joins L directly
INSERT INTO public.organization_memberships (user_id, organization_id, role) VALUES (:'C_OWNER', 1, NULL);
SELECT pg_temp.expect('L-A owner joins L (INSERT, NULL role): its E2 grant is revoked too', (SELECT count(*)::text FROM public.service_history_grants WHERE revoked_at IS NULL), '0');
SELECT pg_temp.expect('L-A L reads nothing shared any more', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_shared_service_history(10)'), 'OK 0');
DELETE FROM public.organization_memberships WHERE user_id = :'C_OWNER' AND organization_id = 1;
SELECT pg_temp.expect('L-A trigger function not executable by clients',
  (has_function_privilege('authenticated', 'public.revoke_conflicted_history_grants()', 'EXECUTE') OR has_function_privilege('anon', 'public.revoke_conflicted_history_grants()', 'EXECUTE'))::text, 'false');

-- T11 teaser rate limits.
DELETE FROM public.service_history_slots;
SELECT pg_temp.expect('T11 20 teaser calls on one laser in an hour pass',
  (SELECT string_agg(DISTINCT left(pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 4), ',') FROM generate_series(1, 20)), 'OK 4');
SELECT pg_temp.expect('T11 the 21st is rate_limited', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'ERR P0001 rate_limited');
SELECT pg_temp.expect('T11 a refused call takes no slot', (SELECT count(*)::text FROM public.service_history_slots WHERE bucket = 'teaser_equipment'), '20');
SELECT pg_temp.expect('T11 another laser still works (per-laser cap)', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 2)'), 'OK 1');
INSERT INTO public.service_history_slots (bucket, scope_key, taken_at)
  SELECT 'teaser_user', :'L_TECH2', clock_timestamp() FROM generate_series(1, 60);
SELECT pg_temp.expect('T11 per-user cap (60/h)', pg_temp.as_user(:'L_TECH2', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 2)'), 'ERR P0001 rate_limited');
INSERT INTO public.service_history_slots (bucket, scope_key, taken_at)
  SELECT 'teaser_shop', '1', clock_timestamp() FROM generate_series(1, 120);
SELECT pg_temp.expect('T11 per-shop cap (120/h)', pg_temp.as_user(:'L_TECH', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 2)'), 'ERR P0001 rate_limited');
UPDATE public.service_history_slots SET taken_at = now() - interval '61 minutes';
SELECT pg_temp.expect('T11 sliding window: an hour later it works', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 4');
UPDATE public.service_history_slots SET taken_at = now() - interval '25 hours';
SELECT pg_temp.expect('T11 take after 24h', public.take_service_history_slot('teaser_user', 'x', 1, interval '1 hour')::text, 'true');
SELECT pg_temp.expect('T11 slots older than 24h were deleted by that take', (SELECT count(*)::text FROM public.service_history_slots), '1');

-- T13 request rate limits (5/day per clinic, 20/day per shop).
DELETE FROM public.service_history_slots;
INSERT INTO public.service_history_slots (bucket, scope_key, taken_at)
  SELECT 'request_pair', '1:10', clock_timestamp() FROM generate_series(1, 5);
SELECT pg_temp.expect('T13 6th request to one clinic in 24h refused', pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR P0001 rate_limited');
SELECT pg_temp.expect('T13 refused request left no row', (SELECT count(*)::text FROM public.service_history_requests WHERE status = 'pending'), '0');
DELETE FROM public.service_history_slots;
INSERT INTO public.service_history_slots (bucket, scope_key, taken_at)
  SELECT 'request_shop', '1', clock_timestamp() FROM generate_series(1, 20);
SELECT pg_temp.expect('T13 21st request from one shop in 24h refused', pg_temp.as_user(:'L_ADMIN', 'SELECT status FROM public.request_service_history_access(10, 1)'), 'ERR P0001 rate_limited');
DELETE FROM public.service_history_slots;
SELECT pg_temp.expect('T13 under the caps it works (with a forged ref and a raw report uuid)', pg_temp.as_user(:'L_ADMIN', 'SELECT status || $$:$$ || created::text FROM public.request_service_history_access(10, 1, $$10000000-0000-0000-0000-000000000001$$)'), 'OK pending:true');
SELECT pg_temp.expect('T13 forged ref / raw uuid resolve to no report', (SELECT (requested_report_id IS NULL)::text FROM public.service_history_requests WHERE status = 'pending'), 'true');

-- T16 email cap per clinic (taken by the route as service_role).
SELECT pg_temp.expect('T16 10 request emails per clinic per day, the 11th refused',
  (SELECT string_agg(ok::text, ',') FROM (SELECT public.take_service_history_slot('request_email_owner', '10', 10, interval '24 hours') AS ok FROM generate_series(1, 11)) s),
  'true,true,true,true,true,true,true,true,true,true,false');
SELECT pg_temp.expect('T16 bad slot args are refused (no unbounded window)', public.take_service_history_slot('request_email_owner', '10', 10, interval '2 days')::text, 'false');
SELECT pg_temp.expect('T16 unknown bucket refused by CHECK', pg_temp.as_role('postgres', $q$SELECT public.take_service_history_slot('nope', 'x', 1, interval '1 hour')::text$q$), 'ERR 23514');

-- T28 rollback: everything back to exactly the 919/920/921 state.
\ir ../migrations/20261017_000922_service_history_access_requests_rollback.sql
SELECT pg_temp.expect('T28 ROLLBACK fingerprint (public functions+ACLs, policies, tables, private tables) equals pre-000922', pg_temp.fingerprint(), (SELECT v FROM fp WHERE k = 'pre922'));
SELECT pg_temp.expect('T28 ROLLBACK every 919/920/921 function body identical',
  (SELECT bool_and(v = md5(pg_get_functiondef(substr(k, 5)::regprocedure)))::text FROM fp WHERE k LIKE 'md5:%'), 'true');
SELECT pg_temp.expect('T28 ROLLBACK grant_service_history restored to the live prod body (md5)',
  md5(pg_get_functiondef('public.grant_service_history(bigint,bigint,bigint)'::regprocedure)), 'c4b6de797b5e6ee4efcb918aa5137d69');
SELECT pg_temp.expect('T28 ROLLBACK teaser RPC gone', (to_regprocedure('public.get_locked_service_history_teaser(bigint,bigint)') IS NULL)::text, 'true');
SELECT pg_temp.expect('T28 ROLLBACK key table gone', (to_regclass('private.service_history_ref_keys') IS NULL)::text, 'true');
SELECT pg_temp.expect('T28 ROLLBACK history behaviour unchanged (L reads only its own C report)', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(title, ',' ORDER BY title) FROM public.service_reports WHERE customer_organization_id = 10$q$), 'OK L-1');
\ir ../migrations/20261017_000922_service_history_access_requests.sql
SELECT pg_temp.expect('T28 re-apply after rollback works', pg_temp.as_user(:'L_ADMIN', 'SELECT count(*)::text FROM public.get_locked_service_history_teaser(10, 1)'), 'OK 4');

ROLLBACK;
