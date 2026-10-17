-- Local proof for 20261017_000920_service_history_owner_consent.sql and its
-- rollback (H2). Empty Postgres only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
--
--   createdb service_history_proof
--   psql "postgresql:///service_history_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261017_service_history_owner_consent.sql
--
-- Works from any directory (\ir paths are relative to this file).
-- Helper functions are the live (2026-10-17) definitions from pg_get_functiondef:
-- is_active_org_member, get_my_org_id, org_unclaimed_new, org_creator_access,
-- user_owns_or_created_org. The PRE-stopgap body of
-- can_view_service_report_for_history (md5 90b5e7fe...) is inlined to show the
-- attack. The live STOPGAPPED body (md5 4abb0da8..., live since 2026-10-17
-- 8:50 AM MST) is the baseline; it is installed from the 000920 rollback file.
-- RLS policies on equipment and service_reports are copied from live pg_policies.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.organizations already exists';
  END IF;
END $$;

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

CREATE TABLE public.organizations (id bigint PRIMARY KEY, name text NOT NULL, type text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.organization_memberships (id bigserial PRIMARY KEY, user_id uuid NOT NULL, organization_id bigint NOT NULL REFERENCES public.organizations(id), role text, is_home boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now(), UNIQUE (user_id, organization_id));
CREATE TABLE public.organization_customers (id bigserial PRIMARY KEY, service_organization_id bigint REFERENCES public.organizations(id), customer_organization_id bigint REFERENCES public.organizations(id), UNIQUE (service_organization_id, customer_organization_id));
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

-- PRE-stopgap live body (md5 90b5e7fe571ea1b49ea7dec72121782a), inlined.
CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- Own service company reports
    (r.organization_id IS NOT NULL AND r.organization_id = public.get_my_org_id())
    OR (
      r.created_by IS NOT NULL
      AND r.created_by = auth.uid()
      AND public.is_active_org_member(r.organization_id)
    )
    -- Facility that is the report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND public.user_owns_or_created_org(r.customer_organization_id)
    )
    -- Facility that currently owns the linked equipment row
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    )
    -- Facility that currently owns a laser with the same serial (transfer case)
    OR (
      r.serial_number IS NOT NULL
      AND trim(r.serial_number) <> ''
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.serial_number IS NOT NULL
          AND lower(trim(e.serial_number)) = lower(trim(r.serial_number))
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    )
    -- Service org linked via organization_customers to report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = r.customer_organization_id
          AND oc.service_organization_id = public.get_my_org_id()
      )
    );
$function$;

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipment_facility_manage ON public.equipment TO authenticated
  USING (public.user_owns_or_created_org(customer_organization_id))
  WITH CHECK (public.user_owns_or_created_org(customer_organization_id));
CREATE POLICY equipment_service_org_manage ON public.equipment TO authenticated
  USING (public.user_owns_or_created_org(customer_organization_id) OR EXISTS (SELECT 1 FROM public.organization_customers oc JOIN public.user_profiles up ON up.organization_id = oc.service_organization_id WHERE up.id = auth.uid() AND oc.customer_organization_id = equipment.customer_organization_id AND public.is_active_org_member(oc.service_organization_id)))
  WITH CHECK (public.user_owns_or_created_org(customer_organization_id) OR EXISTS (SELECT 1 FROM public.organization_customers oc JOIN public.user_profiles up ON up.organization_id = oc.service_organization_id WHERE up.id = auth.uid() AND oc.customer_organization_id = equipment.customer_organization_id AND public.is_active_org_member(oc.service_organization_id)));
CREATE POLICY service_reports_equipment_history_select ON public.service_reports FOR SELECT TO authenticated
  USING (public.can_view_service_report_for_history(service_reports.*));
CREATE POLICY service_reports_select ON public.service_reports FOR SELECT TO authenticated
  USING ((((organization_id)::text = (SELECT (user_profiles.organization_id)::text FROM public.user_profiles WHERE user_profiles.id = auth.uid() LIMIT 1)) AND public.is_active_org_member(organization_id)) OR ((created_by = auth.uid()) AND public.is_active_org_member(organization_id)));
GRANT SELECT ON public.organizations, public.organization_customers, public.organization_memberships, public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment, public.service_reports TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Fixtures.
--  1 Shop S (wrote the history; services V)      a1 = S technician
--  2 Victim Clinic V (owner f2)                  equipment 1 'SN-VICTIM-1', 4 'SN-OTHER-2'
--  4 Attacker Shop S2 (admin e2), links its own clinic Y (7)
--  5 Attacker Clinic X: fresh org created by e1 (24h creator access, no membership)
--  6 Unlinked Owner M (owner f6)
--  8 New Shop T (tech t1, admin t2): V wants to hire T
--  9 Parts Supplier P (p1): not a service company
INSERT INTO public.organizations (id, name, type, created_by, created_at) VALUES
  (1, 'Shop S', 'service_company', NULL, now() - interval '1 year'),
  (2, 'Victim Clinic V', 'customer', NULL, now() - interval '1 year'),
  (4, 'Attacker Shop S2', 'service_company', NULL, now() - interval '1 year'),
  (5, 'Attacker Clinic X', 'customer', '00000000-0000-0000-0000-0000000000e1', now()),
  (6, 'Unlinked Owner M', 'customer', NULL, now() - interval '1 year'),
  (7, 'Attacker Clinic Y', 'customer', '00000000-0000-0000-0000-0000000000e2', now() - interval '1 year'),
  (8, 'New Shop T', 'service_company', NULL, now() - interval '1 year'),
  (9, 'Parts Supplier P', 'parts_supplier', NULL, now() - interval '1 year');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1, 'fse', true),
  ('00000000-0000-0000-0000-0000000000f2', 2, 'owner', true),
  ('00000000-0000-0000-0000-0000000000e2', 4, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000f6', 6, 'owner', true),
  ('00000000-0000-0000-0000-0000000000b1', 8, 'fse', true),
  ('00000000-0000-0000-0000-0000000000b2', 8, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000c1', 9, 'parts_supplier', true);
INSERT INTO public.user_profiles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1, 1), ('00000000-0000-0000-0000-0000000000f2', 2, 2),
  ('00000000-0000-0000-0000-0000000000e1', NULL, NULL), ('00000000-0000-0000-0000-0000000000e2', 4, 4),
  ('00000000-0000-0000-0000-0000000000f6', 6, 6), ('00000000-0000-0000-0000-0000000000b1', 8, 8),
  ('00000000-0000-0000-0000-0000000000b2', 8, 8), ('00000000-0000-0000-0000-0000000000c1', 9, 9);
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (1, 2), (4, 7);
INSERT INTO public.equipment (id, customer_organization_id, serial_number, model) VALUES
  (1, 2, 'SN-VICTIM-1', 'Laser X'), (4, 2, 'SN-OTHER-2', 'Laser Z'), (3, 6, 'SN-M-3', 'Laser Y');
SELECT setval('public.equipment_id_seq', 100);
INSERT INTO public.service_reports (organization_id, created_by, customer_organization_id, equipment_id, serial_number, title, report_number, status, tech_company_name, comments, pdf_url, tech_signature, customer_phone, date_out) VALUES
  (1, '00000000-0000-0000-0000-0000000000a1', 2, 1, 'SN-VICTIM-1', 'VICTIM', 'SR-1', 'final', 'Shop S', 'INTERNAL labor $185/h SECRET', 'https://x/SECRET.pdf', 'SECRETSIG', 'SECRET-555', '2026-09-01'),
  (1, '00000000-0000-0000-0000-0000000000a1', 2, NULL, 'sn-victim-1 ', 'VICTIM-LEGACY', 'SR-2', 'final', 'Shop S', 'SECRET quote', NULL, NULL, NULL, '2026-05-01'),
  (1, '00000000-0000-0000-0000-0000000000a1', 2, 4, 'SN-OTHER-2', 'OTHER', 'SR-3', 'final', 'Shop S', 'SECRET', NULL, NULL, NULL, '2026-08-01');

CREATE FUNCTION pg_temp.as_user(u text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', u, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE stmt INTO t;
    t := 'OK ' || COALESCE(t, '(null)');
  EXCEPTION WHEN others THEN
    t := 'ERR ' || SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.titles(u text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.as_user(u, $q$SELECT COALESCE(string_agg(title, ',' ORDER BY title), 'none') FROM public.service_reports$q$)
$$;
CREATE FUNCTION pg_temp.shared(u text, owner_org bigint, eq bigint DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.as_user(u, format($q$SELECT COALESCE(string_agg(report_number, ',' ORDER BY report_number), 'none') FROM public.get_shared_service_history(%s, %s)$q$, owner_org, COALESCE(eq::text, 'NULL')))
$$;
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '% FAILED: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS %: %', label, got;
END $$;
CREATE FUNCTION pg_temp.fn_md5() RETURNS text LANGUAGE sql AS $$
  SELECT md5(pg_get_functiondef('public.can_view_service_report_for_history(public.service_reports)'::regprocedure))
$$;

-- Attackers add equipment carrying the victim's serial to orgs they control.
SELECT pg_temp.expect('attackers add victim serial (X, fresh org)', pg_temp.as_user('00000000-0000-0000-0000-0000000000e1', $q$INSERT INTO public.equipment (customer_organization_id, serial_number) VALUES (5, 'sn-victim-1 ') RETURNING 'x'$q$), 'OK x');
SELECT pg_temp.expect('attackers add victim serial (Y, own shop link)', pg_temp.as_user('00000000-0000-0000-0000-0000000000e2', $q$INSERT INTO public.equipment (customer_organization_id, serial_number) VALUES (7, 'Sn-Victim-1') RETURNING 'y'$q$), 'OK y');

-- PRE-stopgap body: the H2 attack works.
SET LOCAL search_path = public;
SELECT pg_temp.expect('PRE md5', pg_temp.fn_md5(), '90b5e7fe571ea1b49ea7dec72121782a');
RESET search_path;
SELECT pg_temp.expect('PRE attacker X reads other tenant', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK VICTIM,VICTIM-LEGACY');
SELECT pg_temp.expect('PRE attacker shop admin reads other tenant', pg_temp.titles('00000000-0000-0000-0000-0000000000e2'), 'OK VICTIM,VICTIM-LEGACY');

-- BASELINE: the live stopgapped body (installed from the 000920 rollback).
\ir ../migrations/20261017_000920_service_history_owner_consent_rollback.sql
SET LOCAL search_path = public;
SELECT pg_temp.expect('BASELINE md5 is live stopgap', pg_temp.fn_md5(), '4abb0da8e35302a52783eb49416f6b5a');
RESET search_path;
SELECT pg_temp.expect('BASELINE serial collision denied (X)', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK none');
SELECT pg_temp.expect('BASELINE serial collision denied (S2 admin)', pg_temp.titles('00000000-0000-0000-0000-0000000000e2'), 'OK none');

-- 000920.
\ir ../migrations/20261017_000920_service_history_owner_consent.sql
SET LOCAL search_path = public;
SELECT pg_temp.expect('000920 keeps the stopgapped body', pg_temp.fn_md5(), '4abb0da8e35302a52783eb49416f6b5a');
RESET search_path;
SELECT pg_temp.expect('serial collision denied (X)', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK none');
SELECT pg_temp.expect('serial collision denied (S2 admin)', pg_temp.titles('00000000-0000-0000-0000-0000000000e2'), 'OK none');
SELECT pg_temp.expect('serial collision gives no shared history (S2 admin)', pg_temp.shared('00000000-0000-0000-0000-0000000000e2', 2), 'OK none');
SELECT pg_temp.expect('victim owner sees own history', pg_temp.titles('00000000-0000-0000-0000-0000000000f2'), 'OK OTHER,VICTIM,VICTIM-LEGACY');
SELECT pg_temp.expect('writing shop sees its reports', pg_temp.titles('00000000-0000-0000-0000-0000000000a1'), 'OK OTHER,VICTIM,VICTIM-LEGACY');
SELECT pg_temp.expect('default locked: new shop T shared history', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK none');

-- Who may grant.
SELECT pg_temp.expect('non-owner outsider cannot grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000e1', 'SELECT public.grant_service_history(2, 4)::text'), 'ERR 42501');
SELECT pg_temp.expect('grantee shop admin cannot self-grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', 'SELECT public.grant_service_history(2, 8)::text'), 'ERR 42501');
SELECT pg_temp.expect('grantee tech cannot self-grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', 'SELECT public.grant_service_history(2, 8)::text'), 'ERR 42501');
SELECT pg_temp.expect('linked shop S tech cannot grant for V', pg_temp.as_user('00000000-0000-0000-0000-0000000000a1', 'SELECT public.grant_service_history(2, 8)::text'), 'ERR 42501');
SELECT pg_temp.expect('creator-access only (fresh org X) cannot grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000e1', 'SELECT public.grant_service_history(5, 4)::text'), 'ERR 42501');
SELECT pg_temp.expect('direct insert into grants refused', pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', $q$INSERT INTO public.service_history_grants (owner_org_id, grantee_shop_org_id, granted_by) VALUES (2, 8, auth.uid()) RETURNING 'x'$q$), 'ERR 42501');
SELECT pg_temp.expect('owner cannot grant a non-service org', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', 'SELECT public.grant_service_history(2, 9)::text'), 'ERR 22023');
SELECT pg_temp.expect('owner cannot scope to equipment it does not own', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', 'SELECT public.grant_service_history(2, 8, 3)::text'), 'ERR 22023');
SELECT pg_temp.expect('anon cannot execute grant', has_function_privilege('anon', 'public.grant_service_history(bigint,bigint,bigint)', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('anon cannot execute shared history', has_function_privilege('anon', 'public.get_shared_service_history(bigint,bigint)', 'EXECUTE')::text, 'false');

-- Per-equipment grant: only laser 1 (plus V's serial-only report on that serial).
SELECT pg_temp.expect('owner grants T laser 1', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', 'SELECT (public.grant_service_history(2, 8, 1) IS NOT NULL)::text'), 'OK true');
SELECT pg_temp.expect('per-equipment grant allows that laser only', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK SR-1,SR-2');
SELECT pg_temp.expect('per-equipment grant, narrowed to laser 4', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2, 4), 'OK none');
SELECT pg_temp.expect('grant does not widen full-row RLS for T', pg_temp.titles('00000000-0000-0000-0000-0000000000b1'), 'OK none');
SELECT pg_temp.expect('other shops still locked (S2)', pg_temp.shared('00000000-0000-0000-0000-0000000000e2', 2), 'OK none');

-- All-equipment grant.
SELECT pg_temp.expect('owner grants T all equipment', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', 'SELECT (public.grant_service_history(2, 8) IS NOT NULL)::text'), 'OK true');
SELECT pg_temp.expect('grant is idempotent', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', $q$SELECT (public.grant_service_history(2, 8) = (SELECT id FROM public.service_history_grants WHERE equipment_id IS NULL AND revoked_at IS NULL))::text$q$), 'OK true');
SELECT pg_temp.expect('all-equipment grant allows', pg_temp.shared('00000000-0000-0000-0000-0000000000b2', 2), 'OK SR-1,SR-2,SR-3');
SELECT pg_temp.expect('narrowed to laser 4', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2, 4), 'OK SR-3');
SELECT pg_temp.expect('shared rows carry no internal notes, prices, PDF, signature or contacts', pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', $q$SELECT (count(*) > 0 AND bool_and(position('SECRET' in row_to_json(h)::text) = 0))::text FROM public.get_shared_service_history(2) h$q$), 'OK true');
SELECT pg_temp.expect('shared history has no comments column', pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', 'SELECT comments FROM public.get_shared_service_history(2) LIMIT 1'), 'ERR 42703');
SELECT pg_temp.expect('grantee reads its grants', pg_temp.as_user('00000000-0000-0000-0000-0000000000b1', 'SELECT count(*)::text FROM public.service_history_grants'), 'OK 2');
SELECT pg_temp.expect('owner reads its grants', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', 'SELECT count(*)::text FROM public.service_history_grants'), 'OK 2');
SELECT pg_temp.expect('outsider reads no grants', pg_temp.as_user('00000000-0000-0000-0000-0000000000e2', 'SELECT count(*)::text FROM public.service_history_grants'), 'OK 0');
SELECT pg_temp.expect('grantee cannot revoke', pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', $q$SELECT public.revoke_service_history((SELECT id FROM public.service_history_grants WHERE equipment_id IS NULL))::text$q$), 'ERR 42501');
SELECT pg_temp.expect('grantee cannot update grants directly', pg_temp.as_user('00000000-0000-0000-0000-0000000000b2', $q$WITH u AS (UPDATE public.service_history_grants SET revoked_at = NULL RETURNING 1) SELECT count(*)::text FROM u$q$), 'ERR 42501');

-- Revoke takes effect immediately.
SELECT pg_temp.expect('owner revokes all-equipment grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', $q$SELECT public.revoke_service_history((SELECT id FROM public.service_history_grants WHERE equipment_id IS NULL))::text$q$), 'OK true');
SELECT pg_temp.expect('after revoke: back to the laser-1 grant', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK SR-1,SR-2');
SELECT pg_temp.expect('owner revokes laser-1 grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', $q$SELECT public.revoke_service_history((SELECT id FROM public.service_history_grants WHERE equipment_id = 1))::text$q$), 'OK true');
SELECT pg_temp.expect('revoke denies', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK none');
SELECT pg_temp.expect('revoke twice is a no-op', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', $q$SELECT public.revoke_service_history((SELECT id FROM public.service_history_grants WHERE equipment_id = 1))::text$q$), 'OK false');
SELECT pg_temp.expect('re-grant after revoke makes a new row', pg_temp.as_user('00000000-0000-0000-0000-0000000000f2', $q$SELECT (public.grant_service_history(2, 8) NOT IN (SELECT id FROM public.service_history_grants WHERE revoked_at IS NOT NULL))::text$q$), 'OK true');
SELECT pg_temp.expect('re-granted', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK SR-1,SR-2,SR-3');
SELECT pg_temp.expect('grantee tech before leaving the shop', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK SR-1,SR-2,SR-3');
DELETE FROM public.organization_memberships WHERE user_id = '00000000-0000-0000-0000-0000000000b1';
SELECT pg_temp.expect('left member: no shared history', pg_temp.shared('00000000-0000-0000-0000-0000000000b1', 2), 'OK none');

-- Real transfer: the SAME equipment row moves from V to M. History follows it.
UPDATE public.equipment SET customer_organization_id = 6 WHERE id = 1;
SELECT pg_temp.expect('real transfer (same row) keeps history', pg_temp.titles('00000000-0000-0000-0000-0000000000f6'), 'OK VICTIM');
SELECT pg_temp.expect('attacker still nothing after transfer', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK none');
UPDATE public.equipment SET customer_organization_id = 2 WHERE id = 1;

-- Function hygiene.
SELECT pg_temp.expect('all 000920 functions are SECURITY DEFINER with search_path ""',
  (SELECT string_agg(proname || '=' || prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' ORDER BY proname)
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('can_view_service_report_for_history', 'service_history_owner_admin', 'grant_service_history', 'revoke_service_history', 'get_shared_service_history')),
  'can_view_service_report_for_history=true:search_path="" get_shared_service_history=true:search_path="" grant_service_history=true:search_path="" revoke_service_history=true:search_path="" service_history_owner_admin=true:search_path=""');
SELECT pg_temp.expect('grants table has RLS on', (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.service_history_grants'::regclass), 'true');

-- Rollback: back to the live stopgapped body, grants gone.
\ir ../migrations/20261017_000920_service_history_owner_consent_rollback.sql
SET LOCAL search_path = public;
SELECT pg_temp.expect('ROLLBACK md5 is the live stopgap', pg_temp.fn_md5(), '4abb0da8e35302a52783eb49416f6b5a');
RESET search_path;
SELECT pg_temp.expect('ROLLBACK grants table gone', (to_regclass('public.service_history_grants') IS NULL)::text, 'true');
SELECT pg_temp.expect('ROLLBACK shared-history RPC gone', (to_regprocedure('public.get_shared_service_history(bigint,bigint)') IS NULL)::text, 'true');
SELECT pg_temp.expect('ROLLBACK serial collision still denied', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK none');

ROLLBACK;
