-- Local proof for 20261016_000919_customer_org_claim_served_or_shop_created.sql
-- and its rollback. Empty Postgres only (never production). Refuses to run
-- when public.organizations already exists. One transaction, ends in ROLLBACK.
--
--   createdb customer_claim_proof
--   psql "postgresql:///customer_claim_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261016_customer_org_claim_served_or_shop_created.sql
--
-- Run psql from the repo root so the \i paths resolve.
-- Fixture: the 000917 proof's tables and live function definitions, then
-- 000917 itself (live on prod). Its bodies are checked against the live
-- pg_get_functiondef md5s read on 2026-10-16. service_reports and
-- service_tickets carry the live customer_organization_id column.
-- Org ids are small local fixtures only (no real prod org ids).

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

CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint REFERENCES public.organizations(id),
  customer_organization_id bigint REFERENCES public.organizations(id),
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.service_tickets (
  id bigserial PRIMARY KEY,
  organization_id bigint REFERENCES public.organizations(id),
  customer_organization_id bigint REFERENCES public.organizations(id),
  created_at timestamptz DEFAULT now()
);

\i web/supabase/migrations/20261015_000917_customer_org_atomic_founder_block.sql

-- Fixture = prod: the 000917 bodies match the live md5s (2026-10-16).
CREATE TEMP TABLE live_defs (proname text PRIMARY KEY, h text);
INSERT INTO live_defs VALUES
  ('org_founder_claim_allowed', 'd95cbd71c81a2c9bb82765125d4b07e1'),
  ('create_shop_customer_org', 'd7777fb92d511d9c61f224bebf4cc4f8'),
  ('membership_insert_allowed', '4089a1ae42099fe66583365fee7ab31a');
CREATE FUNCTION pg_temp.defs_differ() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(l.proname, ', ' ORDER BY l.proname)
  FROM live_defs l
  LEFT JOIN pg_proc p ON p.proname = l.proname AND p.pronamespace = 'public'::regnamespace
  WHERE p.oid IS NULL OR md5(pg_get_functiondef(p.oid)) <> l.h
$$;
DO $$ BEGIN
  IF pg_temp.defs_differ() IS NOT NULL THEN
    RAISE EXCEPTION 'fixture differs from prod: %', pg_temp.defs_differ();
  END IF;
  RAISE NOTICE 'ok   fixture: org_founder_claim_allowed, create_shop_customer_org, membership_insert_allowed = live md5';
END $$;

-- Users: shop 1 admin A, techs F (the attacker) and G; clinic founder E and
-- X, never in a shop.
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000f', 'f@test'),
  ('00000000-0000-0000-0000-000000000006', 'g@test'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test'),
  ('00000000-0000-0000-0000-000000000009', 'x@test');
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (1, 'Shop One', 'service_company', NULL);
SELECT setval('public.organizations_id_seq', 100);
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-00000000000a', 1, 'company_admin', true),
  ('00000000-0000-0000-0000-00000000000f', 1, 'fse', true),
  ('00000000-0000-0000-0000-000000000006', 1, 'fse', true);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;

-- The exploit. F, a current shop tech, inserts a customer org from the browser
-- with no link (old ensureCustomerOrg), leaves the shop (POST /api/org/leave:
-- service role deletes the membership), then self-inserts the founder 'owner'
-- membership (the RLS path; /api/org/founder mirrors it). True = claimed.
CREATE FUNCTION pg_temp.leave_then_claim(p_org bigint, p_name text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE claimed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  SELECT '00000000-0000-0000-0000-00000000000f', 1, 'fse', true
  WHERE NOT EXISTS (SELECT 1 FROM public.organization_memberships
                    WHERE user_id = '00000000-0000-0000-0000-00000000000f' AND organization_id = 1);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.organizations (id, name, type) VALUES (p_org, p_name, 'customer');
  RESET ROLE;
  DELETE FROM public.organization_memberships
  WHERE user_id = '00000000-0000-0000-0000-00000000000f' AND organization_id = 1;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
    VALUES ('00000000-0000-0000-0000-00000000000f', p_org, 'owner', true);
    claimed := true;
  EXCEPTION WHEN insufficient_privilege THEN
    claimed := false;
  END;
  RESET ROLE;
  RETURN claimed;
END $$;

-- Before 000919 (= prod today): the exploit works.
DO $$ BEGIN
  IF NOT pg_temp.leave_then_claim(50, 'Exploit Clinic Before') THEN
    RAISE EXCEPTION 'precondition: on 000917 the leave-then-claim exploit should succeed';
  END IF;
  RAISE NOTICE 'ok   before 000919: shop tech creates unlinked clinic, leaves, claims owner (the bug)';
END $$;
DELETE FROM public.organization_memberships WHERE organization_id = 50;

\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql
\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql

-- 1) leave-then-claim refused
DO $$ BEGIN
  IF pg_temp.leave_then_claim(51, 'Exploit Clinic After') THEN
    RAISE EXCEPTION 'leave-then-claim exploit still works';
  END IF;
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 51) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'org 51 not stamped with shop 1';
  END IF;
  IF public.org_founder_claim_allowed(51) THEN
    RAISE EXCEPTION 'org_founder_claim_allowed(51) true after leave';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_memberships WHERE organization_id = 51) THEN
    RAISE EXCEPTION 'refused claim left a membership';
  END IF;
  RAISE NOTICE 'ok   leave-then-claim refused: org stamped creator_shop_org_id = 1, no membership written';
END $$;

-- 2) legit clinic self-signup (creator never in a shop) still claimable
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
INSERT INTO public.organizations (id, name, type) VALUES (60, 'Own Clinic', 'laser_clinic');
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
VALUES ('00000000-0000-0000-0000-00000000000e', 60, 'owner', true);
RESET ROLE;
DO $$ BEGIN
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 60) IS NOT NULL THEN
    RAISE EXCEPTION 'clinic self-signup got a shop stamp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_memberships WHERE organization_id = 60 AND role = 'owner') THEN
    RAISE EXCEPTION 'clinic self-signup founder claim failed';
  END IF;
  RAISE NOTICE 'ok   clinic self-signup: no stamp, founder owner claim still allowed';
END $$;

-- 3) unlinked, memberless, creator never in a shop, but already served: refused
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', true);
INSERT INTO public.organizations (id, name, type) VALUES (70, 'Served Clinic', 'customer'), (71, 'Ticketed Clinic', 'customer');
RESET ROLE;
INSERT INTO public.service_reports (organization_id, customer_organization_id) VALUES (1, 70);
INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (1, 71);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', true);
DO $$
DECLARE o bigint;
BEGIN
  FOREACH o IN ARRAY ARRAY[70, 71]::bigint[] LOOP
    BEGIN
      INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
      VALUES ('00000000-0000-0000-0000-000000000009', o, 'owner', true);
      RAISE EXCEPTION 'served org % was claimable', o;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'ok   unlinked but served org refused (service_reports -> 70, service_tickets -> 71)';
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 70) IS NOT NULL
     OR NOT public.org_unclaimed_new(70, (SELECT created_at FROM public.organizations WHERE id = 70)) THEN
    RAISE EXCEPTION 'precondition: 70 must be unstamped and otherwise unclaimed';
  END IF;
  DELETE FROM public.service_reports WHERE customer_organization_id = 70;
  IF NOT public.org_founder_claim_allowed(70) THEN
    RAISE EXCEPTION 'unserved 70 should be claimable';
  END IF;
  RAISE NOTICE 'ok   the same org without the report is claimable (served was the only reason)';
END $$;

-- 4) stamp: trigger only; client value ignored; client update refused; type flip keeps it
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
INSERT INTO public.organizations (id, name, type, creator_shop_org_id) VALUES (80, 'Flip Org', 'service_company', NULL);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
INSERT INTO public.organizations (id, name, type, creator_shop_org_id) VALUES (81, 'Forged Clinic', 'laser_clinic', 1);
RESET ROLE;
DO $$ BEGIN
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 80) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'non-customer org by shop member not stamped';
  END IF;
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 81) IS NOT NULL THEN
    RAISE EXCEPTION 'client-supplied stamp was kept';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
DO $$ BEGIN
  BEGIN
    UPDATE public.organizations SET creator_shop_org_id = NULL WHERE id = 80;
    RAISE EXCEPTION 'client cleared the stamp';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.organizations SET type = 'customer' WHERE id = 80;
END $$;
RESET ROLE;
DELETE FROM public.organization_memberships
WHERE user_id = '00000000-0000-0000-0000-000000000006' AND organization_id = 1;
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.organizations SET creator_shop_org_id = NULL WHERE id = 81;
DO $$ BEGIN
  IF public.org_founder_claim_allowed(80) THEN
    RAISE EXCEPTION 'type-flipped shop-created org claimable after leave';
  END IF;
  RAISE NOTICE 'ok   stamp: set by trigger only, client value ignored, client update refused, survives a type flip; service role may correct';
END $$;

-- 5) RPC: any current shop member (a tech too), atomic; non-member refused
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
VALUES ('00000000-0000-0000-0000-000000000006', 1, 'fse', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
DO $$
DECLARE cid bigint; before bigint;
BEGIN
  cid := public.create_shop_customer_org(1, ' Tech Clinic ', NULL, 'Mesa', 'AZ', NULL, NULL, NULL);
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = cid AND name = 'Tech Clinic' AND type = 'customer'
                 AND creator_shop_org_id = 1)
     OR NOT EXISTS (SELECT 1 FROM public.organization_customers WHERE service_organization_id = 1 AND customer_organization_id = cid) THEN
    RAISE EXCEPTION 'tech RPC create wrong';
  END IF;
  SELECT count(*) INTO before FROM public.organizations;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', true);
  BEGIN
    PERFORM public.create_shop_customer_org(1, 'Nope Clinic');
    RAISE EXCEPTION 'non-member allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
  BEGIN
    PERFORM public.create_shop_customer_org(60, 'Clinic-as-shop');
    RAISE EXCEPTION 'clinic owner allowed on a non-service org';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.organizations) <> before THEN RAISE EXCEPTION 'refused call wrote an org'; END IF;
  RAISE NOTICE 'ok   RPC: technician creates org + link (stamped); non-member and clinic org refused, nothing written';
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'simulated link failure'; END $$;
CREATE TRIGGER fail_link BEFORE INSERT ON public.organization_customers FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_link();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
DO $$
DECLARE before bigint;
BEGIN
  SELECT count(*) INTO before FROM public.organizations;
  BEGIN
    PERFORM public.create_shop_customer_org(1, 'Doomed Clinic');
    RAISE EXCEPTION 'link failure did not raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'simulated link failure' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.organizations) <> before THEN RAISE EXCEPTION 'org survived a failed link'; END IF;
  RAISE NOTICE 'ok   failed link rolls back the org';
END $$;
RESET ROLE;
DROP TRIGGER fail_link ON public.organization_customers;

-- 6) unchanged: a shop admin can still found a new service company
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
INSERT INTO public.organizations (id, name, type) VALUES (90, 'Second Shop', 'service_company');
DO $$ BEGIN
  IF NOT public.membership_insert_allowed('00000000-0000-0000-0000-00000000000a', 90, 'company_admin', false) THEN
    RAISE EXCEPTION 'shop admin could not found a new service company';
  END IF;
  RAISE NOTICE 'ok   new service company founder still allowed';
END $$;
RESET ROLE;

-- 7) grants, SECURITY DEFINER, search_path ''
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.create_shop_customer_org(bigint, text, text, text, text, text, text, text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.create_shop_customer_org(bigint, text, text, text, text, text, text, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.org_founder_claim_allowed(bigint)', 'execute')
     OR has_function_privilege('authenticated', 'public.stamp_org_creator_shop()', 'execute') THEN
    RAISE EXCEPTION 'grants wrong';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid IN ('public.stamp_org_creator_shop()'::regprocedure,
                  'public.org_founder_claim_allowed(bigint)'::regprocedure,
                  'public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)'::regprocedure)
      AND NOT (prosecdef AND proconfig = ARRAY['search_path=""'])
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER / search_path wrong';
  END IF;
  IF pg_temp.defs_differ() <> 'create_shop_customer_org, org_founder_claim_allowed' THEN
    RAISE EXCEPTION 'membership_insert_allowed should be unchanged by 000919 (differ: %)', pg_temp.defs_differ();
  END IF;
  RAISE NOTICE 'ok   grants; SECURITY DEFINER with empty search_path; membership_insert_allowed unchanged';
END $$;

-- 8) rollback restores the live 000917 bodies byte for byte, drops 000919 objects
\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created_rollback.sql
DO $$ BEGIN
  IF pg_temp.defs_differ() IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not restore live: %', pg_temp.defs_differ();
  END IF;
  IF to_regprocedure('public.stamp_org_creator_shop()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_stamp_org_creator_shop')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'organizations' AND column_name = 'creator_shop_org_id') THEN
    RAISE EXCEPTION 'rollback left 000919 objects';
  END IF;
  RAISE NOTICE 'ok   rollback: live 000917 functions restored byte for byte; trigger, function, column gone';
END $$;

ROLLBACK;
