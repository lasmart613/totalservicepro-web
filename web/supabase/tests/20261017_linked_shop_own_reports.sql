-- Local proof for 20261017_000921_linked_shop_own_reports.sql and its rollback.
-- Empty Postgres only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
-- Works from any directory (\ir paths are relative to this file):
--
--   createdb linked_shop_proof
--   psql "postgresql:///linked_shop_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261017_linked_shop_own_reports.sql
--
-- Helper functions are the live (2026-10-17) definitions from pg_get_functiondef:
-- is_active_org_member, get_my_org_id, org_unclaimed_new, org_creator_access,
-- user_owns_or_created_org, customer_org_link_allowed (md5 b2988094...).
-- The live stopgapped can_view_service_report_for_history (md5 4abb0da8...) and
-- the 000920 objects come from the 000920 migration file. RLS policies on
-- equipment, service_reports and organization_customers are copied from live
-- pg_policies.

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

-- Live stopgapped history function + 000920 (grants).
\ir ../migrations/20261017_000920_service_history_owner_consent.sql

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY equipment_facility_manage ON public.equipment TO authenticated
  USING (public.user_owns_or_created_org(customer_organization_id))
  WITH CHECK (public.user_owns_or_created_org(customer_organization_id));
CREATE POLICY service_reports_equipment_history_select ON public.service_reports FOR SELECT TO authenticated
  USING (public.can_view_service_report_for_history(service_reports.*));
CREATE POLICY service_reports_select ON public.service_reports FOR SELECT TO authenticated
  USING ((((organization_id)::text = (SELECT (user_profiles.organization_id)::text FROM public.user_profiles WHERE user_profiles.id = auth.uid() LIMIT 1)) AND public.is_active_org_member(organization_id)) OR ((created_by = auth.uid()) AND public.is_active_org_member(organization_id)));
CREATE POLICY "Users can view their service org's customer links" ON public.organization_customers FOR SELECT
  USING ((service_organization_id IN (SELECT user_profiles.organization_id FROM public.user_profiles WHERE user_profiles.id = auth.uid())) AND public.is_active_org_member(service_organization_id));
CREATE POLICY organization_customers_insert_linked ON public.organization_customers FOR INSERT TO authenticated
  WITH CHECK (public.customer_org_link_allowed(service_organization_id, customer_organization_id));
GRANT SELECT ON public.organizations, public.organization_memberships, public.user_profiles, public.engineer_invitations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment, public.service_reports, public.organization_customers TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- Fixtures.
--  1 Shop A (a1 fse) wrote RA-1..RA-3 for Clinic C.
--  2 Clinic C (owner c1, plain member c2 role 'staff'); created long ago by l1.
--  3 Shop L, linked to C (l1 fse = C's creator, l2 company_admin).
--  4 Shop Z (z1 admin): unrelated.
INSERT INTO public.organizations (id, name, type, created_by, created_at) VALUES
  (1, 'Shop A', 'service_company', NULL, now() - interval '1 year'),
  (2, 'Clinic C', 'customer', '00000000-0000-0000-0000-0000000000d1', now() - interval '1 year'),
  (3, 'Shop L', 'service_company', NULL, now() - interval '1 year'),
  (4, 'Shop Z', 'service_company', NULL, now() - interval '1 year');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1, 'fse', true),
  ('00000000-0000-0000-0000-0000000000c1', 2, 'owner', true),
  ('00000000-0000-0000-0000-0000000000c2', 2, 'staff', true),
  ('00000000-0000-0000-0000-0000000000d1', 3, 'fse', true),
  ('00000000-0000-0000-0000-0000000000d2', 3, 'company_admin', true),
  ('00000000-0000-0000-0000-0000000000e1', 4, 'company_admin', true);
INSERT INTO public.user_profiles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1, 1), ('00000000-0000-0000-0000-0000000000c1', 2, 2),
  ('00000000-0000-0000-0000-0000000000c2', 2, 2), ('00000000-0000-0000-0000-0000000000d1', 3, 3),
  ('00000000-0000-0000-0000-0000000000d2', 3, 3), ('00000000-0000-0000-0000-0000000000e1', 4, 4);
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id, created_by) VALUES (3, 2, '00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.equipment (id, customer_organization_id, serial_number, model) VALUES (1, 2, 'SN-C-1', 'Laser X');
SELECT setval('public.equipment_id_seq', 100);
INSERT INTO public.service_reports (organization_id, created_by, customer_organization_id, equipment_id, serial_number, title, report_number, tech_company_name, comments, date_out) VALUES
  (1, '00000000-0000-0000-0000-0000000000a1', 2, 1, 'SN-C-1', 'RA-1', 'RA-1', 'Shop A', 'SECRET A labor', '2026-09-03'),
  (1, '00000000-0000-0000-0000-0000000000a1', 2, 1, 'SN-C-1', 'RA-2', 'RA-2', 'Shop A', 'SECRET A', '2026-09-02'),
  (1, '00000000-0000-0000-0000-0000000000a1', 2, 1, 'SN-C-1', 'RA-3', 'RA-3', 'Shop A', 'SECRET A', '2026-09-01'),
  (3, '00000000-0000-0000-0000-0000000000d2', 2, 1, 'SN-C-1', 'RL-1', 'RL-1', 'Shop L', 'L own notes', '2026-10-01');

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
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '% FAILED: got %, want %', label, got, want; END IF;
  RAISE NOTICE 'PASS %: %', label, got;
END $$;
-- Fingerprint of every public function body + ACL (as a sorted set), every policy, and the table list.
CREATE FUNCTION pg_temp.fingerprint() RETURNS text LANGUAGE sql AS $$
  SELECT md5(
    COALESCE((SELECT string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), ''), '|' ORDER BY p.oid::regprocedure::text)
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'), '')
    || '#' ||
    COALESCE((SELECT string_agg(tablename || '.' || policyname || ':' || cmd || ':' || COALESCE(qual, '') || ':' || COALESCE(with_check, '') || ':' || roles::text, '|' ORDER BY tablename, policyname)
       FROM pg_policies WHERE schemaname = 'public'), '')
    || '#' ||
    COALESCE((SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'), '')
  )
$$;
CREATE TEMP TABLE fp (k text PRIMARY KEY, v text);

SET LOCAL search_path = public;
SELECT pg_temp.expect('BASE can_view is the live stopgap', md5(pg_get_functiondef('public.can_view_service_report_for_history(public.service_reports)'::regprocedure)), '4abb0da8e35302a52783eb49416f6b5a');
SELECT pg_temp.expect('BASE customer_org_link_allowed is live', md5(pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)), 'b29880941434873db018651aaa71c5ac');
RESET search_path;
INSERT INTO fp VALUES ('pre921', pg_temp.fingerprint());

-- BEFORE 000921: the linked shop reads another shop's full reports.
SELECT pg_temp.expect('BEFORE linked shop admin reads other shop reports', pg_temp.titles('00000000-0000-0000-0000-0000000000d2'), 'OK RA-1,RA-2,RA-3,RL-1');
SELECT pg_temp.expect('BEFORE linked shop admin reads other shop notes', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', $q$SELECT count(*)::text FROM public.service_reports WHERE comments LIKE 'SECRET%'$q$), 'OK 3');

-- 000921.
\ir ../migrations/20261017_000921_linked_shop_own_reports.sql

SELECT pg_temp.expect('linked shop admin sees only its own report', pg_temp.titles('00000000-0000-0000-0000-0000000000d2'), 'OK RL-1');
SELECT pg_temp.expect('linked shop cannot read another shop notes', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', $q$SELECT count(*)::text FROM public.service_reports WHERE comments LIKE 'SECRET%'$q$), 'OK 0');
SELECT pg_temp.expect('writing shop A still sees its reports', pg_temp.titles('00000000-0000-0000-0000-0000000000a1'), 'OK RA-1,RA-2,RA-3');
SELECT pg_temp.expect('clinic owner sees all its reports', pg_temp.titles('00000000-0000-0000-0000-0000000000c1'), 'OK RA-1,RA-2,RA-3,RL-1');
SELECT pg_temp.expect('unrelated shop sees nothing', pg_temp.titles('00000000-0000-0000-0000-0000000000e1'), 'OK none');
-- Known residual (#309 M1 territory): the clinic's creator, a member of the
-- linked shop, still reads via org_creator_access while the link exists.
SELECT pg_temp.expect('creator in linked shop still reads via creator access (until unlinked)', pg_temp.titles('00000000-0000-0000-0000-0000000000d1'), 'OK RA-1,RA-2,RA-3,RL-1');

-- Shared history for the linked shop needs a grant, and pages.
SELECT pg_temp.expect('linked shop: no shared history without a grant', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT COALESCE(string_agg(report_number, $$,$$ ORDER BY report_number), $$none$$) FROM public.get_shared_service_history(2)'), 'OK none');
SELECT pg_temp.expect('owner grants L', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT (public.grant_service_history(2, 3) IS NOT NULL)::text'), 'OK true');
SELECT pg_temp.expect('granted: redacted shared history', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT string_agg(report_number, $$,$$ ORDER BY report_number) FROM public.get_shared_service_history(2)'), 'OK RA-1,RA-2,RA-3,RL-1');
SELECT pg_temp.expect('page 1 of size 2 + total_count', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT string_agg(report_number || $$/$$ || total_count, $$,$$) FROM public.get_shared_service_history(2, NULL, 2, 0)'), 'OK RL-1/4,RA-1/4');
SELECT pg_temp.expect('page 2 of size 2', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT string_agg(report_number || $$/$$ || total_count, $$,$$) FROM public.get_shared_service_history(2, NULL, 2, 2)'), 'OK RA-2/4,RA-3/4');
SELECT pg_temp.expect('limit clamps to at least 1', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT count(*)::text FROM public.get_shared_service_history(2, NULL, 0, 0)'), 'OK 1');
SELECT pg_temp.expect('limit clamps to at most 500', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT count(*)::text FROM public.get_shared_service_history(2, NULL, 100000, -5)'), 'OK 4');
SELECT pg_temp.expect('old 2-arg signature is gone', (to_regprocedure('public.get_shared_service_history(bigint,bigint)') IS NULL)::text, 'true');

-- Grants: owner side only on the table; grantee via RPC without user ids.
SELECT pg_temp.expect('grantee cannot read grant rows (granted_by hidden)', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT count(*)::text FROM public.service_history_grants'), 'OK 0');
SELECT pg_temp.expect('grantee lists its grants via RPC', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT string_agg(owner_name, $$,$$) FROM public.list_my_service_history_grants()'), 'OK Clinic C');
SELECT pg_temp.expect('grantee RPC has no granted_by column', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT granted_by::text FROM public.list_my_service_history_grants() LIMIT 1'), 'ERR 42703');
SELECT pg_temp.expect('owner reads grant rows with granted_by', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT count(granted_by)::text FROM public.service_history_grants'), 'OK 1');
SELECT pg_temp.expect('owner_admin not executable by authenticated', has_function_privilege('authenticated', 'public.service_history_owner_admin(bigint)', 'EXECUTE')::text, 'false');
SELECT pg_temp.expect('owner_admin still executable by service_role', has_function_privilege('service_role', 'public.service_history_owner_admin(bigint)', 'EXECUTE')::text, 'true');
SELECT pg_temp.expect('owner revokes L grant (RPCs still work)', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT public.revoke_service_history((SELECT id FROM public.service_history_grants LIMIT 1))::text'), 'OK true');

-- Owner-side link management.
SELECT pg_temp.expect('owner lists linked shops', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT string_agg(shop_name || $$:$$ || (removed_at IS NULL)::text, $$,$$) FROM public.list_linked_service_shops(2)'), 'OK Shop L:true');
SELECT pg_temp.expect('clinic staff (not admin) cannot list', pg_temp.as_user('00000000-0000-0000-0000-0000000000c2', 'SELECT count(*)::text FROM public.list_linked_service_shops(2)'), 'ERR 42501');
SELECT pg_temp.expect('linked shop cannot list the clinic links', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT count(*)::text FROM public.list_linked_service_shops(2)'), 'ERR 42501');
SELECT pg_temp.expect('linked shop cannot remove links', pg_temp.as_user('00000000-0000-0000-0000-0000000000d2', 'SELECT public.remove_linked_service_shop(2, 3)::text'), 'ERR 42501');
SELECT pg_temp.expect('clinic creator (shop L tech) cannot remove links', pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', 'SELECT public.remove_linked_service_shop(2, 1)::text'), 'ERR 42501');
SELECT pg_temp.expect('anon cannot execute link RPCs', (has_function_privilege('anon', 'public.list_linked_service_shops(bigint)', 'EXECUTE') OR has_function_privilege('anon', 'public.remove_linked_service_shop(bigint,bigint,boolean)', 'EXECUTE') OR has_function_privilege('anon', 'public.allow_linked_service_shop(bigint,bigint)', 'EXECUTE') OR has_function_privilege('anon', 'public.list_my_service_history_grants()', 'EXECUTE'))::text, 'false');
SELECT pg_temp.expect('owner removes the link', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT public.remove_linked_service_shop(2, 3)::text'), 'OK true');
SELECT pg_temp.expect('removed link: creator in shop L loses access', pg_temp.titles('00000000-0000-0000-0000-0000000000d1'), 'OK RL-1');
SELECT pg_temp.expect('removed link: shop L keeps only its own report', pg_temp.titles('00000000-0000-0000-0000-0000000000d2'), 'OK RL-1');
SELECT pg_temp.expect('removed link: shop L loses equipment access', pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', 'SELECT count(*)::text FROM public.equipment'), 'OK 0');
SELECT pg_temp.expect('list shows the removal', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT string_agg(shop_name || $$:$$ || (removed_at IS NOT NULL)::text, $$,$$) FROM public.list_linked_service_shops(2)'), 'OK Shop L:true');
SELECT pg_temp.expect('shop L cannot re-link itself after removal', pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', $q$INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (3, 2) RETURNING 'x'$q$), 'ERR 42501');
SELECT pg_temp.expect('block table is not client-readable', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT count(*)::text FROM public.organization_customer_link_blocks'), 'ERR 42501');
SELECT pg_temp.expect('owner allows L again', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT public.allow_linked_service_shop(2, 3)::text'), 'OK true');
SELECT pg_temp.expect('after allow, shop L can link again (usual rule)', pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', $q$INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (3, 2) RETURNING 'x'$q$), 'OK x');
SELECT pg_temp.expect('re-linked shop still sees only its own report', pg_temp.titles('00000000-0000-0000-0000-0000000000d2'), 'OK RL-1');
SELECT pg_temp.expect('remove without block', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', 'SELECT public.remove_linked_service_shop(2, 3, false)::text'), 'OK true');
SELECT pg_temp.expect('no block row after unblocked removal', pg_temp.as_user('00000000-0000-0000-0000-0000000000c1', $q$SELECT count(*)::text FROM public.list_linked_service_shops(2)$q$), 'OK 0');

-- Function hygiene.
SELECT pg_temp.expect('000921 functions are SECURITY DEFINER with search_path ""',
  (SELECT string_agg(proname || '=' || prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' ORDER BY proname)
     FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('can_view_service_report_for_history', 'customer_org_link_allowed', 'list_linked_service_shops', 'remove_linked_service_shop', 'allow_linked_service_shop', 'list_my_service_history_grants', 'get_shared_service_history')),
  'allow_linked_service_shop=true:search_path="" can_view_service_report_for_history=true:search_path="" customer_org_link_allowed=true:search_path="" get_shared_service_history=true:search_path="" list_linked_service_shops=true:search_path="" list_my_service_history_grants=true:search_path="" remove_linked_service_shop=true:search_path=""');

-- Rollback restores the exact prior functions, ACLs, policies and tables.
\ir ../migrations/20261017_000921_linked_shop_own_reports_rollback.sql
SELECT pg_temp.expect('ROLLBACK fingerprint equals pre-000921', pg_temp.fingerprint(), (SELECT v FROM fp WHERE k = 'pre921'));
SET LOCAL search_path = public;
SELECT pg_temp.expect('ROLLBACK can_view md5', md5(pg_get_functiondef('public.can_view_service_report_for_history(public.service_reports)'::regprocedure)), '4abb0da8e35302a52783eb49416f6b5a');
SELECT pg_temp.expect('ROLLBACK customer_org_link_allowed md5', md5(pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)), 'b29880941434873db018651aaa71c5ac');
RESET search_path;
INSERT INTO public.organization_customers (service_organization_id, customer_organization_id) VALUES (3, 2);
SELECT pg_temp.expect('ROLLBACK relinked shop reads other shop reports again (old behavior)', pg_temp.titles('00000000-0000-0000-0000-0000000000d2'), 'OK RA-1,RA-2,RA-3,RL-1');

ROLLBACK;
