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
-- 000910 and 000917 themselves (both live on prod), the live organizations
-- RLS policies (insert / select / update / delete, prod names) and the live
-- org_creator_access / is_active_org_member. Bodies are checked against the
-- live pg_get_functiondef md5s read on 2026-10-16/17. service_reports and
-- service_tickets carry the live customer_organization_id column.
-- Org ids are small local fixtures only (no real prod org ids).
-- Rev 2 adds QA #309's attacks: type flip (H1), creator access on stamped or
-- served orgs and direct customer inserts by shop members (M1), unlinked
-- customers on tickets/reports (L1), RPC caps and rate limit (L2).

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
CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = org_id
    );
$function$;
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

-- Live organizations policies (pg_policies, 2026-10-17; the directory and
-- storefront SELECT policies are left out: they read columns not in this fixture).
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can insert organizations" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (((created_by = auth.uid()) OR (created_by IS NULL)));
CREATE POLICY organizations_insert_customers ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (((type = 'customer'::text) AND (created_by = auth.uid())));
CREATE POLICY organizations_insert_self ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (((created_by IS NULL) OR (created_by = auth.uid())));
CREATE POLICY organizations_member_select ON public.organizations
  FOR SELECT TO authenticated USING ((public.auth_member_of_org(id) OR public.org_creator_access(id, created_by, created_at)));
CREATE POLICY "Users can update their own organizations" ON public.organizations
  FOR UPDATE TO authenticated USING (public.org_creator_access(id, created_by, created_at));
CREATE POLICY "Users can delete their own organizations" ON public.organizations
  FOR DELETE TO authenticated USING (public.org_creator_access(id, created_by, created_at));

CREATE TABLE public.service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint REFERENCES public.organizations(id),
  customer_organization_id bigint REFERENCES public.organizations(id),
  created_by uuid,
  title text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.service_tickets (
  id bigserial PRIMARY KEY,
  organization_id bigint REFERENCES public.organizations(id),
  customer_organization_id bigint REFERENCES public.organizations(id),
  status text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.service_reports, public.service_tickets TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

\i web/supabase/migrations/20261010_000910_document_send_rate_limit.sql
\i web/supabase/migrations/20261015_000917_customer_org_atomic_founder_block.sql

-- Fixture = prod: these bodies match the live md5s (2026-10-16/17).
CREATE TEMP TABLE live_defs (proname text PRIMARY KEY, h text);
INSERT INTO live_defs VALUES
  ('org_founder_claim_allowed', 'd95cbd71c81a2c9bb82765125d4b07e1'),
  ('create_shop_customer_org', 'd7777fb92d511d9c61f224bebf4cc4f8'),
  ('membership_insert_allowed', '4089a1ae42099fe66583365fee7ab31a'),
  ('organizations_guard_privilege', '892f169b59b5520fbc5a16942e69c0d0'),
  ('org_creator_access', 'e11e29dc4dc12c7669afdce19032480b');
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
  RAISE NOTICE 'ok   fixture: 5 functions = live md5';
END $$;
CREATE TEMP TABLE live_policy AS
  SELECT policyname, permissive, cmd, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations';
CREATE TEMP TABLE live_check AS
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conname = 'document_send_slots_document_type_check';

-- Users: shop 1 admin A, techs F (the attacker) and G; clinic founder E and
-- X, never in a shop. Shop 2 tech B (another shop).
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000f', 'f@test'),
  ('00000000-0000-0000-0000-000000000006', 'g@test'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test'),
  ('00000000-0000-0000-0000-000000000009', 'x@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test');
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (1, 'Shop One', 'service_company', NULL),
  (2, 'Shop Two', 'service_company', NULL);
SELECT setval('public.organizations_id_seq', 100);
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES
  ('00000000-0000-0000-0000-00000000000a', 1, 'company_admin', true),
  ('00000000-0000-0000-0000-00000000000f', 1, 'fse', true),
  ('00000000-0000-0000-0000-000000000006', 1, 'fse', true),
  ('00000000-0000-0000-0000-00000000000b', 2, 'fse', true);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;

-- Run p_sql as user p_uid (role authenticated); 'ok' or 'ERR <sqlstate>'.
CREATE FUNCTION pg_temp.as_user(p_uid text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    IF p_sql ~* '^\s*(select|with)\M' OR p_sql ~* '\mreturning\M' THEN
      EXECUTE p_sql INTO r;
    ELSE
      EXECUTE p_sql;
    END IF;
    r := 'ok' || coalesce(' ' || r, '');
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.expect(p_label text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION '%: got %, want %', p_label, p_got, p_want;
  END IF;
END $$;

-- The original exploit. F, a current shop tech, inserts a customer org from
-- the browser with no link (old ensureCustomerOrg), leaves the shop (POST
-- /api/org/leave: service role deletes the membership), then self-inserts the
-- founder 'owner' membership (the RLS path; /api/org/founder mirrors it).
CREATE FUNCTION pg_temp.leave_then_claim(p_org bigint, p_name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  SELECT '00000000-0000-0000-0000-00000000000f', 1, 'fse', true
  WHERE NOT EXISTS (SELECT 1 FROM public.organization_memberships
                    WHERE user_id = '00000000-0000-0000-0000-00000000000f' AND organization_id = 1);
  r := pg_temp.as_user('00000000-0000-0000-0000-00000000000f',
    format($q$INSERT INTO public.organizations (id, name, type) VALUES (%s, %L, 'customer')$q$, p_org, p_name));
  IF r <> 'ok' THEN RETURN 'insert refused ' || r; END IF;
  DELETE FROM public.organization_memberships
  WHERE user_id = '00000000-0000-0000-0000-00000000000f' AND organization_id = 1;
  r := pg_temp.as_user('00000000-0000-0000-0000-00000000000f',
    format($q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
              VALUES ('00000000-0000-0000-0000-00000000000f', %s, 'owner', true)$q$, p_org));
  RETURN CASE WHEN r = 'ok' THEN 'claimed' ELSE 'claim refused ' || r END;
END $$;

-- Before 000919 (= prod today): the exploit works, and so does the type flip.
DO $$ BEGIN
  PERFORM pg_temp.expect('before: leave-then-claim', pg_temp.leave_then_claim(50, 'Exploit Clinic Before'), 'claimed');
  RAISE NOTICE 'ok   before 000919: shop tech creates unlinked clinic, leaves, claims owner (the bug)';
END $$;
DELETE FROM public.organization_memberships WHERE organization_id = 50;

\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql
\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created.sql

-- 1) M1: a current shop member can't insert a customer-side org directly
DO $$
DECLARE t text;
BEGIN
  PERFORM pg_temp.expect('leave-then-claim', pg_temp.leave_then_claim(51, 'Exploit Clinic After'), 'insert refused ERR 42501');
  FOREACH t IN ARRAY ARRAY['customer', 'laser_clinic', 'laser_rental', 'laser_reseller', ' Customer '] LOOP
    PERFORM pg_temp.expect('shop member direct insert ' || t,
      pg_temp.as_user('00000000-0000-0000-0000-000000000006',
        format($q$INSERT INTO public.organizations (name, type) VALUES ('Direct', %L)$q$, t)), 'ERR 42501');
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = 51 OR name = 'Direct') THEN
    RAISE EXCEPTION 'refused insert wrote a row';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'organizations' AND policyname = 'organizations_insert_customers') THEN
    RAISE EXCEPTION 'organizations_insert_customers still there';
  END IF;
  RAISE NOTICE 'ok   shop members: every customer-side direct insert refused (42501); organizations_insert_customers dropped';
END $$;

-- 2) legit clinic self-signup (creator never in a shop): the onboarding
--    sequence insert -> select -> no-op type re-save -> owner membership
DO $$ BEGIN
  PERFORM pg_temp.expect('self-signup insert', pg_temp.as_user('00000000-0000-0000-0000-00000000000e',
    $q$INSERT INTO public.organizations (id, name, type, created_by) VALUES (60, 'Own Clinic', 'laser_clinic', '00000000-0000-0000-0000-00000000000e') RETURNING id::text$q$), 'ok 60');
  PERFORM pg_temp.expect('self-signup customer type', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$INSERT INTO public.organizations (id, name, type) VALUES (61, 'X Clinic', 'customer') RETURNING id::text$q$), 'ok 61');
  PERFORM pg_temp.expect('self-signup re-save same type', pg_temp.as_user('00000000-0000-0000-0000-00000000000e',
    $q$WITH u AS (UPDATE public.organizations SET name = 'Own Clinic LLC', type = 'laser_clinic' WHERE id = 60 RETURNING 1) SELECT count(*)::text FROM u$q$), 'ok 1');
  PERFORM pg_temp.expect('self-signup owner claim', pg_temp.as_user('00000000-0000-0000-0000-00000000000e',
    $q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-00000000000e', 60, 'owner', true) RETURNING organization_id::text$q$), 'ok 60');
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 60) IS NOT NULL THEN
    RAISE EXCEPTION 'clinic self-signup got a shop stamp';
  END IF;
  RAISE NOTICE 'ok   clinic self-signup: insert, read back, same-type re-save, owner claim; no stamp';
END $$;

-- 3) unlinked, memberless, creator never in a shop, but already served:
--    claim refused, and the creator's 24h access is gone too (M1)
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (70, 'Served Clinic', 'customer', '00000000-0000-0000-0000-000000000009'),
  (71, 'Ticketed Clinic', 'customer', '00000000-0000-0000-0000-000000000009'),
  (72, 'Fresh Clinic', 'customer', '00000000-0000-0000-0000-000000000009');
INSERT INTO public.service_reports (organization_id, customer_organization_id, title) VALUES (1, 70, 'served');
INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (1, 71);
DO $$
DECLARE o bigint;
BEGIN
  FOREACH o IN ARRAY ARRAY[70, 71]::bigint[] LOOP
    PERFORM pg_temp.expect('served claim ' || o, pg_temp.as_user('00000000-0000-0000-0000-000000000009',
      format($q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-000000000009', %s, 'owner', true)$q$, o)), 'ERR 42501');
    PERFORM pg_temp.expect('served creator read ' || o, pg_temp.as_user('00000000-0000-0000-0000-000000000009',
      format($q$SELECT count(*)::text FROM public.organizations WHERE id = %s$q$, o)), 'ok 0');
    PERFORM pg_temp.expect('served creator update ' || o, pg_temp.as_user('00000000-0000-0000-0000-000000000009',
      format($q$WITH u AS (UPDATE public.organizations SET city = 'x' WHERE id = %s RETURNING 1) SELECT count(*)::text FROM u$q$, o)), 'ok 0');
  END LOOP;
  PERFORM pg_temp.expect('unserved creator read', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$SELECT count(*)::text FROM public.organizations WHERE id = 72$q$), 'ok 1');
  IF NOT public.org_founder_claim_allowed(72) THEN RAISE EXCEPTION 'unserved 72 should be claimable'; END IF;
  RAISE NOTICE 'ok   served (report -> 70, ticket -> 71): claim refused, creator read/update gone; unserved 72 unchanged';
END $$;

-- 4) H1: type is fixed for clients; stamp and served checks hold for any type
DO $$ BEGIN
  -- G (shop member) founds a second service company: not stamped, claimable.
  PERFORM pg_temp.expect('shop member founds a shop', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$INSERT INTO public.organizations (id, name, type) VALUES (80, 'G Shop', 'service_company') RETURNING id::text$q$), 'ok 80');
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 80) IS NOT NULL THEN
    RAISE EXCEPTION 'service company founded by a shop member was stamped';
  END IF;
  PERFORM pg_temp.expect('shop member claims own new shop', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-000000000006', 80, 'company_admin', false) RETURNING organization_id::text$q$), 'ok 80');
  -- E's own clinic 81, with a forged stamp: the trigger ignores it.
  PERFORM pg_temp.expect('forged stamp insert', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$INSERT INTO public.organizations (id, name, type, creator_shop_org_id) VALUES (81, 'Flip Clinic', 'customer', 1) RETURNING coalesce(creator_shop_org_id::text, 'unstamped')$q$), 'ok unstamped');
  -- Type flips by the creator (who has update access) are refused both ways.
  PERFORM pg_temp.expect('flip clinic -> service_company', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$UPDATE public.organizations SET type = 'service_company' WHERE id = 81$q$), 'ERR 42501');
  PERFORM pg_temp.expect('flip shop -> customer', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$UPDATE public.organizations SET type = 'customer' WHERE id = 80$q$), 'ERR 42501');
  PERFORM pg_temp.expect('flip to null', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$UPDATE public.organizations SET type = NULL WHERE id = 81$q$), 'ERR 42501');
  PERFORM pg_temp.expect('client stamp update', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$UPDATE public.organizations SET creator_shop_org_id = 1 WHERE id = 81$q$), 'ERR 42501');
  IF (SELECT type FROM public.organizations WHERE id = 81) <> 'customer' OR (SELECT type FROM public.organizations WHERE id = 80) <> 'service_company' THEN
    RAISE EXCEPTION 'a refused flip changed the type';
  END IF;
  RAISE NOTICE 'ok   H1: shop member founds + claims own shop (unstamped); client stamp ignored; client type changes refused (42501) both ways and to NULL; same-type re-save passes (section 2)';
END $$;
-- The service role may change type and correct a stamp (auth.uid() null).
-- A stamped org of ANY type, and a served org of any type, is not claimable.
UPDATE public.organizations SET type = 'laser_clinic' WHERE id = 81;
INSERT INTO public.organizations (id, name, type, created_by) VALUES
  (82, 'Stamped Then Shop', 'customer', '00000000-0000-0000-0000-000000000006'),
  (83, 'Served Shop', 'service_company', '00000000-0000-0000-0000-000000000009');
DELETE FROM public.organization_memberships
WHERE user_id = '00000000-0000-0000-0000-000000000006' AND organization_id = 1;
UPDATE public.organizations SET type = 'service_company' WHERE id = 82;
INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (1, 83);
DO $$ BEGIN
  IF (SELECT type FROM public.organizations WHERE id = 81) <> 'laser_clinic' THEN
    RAISE EXCEPTION 'service role type change refused';
  END IF;
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 82) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '82 should be stamped (customer insert by a shop member, service role)';
  END IF;
  IF public.org_founder_claim_allowed(82) THEN
    RAISE EXCEPTION 'stamped org claimable as service_company (the QA H1 end state)';
  END IF;
  PERFORM pg_temp.expect('H1 end state: company_admin claim of stamped 82', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-000000000006', 82, 'company_admin', true)$q$), 'ERR 42501');
  PERFORM pg_temp.expect('served service_company claim', pg_temp.as_user('00000000-0000-0000-0000-000000000009',
    $q$INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home) VALUES ('00000000-0000-0000-0000-000000000009', 83, 'company_admin', true)$q$), 'ERR 42501');
  PERFORM pg_temp.expect('stamped creator read after leave', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT count(*)::text FROM public.organizations WHERE id = 82$q$), 'ok 0');
  RAISE NOTICE 'ok   any type: stamped (82) and served (83) refused; service role may change type; stamped creator access gone';
END $$;
SELECT set_config('request.jwt.claim.sub', '', true);
UPDATE public.organizations SET creator_shop_org_id = NULL WHERE id = 82;
DO $$ BEGIN
  IF (SELECT creator_shop_org_id FROM public.organizations WHERE id = 82) IS NOT NULL THEN
    RAISE EXCEPTION 'service role could not correct the stamp';
  END IF;
  RAISE NOTICE 'ok   stamp: service role may correct it';
END $$;
INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
VALUES ('00000000-0000-0000-0000-000000000006', 1, 'fse', true);

-- 5) RPC: any current shop member (a tech too), atomic; non-member refused
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
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE name IN ('Nope Clinic', 'Clinic-as-shop')) THEN
    RAISE EXCEPTION 'refused call wrote an org';
  END IF;
  RAISE NOTICE 'ok   RPC: technician creates org + link (stamped); non-member and clinic org refused, nothing written';
END $$;
CREATE FUNCTION pg_temp.fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'simulated link failure'; END $$;
CREATE TRIGGER fail_link BEFORE INSERT ON public.organization_customers FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_link();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', true);
DO $$
DECLARE before bigint; slots bigint;
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

-- 5b) L2: caps and 30 creates per user per hour
DO $$
DECLARE i int; r text; n int;
BEGIN
  PERFORM pg_temp.expect('100k name', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT public.create_shop_customer_org(1, repeat('A', 100000))::text$q$), 'ERR 22001');
  PERFORM pg_temp.expect('201-char name', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT public.create_shop_customer_org(1, repeat('A', 201))::text$q$), 'ERR 22001');
  PERFORM pg_temp.expect('long phone', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT public.create_shop_customer_org(1, 'Ok', NULL, NULL, NULL, repeat('5', 51))::text$q$), 'ERR 22001');
  r := pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT (public.create_shop_customer_org(1, repeat('A', 200), repeat('b', 500), repeat('c', 100), repeat('d', 100), repeat('5', 50), repeat('m', 1000), repeat('f', 100)) > 0)::text$q$);
  PERFORM pg_temp.expect('max-length fields', r, 'ok true');
  -- G has 2 creates this hour (Tech Clinic, max-length); 28 more pass, the 31st is refused.
  FOR i IN 1..28 LOOP
    PERFORM pg_temp.expect('create ' || i, pg_temp.as_user('00000000-0000-0000-0000-000000000006',
      format($q$SELECT (public.create_shop_customer_org(1, 'Bulk %s') > 0)::text$q$, i)), 'ok true');
  END LOOP;
  PERFORM pg_temp.expect('31st create', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT public.create_shop_customer_org(1, 'One Too Many')::text$q$), 'ERR PT429');
  PERFORM pg_temp.expect('500 in one call', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    $q$SELECT count(public.create_shop_customer_org(1, 'spam ' || g))::text FROM generate_series(1, 500) g$q$), 'ERR PT429');
  IF EXISTS (SELECT 1 FROM public.organizations WHERE name LIKE 'spam %' OR name = 'One Too Many') THEN
    RAISE EXCEPTION 'refused creates wrote orgs';
  END IF;
  -- A (other user) is not affected by G's cap.
  PERFORM pg_temp.expect('other user', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    $q$SELECT (public.create_shop_customer_org(1, 'Admin Clinic') > 0)::text$q$), 'ok true');
  -- Slots are keyed per user, so shop 1's document email cap is untouched.
  SELECT count(*) INTO n FROM public.document_send_slots WHERE document_type = 'customer_org';
  IF n <> 31 THEN RAISE EXCEPTION 'expected 31 customer_org slots, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM public.document_send_slots WHERE document_type = 'customer_org' AND organization_id NOT LIKE 'customer_org:user:%') THEN
    RAISE EXCEPTION 'customer_org slot keyed by a shop id';
  END IF;
  IF (public.take_document_send_slot('1', 'invoice', '7')->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'customer creates consumed the shop document cap';
  END IF;
  -- Slots older than an hour don't count.
  UPDATE public.document_send_slots SET taken_at = taken_at - interval '61 minutes'
  WHERE organization_id = 'customer_org:user:00000000-0000-0000-0000-000000000006';
  PERFORM pg_temp.expect('after the hour', pg_temp.as_user('00000000-0000-0000-0000-000000000006',
    $q$SELECT (public.create_shop_customer_org(1, 'Next Hour') > 0)::text$q$), 'ok true');
  RAISE NOTICE 'ok   L2: caps (22001), 30/user/hour (PT429, 500-in-one-call refused, nothing written), per user, separate from document cap, sliding';
END $$;

-- 6) unchanged: a shop admin can still found a new service company
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
INSERT INTO public.organizations (id, name, type) VALUES (90, 'Second Shop', 'service_company');
DO $$ BEGIN
  IF NOT public.membership_insert_allowed('00000000-0000-0000-0000-00000000000a', 90, 'company_admin', false) THEN
    RAISE EXCEPTION 'shop admin could not found a new service company';
  END IF;
  RAISE NOTICE 'ok   new service company founder still allowed (shop member, unstamped)';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

-- 6b) L1: tickets and reports name only a linked customer
DO $$
DECLARE cid bigint;
BEGIN
  SELECT customer_organization_id INTO cid FROM public.organization_customers
  WHERE service_organization_id = 1 ORDER BY id LIMIT 1;
  PERFORM pg_temp.expect('linked ticket', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    format($q$INSERT INTO public.service_tickets (organization_id, customer_organization_id, status) VALUES (1, %s, 'new') RETURNING 'x'$q$, cid)), 'ok x');
  PERFORM pg_temp.expect('linked report', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    format($q$INSERT INTO public.service_reports (organization_id, customer_organization_id, title) VALUES (1, %s, 'mine') RETURNING 'x'$q$, cid)), 'ok x');
  PERFORM pg_temp.expect('unlinked ticket (griefing)', pg_temp.as_user('00000000-0000-0000-0000-00000000000b',
    $q$INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (2, 72)$q$), 'ERR 42501');
  PERFORM pg_temp.expect('foreign shop customer report (injection)', pg_temp.as_user('00000000-0000-0000-0000-00000000000b',
    format($q$INSERT INTO public.service_reports (organization_id, customer_organization_id, title) VALUES (2, %s, 'INJECTED')$q$, cid)), 'ERR 42501');
  PERFORM pg_temp.expect('shop names itself', pg_temp.as_user('00000000-0000-0000-0000-00000000000b',
    $q$INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (2, 2)$q$), 'ERR 42501');
  PERFORM pg_temp.expect('repoint to unlinked', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    $q$UPDATE public.service_tickets SET customer_organization_id = 72 WHERE status = 'new'$q$), 'ERR 42501');
  PERFORM pg_temp.expect('status update on a linked row', pg_temp.as_user('00000000-0000-0000-0000-00000000000a',
    $q$WITH u AS (UPDATE public.service_tickets SET status = 'done', customer_organization_id = customer_organization_id WHERE status = 'new' RETURNING 1) SELECT count(*)::text FROM u$q$), 'ok 1');
  PERFORM pg_temp.expect('no-shop report naming own clinic', pg_temp.as_user('00000000-0000-0000-0000-00000000000e',
    $q$INSERT INTO public.service_reports (organization_id, customer_organization_id, title) VALUES (NULL, 60, 'own') RETURNING 'x'$q$), 'ok x');
  PERFORM pg_temp.expect('no-shop report naming another clinic', pg_temp.as_user('00000000-0000-0000-0000-00000000000e',
    $q$INSERT INTO public.service_reports (organization_id, customer_organization_id, title) VALUES (NULL, 72, 'x')$q$), 'ERR 42501');
  PERFORM pg_temp.expect('no customer', pg_temp.as_user('00000000-0000-0000-0000-00000000000b',
    $q$INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (2, NULL) RETURNING 'x'$q$), 'ok x');
  -- The service role (estimate approval, imports) is not checked.
  INSERT INTO public.service_tickets (organization_id, customer_organization_id) VALUES (NULL, 72);
  IF NOT public.org_founder_claim_allowed(61) THEN RAISE EXCEPTION '61 should still be claimable (no ticket landed on it)'; END IF;
  RAISE NOTICE 'ok   L1: linked ticket/report ok; unlinked, foreign, self and repointed refused (42501); status update ok; own-clinic no-shop report ok; service role unchecked';
END $$;

-- 7) grants, SECURITY DEFINER, search_path ''
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.create_shop_customer_org(bigint, text, text, text, text, text, text, text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.create_shop_customer_org(bigint, text, text, text, text, text, text, text)', 'execute')
     OR has_function_privilege('authenticated', 'public.org_founder_claim_allowed(bigint)', 'execute')
     OR has_function_privilege('authenticated', 'public.stamp_org_creator_shop()', 'execute')
     OR has_function_privilege('authenticated', 'public.guard_service_customer_org()', 'execute')
     OR has_function_privilege('anon', 'public.caller_in_service_company()', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.caller_in_service_company()', 'execute') THEN
    RAISE EXCEPTION 'grants wrong';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid IN ('public.stamp_org_creator_shop()'::regprocedure,
                  'public.org_founder_claim_allowed(bigint)'::regprocedure,
                  'public.create_shop_customer_org(bigint,text,text,text,text,text,text,text)'::regprocedure,
                  'public.organizations_guard_privilege()'::regprocedure,
                  'public.org_creator_access(bigint,uuid,timestamptz)'::regprocedure,
                  'public.caller_in_service_company()'::regprocedure,
                  'public.guard_service_customer_org()'::regprocedure)
      AND NOT (prosecdef AND proconfig = ARRAY['search_path=""'])
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER / search_path wrong';
  END IF;
  IF pg_temp.defs_differ() <> 'create_shop_customer_org, org_creator_access, org_founder_claim_allowed, organizations_guard_privilege' THEN
    RAISE EXCEPTION 'unexpected changed set (membership_insert_allowed must be unchanged): %', pg_temp.defs_differ();
  END IF;
  RAISE NOTICE 'ok   grants; SECURITY DEFINER with empty search_path; membership_insert_allowed unchanged';
END $$;

-- 8) rollback restores the live bodies byte for byte, drops 000919 objects
\i web/supabase/migrations/20261016_000919_customer_org_claim_served_or_shop_created_rollback.sql
DO $$ BEGIN
  IF pg_temp.defs_differ() IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not restore live: %', pg_temp.defs_differ();
  END IF;
  IF to_regprocedure('public.stamp_org_creator_shop()') IS NOT NULL
     OR to_regprocedure('public.caller_in_service_company()') IS NOT NULL
     OR to_regprocedure('public.guard_service_customer_org()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_stamp_org_creator_shop', 'trg_guard_service_customer_org'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'organizations' AND column_name = 'creator_shop_org_id')
     OR EXISTS (SELECT 1 FROM public.document_send_slots WHERE document_type = 'customer_org') THEN
    RAISE EXCEPTION 'rollback left 000919 objects';
  END IF;
  IF EXISTS (
    (SELECT policyname, permissive, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations')
    EXCEPT SELECT * FROM live_policy
  ) OR EXISTS (
    SELECT * FROM live_policy
    EXCEPT SELECT policyname, permissive, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organizations'
  ) THEN
    RAISE EXCEPTION 'rollback did not restore the organizations policies';
  END IF;
  IF (SELECT def FROM live_check) IS DISTINCT FROM (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'document_send_slots_document_type_check') THEN
    RAISE EXCEPTION 'rollback did not restore the document_type check';
  END IF;
  RAISE NOTICE 'ok   rollback: 5 live functions byte for byte; organizations policies and 000910 check as live; 000919 objects and slots gone';
END $$;

ROLLBACK;
