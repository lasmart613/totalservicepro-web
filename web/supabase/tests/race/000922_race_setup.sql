-- Fixture DB for 000922_race.sh (two-session races). Local PG17 only, fixture
-- data only, COMMITTED (the races need real concurrent sessions). Same base
-- as the 000922 proof: 000919 -> 000920 -> 000921 -> 000923 (fixture copy)
-- -> 000922. Paths are relative to this file.

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
ALTER TABLE public.service_tickets ADD COLUMN assigned_to uuid, ADD COLUMN status text, ADD COLUMN service_date date, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.user_profiles ADD COLUMN email text, ADD COLUMN first_name text, ADD COLUMN last_name text,
  ADD COLUMN notification_prefs jsonb, ADD COLUMN is_active boolean DEFAULT true;
ALTER TABLE public.equipment ADD COLUMN manufacturer text;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

-- Prod order: 000919 -> 000920 -> 000921.
\ir ../../migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql
\ir ../../migrations/20261017_000920_service_history_owner_consent.sql

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
INSERT INTO public.service_tickets (organization_id, customer_organization_id, assigned_to) VALUES
  (1, 10, '00000000-0000-0000-0000-0000000000b2');
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

\ir ../../migrations/20261017_000921_linked_shop_own_reports.sql
SELECT pg_temp.expect('BASE 000919 applied (creator_shop_org_id column)', (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'public.organizations'::regclass AND attname = 'creator_shop_org_id' AND NOT attisdropped), '1');
SELECT pg_temp.expect('BASE 000921 applied (link blocks)', (to_regclass('public.organization_customer_link_blocks') IS NOT NULL)::text, 'true');
SELECT pg_temp.expect('BASE linked shop L reads only its own C report', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(title, ',' ORDER BY title) FROM public.service_reports WHERE customer_organization_id = 10$q$), 'OK L-1');

INSERT INTO fp VALUES ('pre922', pg_temp.fingerprint()), ('policies', pg_temp.policies());
INSERT INTO fp SELECT 'md5:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f';

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS directory_contacts jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS role text;
CREATE TABLE IF NOT EXISTS public.contacts (id bigserial PRIMARY KEY, organization_id bigint, first_name text, last_name text, title text, phone text, email text, is_primary boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
\ir ../fixtures/000923_clinic_claim_invite_binding_at_168d4f6a.sql
\ir ../../migrations/20261017_000922_service_history_access_requests.sql
COMMIT;
