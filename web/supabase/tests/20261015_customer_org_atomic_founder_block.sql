-- Local proof for 20261015_000917_customer_org_atomic_founder_block.sql and
-- its rollback. Empty Postgres only (never production). Refuses to run when
-- public.organizations already exists. One transaction, ends in ROLLBACK.
--
--   createdb customer_org_proof
--   psql "postgresql:///customer_org_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261015_customer_org_atomic_founder_block.sql
--
-- Run psql from the repo root so the \i paths resolve.
-- Fixture functions are the live (2026-10-15) definitions from
-- pg_get_functiondef (org_unclaimed_new, founder_role_for_org,
-- membership_insert_allowed, organizations_guard_privilege,
-- set_organization_created_by). Invitation helpers are stubs (not exercised).

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
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TABLE public.organizations (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  type text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  address text, city text, state text, phone text, laser_models text, facility_type text,
  is_premium boolean, premium_until timestamptz, premium_grant text, trial_granted_at timestamptz,
  subscription_tier text, plan text, stripe_account_id text,
  stripe_charges_enabled boolean, stripe_payouts_enabled boolean, stripe_details_submitted boolean
);
CREATE TABLE public.organization_memberships (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text,
  is_home boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
CREATE TABLE public.organization_customers (
  id bigserial PRIMARY KEY,
  service_organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT organization_customers_unique UNIQUE (service_organization_id, customer_organization_id)
);
CREATE TABLE public.engineer_invitations (
  id bigserial PRIMARY KEY, organization_id bigint, email text, role text,
  accepted boolean, expires_at timestamptz, created_at timestamptz DEFAULT now(), invited_by uuid
);
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

CREATE OR REPLACE FUNCTION public.auth_login_email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE OR REPLACE FUNCTION public.invitation_is_open(boolean, timestamptz, timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.profile_role_from_membership(text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT lower(btrim($1)) $$;

-- live definitions
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
CREATE OR REPLACE FUNCTION public.founder_role_for_org(p_organization_id bigint)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE lower(btrim(coalesce(o.type, '')))
    WHEN 'parts_supplier' THEN 'parts_supplier'
    WHEN 'supplier' THEN 'parts_supplier'
    WHEN 'vendor' THEN 'parts_supplier'
    WHEN 'customer' THEN 'owner'
    WHEN 'laser_clinic' THEN 'owner'
    WHEN 'laser_rental' THEN 'owner'
    WHEN 'laser_reseller' THEN 'owner'
    WHEN 'service_company' THEN 'company_admin'
    ELSE 'company_admin'
  END
  FROM public.organizations o
  WHERE o.id = p_organization_id;
$function$;
CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        -- Founder of a brand-new org only: a creator can't join a customer
        -- org that a shop already serves or that already has members.
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.created_by = auth.uid()
            AND public.org_unclaimed_new(o.id, o.created_at)
        )
        AND lower(btrim(coalesce(p_role, ''))) IN (
          public.founder_role_for_org(p_organization_id),
          'fse', 'engineer', 'technician'
        )
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(btrim(coalesce(p_role, ''))) = public.profile_role_from_membership(
              coalesce(NULLIF(TRIM(i.role), ''), 'fse')
            )
        )
      )
    );
$function$;
CREATE OR REPLACE FUNCTION public.organizations_guard_privilege()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  newj jsonb := pg_catalog.to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN pg_catalog.to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user';
    END IF;
    IF coalesce((newj->>'is_premium')::boolean, false) IS TRUE THEN
      RAISE EXCEPTION 'is_premium cannot be self-granted';
    END IF;
    IF nullif(newj->>'premium_until', '') IS NOT NULL
       OR nullif(newj->>'premium_grant', '') IS NOT NULL THEN
      RAISE EXCEPTION 'premium fields cannot be self-granted';
    END IF;
    IF nullif(newj->>'trial_granted_at', '') IS NOT NULL THEN
      RAISE EXCEPTION 'trial_granted_at cannot be set by the client';
    END IF;
    IF lower(coalesce(newj->>'subscription_tier', '')) NOT IN ('', 'free')
       OR lower(coalesce(newj->>'plan', '')) NOT IN ('', 'free') THEN
      RAISE EXCEPTION 'plan cannot be self-granted';
    END IF;
    IF nullif(newj->>'stripe_account_id', '') IS NOT NULL
       OR coalesce((newj->>'stripe_charges_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_payouts_enabled')::boolean, false)
       OR coalesce((newj->>'stripe_details_submitted')::boolean, false) THEN
      RAISE EXCEPTION 'stripe connect fields cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;
  IF (newj->>'is_premium') IS DISTINCT FROM (oldj->>'is_premium')
     OR (newj->>'premium_until') IS DISTINCT FROM (oldj->>'premium_until')
     OR (newj->>'premium_grant') IS DISTINCT FROM (oldj->>'premium_grant')
     OR (newj->>'subscription_tier') IS DISTINCT FROM (oldj->>'subscription_tier')
     OR (newj->>'plan') IS DISTINCT FROM (oldj->>'plan') THEN
    RAISE EXCEPTION 'plan and premium fields cannot be changed by the client';
  END IF;
  IF (newj->>'trial_granted_at') IS DISTINCT FROM (oldj->>'trial_granted_at') THEN
    RAISE EXCEPTION 'trial_granted_at cannot be changed by the client';
  END IF;
  IF (newj->>'stripe_account_id') IS DISTINCT FROM (oldj->>'stripe_account_id')
     OR (newj->>'stripe_charges_enabled') IS DISTINCT FROM (oldj->>'stripe_charges_enabled')
     OR (newj->>'stripe_payouts_enabled') IS DISTINCT FROM (oldj->>'stripe_payouts_enabled')
     OR (newj->>'stripe_details_submitted') IS DISTINCT FROM (oldj->>'stripe_details_submitted') THEN
    RAISE EXCEPTION 'stripe connect fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_organization_created_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.created_by IS NULL THEN
        NEW.created_by = auth.uid();
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER organizations_guard_privilege BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.organizations_guard_privilege();
CREATE TRIGGER trg_set_org_created_by BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_organization_created_by();

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_memberships_insert_own_home ON public.organization_memberships
  FOR INSERT TO authenticated WITH CHECK (public.membership_insert_allowed(user_id, organization_id, role, is_home));
CREATE POLICY organization_memberships_select_own ON public.organization_memberships
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TEMP TABLE live_defs AS
  SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS h
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'membership_insert_allowed';
GRANT SELECT ON live_defs TO authenticated;

-- fixture: shop 1 (service_company). admin A, service_manager M, fse F,
-- removed R (no membership), clinic founder C with no shop.
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'm@test'),
  ('00000000-0000-0000-0000-00000000000c', 'f@test'),
  ('00000000-0000-0000-0000-00000000000d', 'r@test'),
  ('00000000-0000-0000-0000-00000000000e', 'c@test');
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (1, 'Shop One', 'service_company', NULL),
  (2, 'Supplier', 'parts_supplier', NULL);
SELECT setval('public.organizations_id_seq', 100);
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-00000000000a', 1, 'company_admin', true),
  ('00000000-0000-0000-0000-00000000000b', 1, 'service_manager', true),
  ('00000000-0000-0000-0000-00000000000c', 1, 'fse', true);

-- Before 000917: a shop user's fresh, unlinked customer org is claimable.
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (50, 'Half-added Clinic', 'customer', '00000000-0000-0000-0000-00000000000c');
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  IF NOT public.membership_insert_allowed('00000000-0000-0000-0000-00000000000c', 50, 'owner', true) THEN
    RAISE EXCEPTION 'precondition: before 000917 the shop creator could claim org 50';
  END IF;
  RAISE NOTICE 'ok   before 000917: shop-created unlinked customer org is claimable (the bug)';
END $$;

\i web/supabase/migrations/20261015_000917_customer_org_atomic_founder_block.sql
\i web/supabase/migrations/20261015_000917_customer_org_atomic_founder_block.sql

-- 1) atomic create by a company_admin and by a service_manager
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
DO $$
DECLARE cid bigint;
BEGIN
  cid := public.create_shop_customer_org(1, '  Sunrise Clinic ', '1 Main', 'Mesa', 'AZ', '555', 'Candela GentleMAX', NULL);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = cid AND type = 'customer' AND name = 'Sunrise Clinic'
                 AND created_by = '00000000-0000-0000-0000-00000000000a' AND facility_type = 'Clinic') THEN
    RAISE EXCEPTION 'org row wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_customers WHERE service_organization_id = 1 AND customer_organization_id = cid) THEN
    RAISE EXCEPTION 'link missing';
  END IF;
  RAISE NOTICE 'ok   company_admin: org % and its link created together', cid;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
DO $$ BEGIN PERFORM public.create_shop_customer_org(1, 'Manager Clinic'); RAISE NOTICE 'ok   service_manager allowed'; END $$;

-- 2) not a manager: fse, removed user, other-org admin, supplier org
DO $$
DECLARE who text; org bigint; before bigint; after bigint;
BEGIN
  FOR who, org IN VALUES ('00000000-0000-0000-0000-00000000000c', 1::bigint),
                         ('00000000-0000-0000-0000-00000000000d', 1),
                         ('00000000-0000-0000-0000-00000000000a', 2) LOOP
    PERFORM set_config('request.jwt.claim.sub', who, true);
    SELECT count(*) INTO before FROM public.organizations;
    BEGIN
      PERFORM public.create_shop_customer_org(org, 'Nope Clinic');
      RAISE EXCEPTION 'should have been refused: % on %', who, org;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    SELECT count(*) INTO after FROM public.organizations;
    IF after <> before THEN RAISE EXCEPTION 'refused call left an org behind'; END IF;
  END LOOP;
  RAISE NOTICE 'ok   fse, removed user, and supplier-org caller refused with nothing written';
END $$;
RESET ROLE;

-- 3) a failed link rolls back the org
CREATE FUNCTION pg_temp.fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'simulated link failure'; END $$;
CREATE TRIGGER fail_link BEFORE INSERT ON public.organization_customers FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_link();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
DO $$
DECLARE before bigint; after bigint;
BEGIN
  SELECT count(*) INTO before FROM public.organizations;
  BEGIN
    PERFORM public.create_shop_customer_org(1, 'Doomed Clinic');
    RAISE EXCEPTION 'link failure did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO after FROM public.organizations;
  IF after <> before OR EXISTS (SELECT 1 FROM public.organizations WHERE name = 'Doomed Clinic') THEN
    RAISE EXCEPTION 'org survived a failed link';
  END IF;
  RAISE NOTICE 'ok   failed link: org rolled back (% orgs before and after)', after;
END $$;
RESET ROLE;
DROP TRIGGER fail_link ON public.organization_customers;

-- 4) founder claim on a shop-created customer org refused (RLS insert)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
    VALUES ('00000000-0000-0000-0000-00000000000c', 50, 'owner', true);
    RAISE EXCEPTION 'founder claim on shop-created org 50 was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok   founder claim on shop-created unlinked customer org refused';
END $$;
-- linked customer org (made by the RPC) refused too
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
DO $$
DECLARE cid bigint;
BEGIN
  SELECT id INTO cid FROM public.organizations WHERE name = 'Sunrise Clinic';
  IF public.membership_insert_allowed('00000000-0000-0000-0000-00000000000a', cid, 'owner', true) THEN
    RAISE EXCEPTION 'founder claim on linked customer org allowed';
  END IF;
  RAISE NOTICE 'ok   founder claim on linked customer org refused';
END $$;
RESET ROLE;

-- 5) a real clinic signup (creator in no shop) can still claim its new org,
--    and a shop admin can still found a new service company
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (60, 'Own Clinic', 'laser_clinic', '00000000-0000-0000-0000-00000000000e'),
  (61, 'Second Shop', 'service_company', '00000000-0000-0000-0000-00000000000a');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
VALUES ('00000000-0000-0000-0000-00000000000e', 60, 'owner', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
DO $$ BEGIN
  IF NOT public.membership_insert_allowed('00000000-0000-0000-0000-00000000000a', 61, 'company_admin', false) THEN
    RAISE EXCEPTION 'shop admin could not found a new service company';
  END IF;
  RAISE NOTICE 'ok   clinic signup founder claim and new service company founder still allowed';
END $$;
RESET ROLE;

-- 6) grants
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.create_shop_customer_org(bigint, text, text, text, text, text, text, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.org_founder_claim_allowed(bigint)', 'execute') THEN
    RAISE EXCEPTION 'grants too wide';
  END IF;
  RAISE NOTICE 'ok   grants: RPC authenticated only, claim helper service_role only';
END $$;

-- 7) rollback restores the exact live definition and drops the new functions
\i web/supabase/migrations/20261015_000917_customer_org_atomic_founder_block_rollback.sql
DO $$ BEGIN
  IF (SELECT md5(pg_get_functiondef('public.membership_insert_allowed(uuid,bigint,text,boolean)'::regprocedure)))
     <> (SELECT h FROM live_defs) THEN
    RAISE EXCEPTION 'rollback did not restore the live membership_insert_allowed';
  END IF;
  IF to_regprocedure('public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)') IS NOT NULL
     OR to_regprocedure('public.org_founder_claim_allowed(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback left new functions';
  END IF;
  RAISE NOTICE 'ok   rollback: live membership_insert_allowed restored byte for byte, new functions gone';
END $$;

ROLLBACK;
