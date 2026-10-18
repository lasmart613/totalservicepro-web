-- Local proof for 20261018_000925_service_history_n2_followups.sql and its
-- rollback. Empty Postgres 17 only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
-- Works from any directory (\ir paths are relative to this file).
--
--   createdb n2_proof
--   psql "postgresql:///n2_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261018_service_history_n2_followups.sql
--
-- Base = prod order as live on 2026-10-18: 000919 -> 000920 -> 000921 ->
-- 000923 -> 000924 -> 000922 (the merged migration files), on the 000922
-- proof's fixture (live helper bodies). BASE checks assert that the three
-- bodies 000925 replaces have the prod md5s read on 2026-10-18.
-- BEFORE checks show the live behaviour (N-2 hole, 'approved' after revoke,
-- no cooldown after revoke); AFTER checks run on 000925 (incl. owner vs system
-- revokes: only an owner revoke or deny starts the cooldown); then the
-- rollback must restore the pre-000925 fingerprint and table shape exactly.
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

\ir ../migrations/20261017_000921_linked_shop_own_reports.sql
SELECT pg_temp.expect('BASE 000919 applied (creator_shop_org_id column)', (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'public.organizations'::regclass AND attname = 'creator_shop_org_id' AND NOT attisdropped), '1');
SELECT pg_temp.expect('BASE 000921 applied (link blocks)', (to_regclass('public.organization_customer_link_blocks') IS NOT NULL)::text, 'true');
SELECT pg_temp.expect('BASE linked shop L reads only its own C report', pg_temp.as_user(:'L_ADMIN', $q$SELECT string_agg(title, ',' ORDER BY title) FROM public.service_reports WHERE customer_organization_id = 10$q$), 'OK L-1');

INSERT INTO fp VALUES ('pre922', pg_temp.fingerprint()), ('policies', pg_temp.policies());
INSERT INTO fp SELECT 'md5:' || p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f';

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS email text, ADD COLUMN IF NOT EXISTS directory_contacts jsonb;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS role text;
CREATE TABLE IF NOT EXISTS public.contacts (id bigserial PRIMARY KEY, organization_id bigint, first_name text, last_name text, title text, phone text, email text, is_primary boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean;
CREATE OR REPLACE FUNCTION public.set_home_membership(p_user_id uuid, p_organization_id bigint, p_role text DEFAULT NULL::text, p_sync_profile boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  n integer;
  next_role text;
  homes integer;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'set_home_membership requires a user and an organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'set_home_membership organization % not found', p_organization_id;
  END IF;

  next_role := CASE
    WHEN p_role IS NULL OR btrim(p_role) = '' THEN NULL
    ELSE public.profile_role_from_membership(p_role)
  END;

  -- Clear first. A later failure raises and rolls this back with the insert.
  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE user_id = p_user_id
    AND organization_id IS DISTINCT FROM p_organization_id
    AND is_home IS TRUE;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (
    p_user_id,
    p_organization_id,
    COALESCE(next_role, 'fse'),
    true
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_home = true,
        updated_at = now(),
        role = COALESCE(next_role, public.organization_memberships.role);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'set_home_membership expected 1 membership row, changed %', n;
  END IF;

  IF p_sync_profile THEN
    UPDATE public.user_profiles
    SET
      organization_id = p_organization_id,
      active_organization_id = p_organization_id,
      role = public.profile_role_from_membership(COALESCE(next_role, role)),
      updated_at = now()
    WHERE id = p_user_id;
  END IF;

  SELECT count(*) INTO homes
  FROM public.organization_memberships
  WHERE user_id = p_user_id
    AND is_home IS TRUE;
  IF homes <> 1 THEN
    RAISE EXCEPTION 'set_home_membership left % home rows', homes;
  END IF;
END;
$function$;

\ir ../migrations/20261017_000923_clinic_claim_invite_binding.sql
\ir ../migrations/20261017_000924_clinic_claim_hardening.sql
\ir ../migrations/20261017_000922_service_history_access_requests.sql

-- ===========================================================================
-- 000925 proof.

-- Login rows (000923/000924 read auth.users emails).
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT p.id, p.email, now() FROM public.user_profiles p;

CREATE FUNCTION pg_temp.as_user_d(u text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; d text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE stmt INTO t;
    t := 'OK ' || COALESCE(t, '(null)');
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
    t := 'ERR ' || SQLSTATE || ' ' || SQLERRM || ' | ' || COALESCE(d, '');
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.reset_history() RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.service_history_requests;
  DELETE FROM public.service_history_grants;
  DELETE FROM public.service_history_slots;
$$;
CREATE FUNCTION pg_temp.fn_md5(sig text) RETURNS text LANGUAGE sql AS $$
  SELECT md5(pg_get_functiondef(sig::regprocedure))
$$;
CREATE FUNCTION pg_temp.my_status(u text, eq bigint) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.as_user(u, format($q$SELECT status || ':' || (retry_after IS NOT NULL)::text FROM public.list_my_service_history_requests(%s) LIMIT 1$q$, eq))
$$;
-- Non-function state: policies, relation ACLs, triggers.
CREATE FUNCTION pg_temp.fp_nonfn() RETURNS text LANGUAGE sql AS $$
  SELECT md5(pg_temp.policies() || '#' ||
    COALESCE((SELECT string_agg(c.relname || ':' || c.relkind::text || ':' || COALESCE(array_to_string(c.relacl, ','), ''), ',' ORDER BY c.relname)
       FROM pg_class c WHERE c.relnamespace IN ('public'::regnamespace, 'private'::regnamespace)), '') || '#' ||
    COALESCE((SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgfoid::regprocedure::text, ',' ORDER BY 1) FROM pg_trigger WHERE NOT tgisinternal), ''))
$$;

-- Table shape of service_history_grants (live columns + constraints).
CREATE FUNCTION pg_temp.grants_shape() RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE((SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull::text, ',' ORDER BY attnum)
     FROM pg_attribute WHERE attrelid = 'public.service_history_grants'::regclass AND attnum > 0 AND NOT attisdropped), '')
  || '#' || COALESCE((SELECT string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname)
     FROM pg_constraint WHERE conrelid = 'public.service_history_grants'::regclass), '')
$$;

\set C_STAFF2 '00000000-0000-0000-0000-0000000000c5'
\set C_TWIN   '00000000-0000-0000-0000-0000000000c6'

SELECT pg_temp.expect('BASE live md5 grant_service_history', pg_temp.fn_md5('public.grant_service_history(bigint,bigint,bigint)'), '3bae6eee0d7d0360b795283d70839267');
SELECT pg_temp.expect('BASE live md5 request_service_history_access', pg_temp.fn_md5('public.request_service_history_access(bigint,bigint,text)'), 'eb16d6ff8db01045369b330bc1fe3082');
SELECT pg_temp.expect('BASE live md5 list_my_service_history_requests', pg_temp.fn_md5('public.list_my_service_history_requests(bigint)'), '849e65fd7513578572f1307778f267f1');
SELECT pg_temp.expect('BASE live md5 clinic_shop_staff_now_or_recent (000924)', pg_temp.fn_md5('public.clinic_shop_staff_now_or_recent(bigint,uuid)'), 'a094781babe3113ebe32395fce0f6533');
SELECT pg_temp.expect('BASE live md5 revoke_service_history', pg_temp.fn_md5('public.revoke_service_history(bigint)'), '031991b951143598428bc7466a7bd8fc');
SELECT pg_temp.expect('BASE live md5 remove_linked_service_shop (not replaced)', pg_temp.fn_md5('public.remove_linked_service_shop(bigint,bigint,boolean,boolean)'), 'e4325f3818de5697a4b1b516afc98084');
SELECT pg_temp.expect('BASE live md5 revoke_conflicted_history_grants (not replaced)', pg_temp.fn_md5('public.revoke_conflicted_history_grants()'), '3f5fac646b4bb9ab26ccfbe941c65a4d');
SELECT pg_temp.expect('BASE grants have no revoked_reason yet', (SELECT count(*)::text FROM pg_attribute WHERE attrelid = 'public.service_history_grants'::regclass AND attname = 'revoked_reason' AND NOT attisdropped), '0');
SELECT pg_temp.expect('BASE helper absent', (to_regprocedure('public.history_grantor_recent_shop_staff(bigint,uuid)') IS NULL)::text, 'true');

-- Clinic C manager c3 works at Shop L, then leaves it (departure logged by 000923/924).
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'C_MGR', 1, 'fse', false);
DELETE FROM public.organization_memberships WHERE user_id = :'C_MGR' AND organization_id = 1;
SELECT pg_temp.expect('BASE departure logged with email', (SELECT string_agg(organization_id::text || ':' || email, ',') FROM public.organization_membership_departures WHERE user_id = :'C_MGR'), '1:c3@clinic-c.test');

INSERT INTO fp VALUES ('pre925', pg_temp.fingerprint()), ('nonfn', pg_temp.fp_nonfn()), ('shape', pg_temp.grants_shape());

-- ---------------------------------------------------------------- BEFORE (live)
SELECT pg_temp.expect_like('BEFORE N-2 just-departed manager can grant to her old shop (the hole)', pg_temp.as_user(:'C_MGR', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'OK %');
SELECT pg_temp.reset_history();
SELECT pg_temp.expect('BEFORE request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect('BEFORE N-2 just-departed manager can approve (the hole)', pg_temp.as_user(:'C_MGR', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
SELECT pg_temp.expect('BEFORE panel approved', pg_temp.my_status(:'L_ADMIN', 1), 'OK approved:false');
SELECT pg_temp.expect('BEFORE revoke', pg_temp.as_user(:'C_OWNER', $q$SELECT public.revoke_service_history((SELECT max(id) FROM public.service_history_grants))::text$q$), 'OK true');
SELECT pg_temp.expect('BEFORE panel still approved after revoke (the bug)', pg_temp.my_status(:'L_ADMIN', 1), 'OK approved:false');
SELECT pg_temp.expect('BEFORE re-request after revoke: no cooldown', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT pg_temp.reset_history();

-- ---------------------------------------------------------------- APPLY 000925
\ir ../migrations/20261018_000925_service_history_n2_followups.sql
SELECT pg_temp.expect('APPLY md5 grant_service_history', pg_temp.fn_md5('public.grant_service_history(bigint,bigint,bigint)'), '5dd66dd337620e9abbcd1bcc2da7896c');
SELECT pg_temp.expect('APPLY md5 request_service_history_access', pg_temp.fn_md5('public.request_service_history_access(bigint,bigint,text)'), '6b6b3239a922033385159ac94e4b11c8');
SELECT pg_temp.expect('APPLY md5 list_my_service_history_requests', pg_temp.fn_md5('public.list_my_service_history_requests(bigint)'), 'b120c31ad8e3bd21c10ed32f4f426afc');
SELECT pg_temp.expect('APPLY md5 revoke_service_history', pg_temp.fn_md5('public.revoke_service_history(bigint)'), 'ce11e179a58cb1355eafc0c4a9161860');
SELECT pg_temp.expect('APPLY system revoke paths untouched', pg_temp.fn_md5('public.remove_linked_service_shop(bigint,bigint,boolean,boolean)') || ' ' || pg_temp.fn_md5('public.revoke_conflicted_history_grants()'), 'e4325f3818de5697a4b1b516afc98084 3f5fac646b4bb9ab26ccfbe941c65a4d');
SELECT pg_temp.expect('APPLY grants shape = live + revoked_reason text + its CHECK', pg_temp.grants_shape(),
  replace((SELECT v FROM fp WHERE k = 'shape'), 'revoked_by:uuid:false#', 'revoked_by:uuid:false,revoked_reason:text:false#')
    || ',service_history_grants_revoked_reason_check:CHECK (((revoked_reason IS NULL) OR ((revoked_reason = ''owner''::text) AND (revoked_at IS NOT NULL))))');
SELECT pg_temp.expect_like('APPLY CHECK rejects other reasons', pg_temp.as_role('service_role', $q$INSERT INTO public.service_history_grants (owner_org_id, grantee_shop_org_id, granted_by, revoked_at, revoked_reason) VALUES (10, 1, gen_random_uuid(), now(), 'system') RETURNING id::text$q$), 'ERR 23514');
INSERT INTO fp VALUES ('post925', pg_temp.fingerprint());
\ir ../migrations/20261018_000925_service_history_n2_followups.sql
SELECT pg_temp.expect('APPLY idempotent (re-run leaves the same fingerprint)', pg_temp.fingerprint(), (SELECT v FROM fp WHERE k = 'post925'));
SELECT pg_temp.expect('APPLY policies unchanged', pg_temp.policies(), (SELECT v FROM fp WHERE k = 'policies'));

-- ---------------------------------------------------------------- AFTER: N-2
SELECT pg_temp.expect_like('AFTER N-2 just-departed manager: grant refused', pg_temp.as_user(:'C_MGR', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'ERR 42501 only an owner or admin who has not been part of that service company in the last 30 days%');
SELECT pg_temp.expect_like('AFTER N-2 just-departed manager: all-lasers grant refused', pg_temp.as_user(:'C_MGR', $q$SELECT public.grant_service_history(10, 1, NULL)::text$q$), 'ERR 42501 %last 30 days%');
SELECT pg_temp.expect('AFTER N-2 grant refused wrote no grant', (SELECT count(*)::text FROM public.service_history_grants), '0');
SELECT pg_temp.expect('AFTER request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect_like('AFTER N-2 just-departed manager: approve refused (via grant_service_history)', pg_temp.as_user(:'C_MGR', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve', 'all')$q$, :rq)), 'ERR 42501 %last 30 days%');
SELECT pg_temp.expect('AFTER N-2 refused approve leaves request pending, no grant', (SELECT status || ':' || (SELECT count(*) FROM public.service_history_grants)::text FROM public.service_history_requests WHERE id = :rq), 'pending:0');
SELECT pg_temp.expect('AFTER N-2 helper agrees with 000924 clinic rule for c3', (public.history_grantor_recent_shop_staff(1, :'C_MGR') AND public.clinic_shop_staff_now_or_recent(10, :'C_MGR'))::text, 'true');
SELECT pg_temp.expect('AFTER N-2 departure from another shop does not count', public.history_grantor_recent_shop_staff(3, :'C_MGR')::text, 'false');

-- Same email, new account (c5 = ' C3@Clinic-C.test ' login), a Clinic C admin.
INSERT INTO auth.users (id, email) VALUES (:'C_STAFF2', ' C3@Clinic-C.test ');
INSERT INTO public.user_profiles (id, organization_id, active_organization_id, email) VALUES (:'C_STAFF2', 10, 10, 'c5@clinic-c.test');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'C_STAFF2', 10, 'admin', true);
SELECT pg_temp.expect_like('AFTER N-2 new account with the departed login email: refused', pg_temp.as_user(:'C_STAFF2', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'ERR 42501 %last 30 days%');
-- Same login email as a CURRENT Shop L member (b1), different account.
INSERT INTO auth.users (id, email) VALUES (:'C_TWIN', 'B1@shop-l.test');
INSERT INTO public.user_profiles (id, organization_id, active_organization_id, email) VALUES (:'C_TWIN', 10, 10, 'twin@clinic-c.test');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'C_TWIN', 10, 'admin', true);
SELECT pg_temp.expect_like('AFTER N-2 login email of a current shop member: refused', pg_temp.as_user(:'C_TWIN', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'ERR 42501 %last 30 days%');
DELETE FROM public.organization_memberships WHERE user_id IN (:'C_STAFF2', :'C_TWIN');

-- M-1 unchanged: a CURRENT member of the shop gets the 000922 message.
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'L_TECH2', 10, 'admin', false);
SELECT pg_temp.expect_like('AFTER M-1 current shop member still refused (000922 message)', pg_temp.as_user(:'L_TECH2', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'ERR 42501 only an owner or admin who is not part of that service company can share with it%');
SELECT pg_temp.expect_like('AFTER I-1 current shop member still cannot deny', pg_temp.as_user(:'L_TECH2', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'deny')$q$, :rq)), 'ERR 42501 %requesting company%');
DELETE FROM public.organization_memberships WHERE user_id = :'L_TECH2' AND organization_id = 10;

-- 29 days after leaving: still refused. 31 days: allowed.
UPDATE public.organization_membership_departures SET left_at = now() - interval '29 days' WHERE user_id = :'C_MGR';
SELECT pg_temp.expect_like('AFTER N-2 29 days after leaving: refused', pg_temp.as_user(:'C_MGR', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'ERR 42501 %last 30 days%');
UPDATE public.organization_membership_departures SET left_at = now() - interval '31 days' WHERE user_id = :'C_MGR';
SELECT pg_temp.expect('AFTER N-2 31 days after leaving: helper false', public.history_grantor_recent_shop_staff(1, :'C_MGR')::text, 'false');
SELECT pg_temp.expect('AFTER N-2 31 days after leaving: approve allowed', pg_temp.as_user(:'C_MGR', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
SELECT pg_temp.expect('AFTER N-2 31 days: one active grant by c3', (SELECT count(*)::text FROM public.service_history_grants WHERE granted_by = :'C_MGR' AND revoked_at IS NULL), '1');
SELECT pg_temp.reset_history();
UPDATE public.organization_membership_departures SET left_at = now() WHERE user_id = :'C_MGR';

-- Legit approve (c1 never on a shop's staff) still works.
SELECT pg_temp.expect('AFTER legit request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect('AFTER legit approve by owner', pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
SELECT pg_temp.expect('AFTER legit approve: shop can read shared history', pg_temp.as_user(:'L_ADMIN', $q$SELECT (count(*) > 0)::text FROM public.get_shared_service_history(10, 1)$q$), 'OK true');

-- ---------------------------------------------------------------- AFTER: panel status
SELECT pg_temp.expect('AFTER panel: approved while the grant is active', pg_temp.my_status(:'L_ADMIN', 1), 'OK approved:false');
SELECT pg_temp.expect('AFTER revoke', pg_temp.as_user(:'C_OWNER', $q$SELECT public.revoke_service_history((SELECT max(id) FROM public.service_history_grants))::text$q$), 'OK true');
SELECT pg_temp.expect('AFTER owner revoke is marked revoked_reason=owner', (SELECT string_agg(coalesce(revoked_reason, 'NULL'), ',') FROM public.service_history_grants), 'owner');
SELECT pg_temp.expect('AFTER panel: revoked (locked) after an owner revoke, with retry_after', pg_temp.my_status(:'L_ADMIN', 1), 'OK revoked:true');
SELECT (max(revoked_at) + interval '720 hours')::text AS want_retry FROM public.service_history_grants \gset
SELECT pg_temp.expect('AFTER panel: retry_after = revoked_at + 30 days', pg_temp.as_user(:'L_ADMIN', $q$SELECT retry_after::text FROM public.list_my_service_history_requests(1) LIMIT 1$q$), 'OK ' || :'want_retry');
SELECT pg_temp.expect('AFTER panel: shared history empty after revoke', pg_temp.as_user(:'L_ADMIN', $q$SELECT count(*)::text FROM public.get_shared_service_history(10, 1)$q$), 'OK 0');
-- An all-lasers grant from the owner re-covers the approved request.
SELECT pg_temp.expect_like('AFTER owner grants all lasers directly', pg_temp.as_user(:'C_OWNER', $q$SELECT public.grant_service_history(10, 1, NULL)::text$q$), 'OK %');
SELECT pg_temp.expect('AFTER panel: approved again under an active all-lasers grant', pg_temp.my_status(:'L_ADMIN', 1), 'OK approved:true');
SELECT pg_temp.expect('AFTER request while shared: already approved', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 2)$q$), 'OK approved');
SELECT pg_temp.expect('AFTER owner revokes the all-lasers grant', pg_temp.as_user(:'C_OWNER', $q$SELECT public.revoke_service_history((SELECT max(id) FROM public.service_history_grants WHERE revoked_at IS NULL))::text$q$), 'OK true');
SELECT pg_temp.expect('AFTER panel: revoked again', pg_temp.my_status(:'L_ADMIN', 1), 'OK revoked:true');

-- ---------------------------------------------------------------- AFTER: revoke cooldown
SELECT pg_temp.expect_like('AFTER re-request after revoke: request_cooldown with retry_after', pg_temp.as_user_d(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'ERR P0001 request_cooldown | retry_after=20%Z');
SELECT pg_temp.expect_like('AFTER cooldown is per (clinic, shop): other laser too', pg_temp.as_user_d(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 2)$q$), 'ERR P0001 request_cooldown | retry_after=20%Z');
SELECT pg_temp.expect('AFTER cooldown wrote no request', (SELECT count(*)::text FROM public.service_history_requests), '1');
UPDATE public.service_history_grants SET granted_at = now() - interval '40 days', revoked_at = now() - interval '31 days';
SELECT pg_temp.expect('AFTER revoke 31 days ago: can ask again', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset

-- ---------------------------------------------------------------- AFTER: deny unchanged
SELECT pg_temp.expect('AFTER deny by a just-departed manager is allowed (shares nothing)', pg_temp.as_user(:'C_MGR', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'deny')$q$, :rq)), 'OK denied');
SELECT pg_temp.expect('AFTER panel: denied with retry_after', pg_temp.my_status(:'L_ADMIN', 1), 'OK denied:true');
SELECT pg_temp.expect_like('AFTER re-request after deny: same request_cooldown', pg_temp.as_user_d(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'ERR P0001 request_cooldown | retry_after=20%Z');
UPDATE public.service_history_requests SET responded_at = now() - interval '31 days', created_at = now() - interval '32 days' WHERE id = :rq;
SELECT pg_temp.expect('AFTER deny 31 days ago: can ask again', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT pg_temp.reset_history();

-- ---------------------------------------------------------------- AFTER: system revokes (no cooldown)
-- (a) revoke-on-join: the approving owner joins the shop (000922 trigger).
SELECT pg_temp.expect('SYS join: request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect('SYS join: owner approves', pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES (:'C_OWNER', 1, 'fse', false);
SELECT pg_temp.expect('SYS join: trigger revoked the grant, revoked_reason NULL', (SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL)::text || '/' || count(*)::text FROM public.service_history_grants), '1/1');
SELECT pg_temp.expect('SYS join: panel locked, no retry_after', pg_temp.my_status(:'L_ADMIN', 1), 'OK revoked:false');
SELECT pg_temp.expect('SYS join: shop can re-request immediately', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
DELETE FROM public.organization_memberships WHERE user_id = :'C_OWNER' AND organization_id = 1;
DELETE FROM public.organization_membership_departures WHERE user_id = :'C_OWNER';
SELECT pg_temp.reset_history();
-- (b) linked-shop removal with p_revoke_grants (000921), link restored after.
SELECT pg_temp.expect('SYS unlink: request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect('SYS unlink: owner approves', pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
SELECT pg_temp.expect('SYS unlink: remove_linked_service_shop revokes grants', pg_temp.as_user(:'C_OWNER', $q$SELECT public.remove_linked_service_shop(10, 1, false, true)::text$q$), 'OK true');
SELECT pg_temp.expect('SYS unlink: grant revoked, revoked_reason NULL', (SELECT count(*) FILTER (WHERE revoked_at IS NOT NULL AND revoked_reason IS NULL)::text || '/' || count(*)::text FROM public.service_history_grants), '1/1');
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (1, 10);
SELECT pg_temp.expect('SYS unlink: panel locked, no retry_after', pg_temp.my_status(:'L_ADMIN', 1), 'OK revoked:false');
SELECT pg_temp.expect('SYS unlink: relinked shop can re-request immediately', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT pg_temp.reset_history();
-- (c) a system revoke next to an owner revoke: the owner revoke still cools down.
SELECT pg_temp.expect('SYS mixed: request', pg_temp.as_user(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 1)$q$), 'OK pending');
SELECT max(id) AS rq FROM public.service_history_requests \gset
SELECT pg_temp.expect('SYS mixed: owner approves', pg_temp.as_user(:'C_OWNER', format($q$SELECT status FROM public.respond_to_service_history_request(%s, 'approve')$q$, :rq)), 'OK approved');
SELECT pg_temp.expect('SYS mixed: owner revokes', pg_temp.as_user(:'C_OWNER', $q$SELECT public.revoke_service_history((SELECT max(id) FROM public.service_history_grants))::text$q$), 'OK true');
SELECT pg_temp.expect_like('SYS mixed: owner revoke -> request_cooldown', pg_temp.as_user_d(:'L_ADMIN', $q$SELECT status FROM public.request_service_history_access(10, 2)$q$), 'ERR P0001 request_cooldown | retry_after=20%Z');
SELECT pg_temp.reset_history();

-- ---------------------------------------------------------------- hygiene
SELECT pg_temp.expect('HYG definer + empty search_path on all 5',
  (SELECT string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' ' ORDER BY p.proname)
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('grant_service_history', 'request_service_history_access', 'list_my_service_history_requests', 'history_grantor_recent_shop_staff', 'revoke_service_history')),
  'grant_service_history:true:search_path="" history_grantor_recent_shop_staff:true:search_path="" list_my_service_history_requests:true:search_path="" request_service_history_access:true:search_path="" revoke_service_history:true:search_path=""');
SELECT pg_temp.expect('HYG anon cannot execute any of the 5',
  (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('grant_service_history', 'request_service_history_access', 'list_my_service_history_requests', 'history_grantor_recent_shop_staff', 'revoke_service_history')), 'false');
SELECT pg_temp.expect('HYG helper: owner-only EXECUTE (no PUBLIC/anon/authenticated/service_role)',
  (SELECT proacl::text FROM pg_proc WHERE oid = 'public.history_grantor_recent_shop_staff(bigint,uuid)'::regprocedure), '{postgres=X/postgres}');
SELECT pg_temp.expect('HYG replaced functions keep their ACLs (authenticated EXECUTE)',
  (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('grant_service_history', 'request_service_history_access', 'list_my_service_history_requests', 'revoke_service_history')), 'true');
SELECT pg_temp.expect('HYG no schema-qualified EXTRACT/COALESCE',
  (SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('grant_service_history', 'request_service_history_access', 'list_my_service_history_requests', 'history_grantor_recent_shop_staff', 'revoke_service_history')
     AND (p.prosrc ILIKE '%pg_catalog.coalesce%' OR p.prosrc ILIKE '%pg_catalog.extract%')), '0');
SELECT pg_temp.expect('HYG N-1 grantor lock kept, once, before the N-2 check',
  (SELECT (length(prosrc) - length(replace(prosrc, $k$hashtextextended('tsp.history_grantor:' || uid::text, 0)$k$, ''))) / length($k$hashtextextended('tsp.history_grantor:' || uid::text, 0)$k$)
          || ':' || (strpos(prosrc, 'tsp.history_grantor:') < strpos(prosrc, 'history_grantor_recent_shop_staff'))::text
     FROM pg_proc WHERE oid = 'public.grant_service_history(bigint,bigint,bigint)'::regprocedure), '1:true');
SELECT pg_temp.expect('HYG revoke trigger body untouched (same lock key)',
  (strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.revoke_conflicted_history_grants()'::regprocedure), $k$hashtextextended('tsp.history_grantor:' || NEW.user_id::text, 0)$k$) > 0)::text, 'true');
SELECT pg_temp.expect('HYG no table/index/sequence ACL, policy or trigger change', pg_temp.fp_nonfn(), (SELECT v FROM fp WHERE k = 'nonfn'));

-- ---------------------------------------------------------------- ROLLBACK
\ir ../migrations/20261018_000925_service_history_n2_followups_rollback.sql
SELECT pg_temp.expect('ROLLBACK fingerprint = pre-000925', pg_temp.fingerprint(), (SELECT v FROM fp WHERE k = 'pre925'));
SELECT pg_temp.expect('ROLLBACK md5 grant_service_history = live', pg_temp.fn_md5('public.grant_service_history(bigint,bigint,bigint)'), '3bae6eee0d7d0360b795283d70839267');
SELECT pg_temp.expect('ROLLBACK md5 request_service_history_access = live', pg_temp.fn_md5('public.request_service_history_access(bigint,bigint,text)'), 'eb16d6ff8db01045369b330bc1fe3082');
SELECT pg_temp.expect('ROLLBACK md5 list_my_service_history_requests = live', pg_temp.fn_md5('public.list_my_service_history_requests(bigint)'), '849e65fd7513578572f1307778f267f1');
SELECT pg_temp.expect('ROLLBACK md5 revoke_service_history = live', pg_temp.fn_md5('public.revoke_service_history(bigint)'), '031991b951143598428bc7466a7bd8fc');
SELECT pg_temp.expect('ROLLBACK grants shape = pre-000925 (column + CHECK gone)', pg_temp.grants_shape(), (SELECT v FROM fp WHERE k = 'shape'));
SELECT pg_temp.expect('ROLLBACK non-function state = pre-000925', pg_temp.fp_nonfn(), (SELECT v FROM fp WHERE k = 'nonfn'));
SELECT pg_temp.expect('ROLLBACK helper dropped', (to_regprocedure('public.history_grantor_recent_shop_staff(bigint,uuid)') IS NULL)::text, 'true');
SELECT pg_temp.expect_like('ROLLBACK live behaviour back (just-departed manager can grant again)', pg_temp.as_user(:'C_MGR', $q$SELECT public.grant_service_history(10, 1, 1)::text$q$), 'OK %');
SELECT pg_temp.reset_history();
\ir ../migrations/20261018_000925_service_history_n2_followups_rollback.sql
SELECT pg_temp.expect('ROLLBACK idempotent', pg_temp.fingerprint() || pg_temp.grants_shape(), (SELECT v FROM fp WHERE k = 'pre925') || (SELECT v FROM fp WHERE k = 'shape'));
\ir ../migrations/20261018_000925_service_history_n2_followups.sql
SELECT pg_temp.expect('RE-APPLY after rollback = first apply', pg_temp.fingerprint(), (SELECT v FROM fp WHERE k = 'post925'));

ROLLBACK;
