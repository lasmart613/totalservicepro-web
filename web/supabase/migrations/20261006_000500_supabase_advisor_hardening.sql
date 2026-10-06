-- Supabase security-advisor hardening.
-- Idempotent. Apply AFTER 20261006_000400 and 20261006_000401.
-- Both 000400 and this file replace get_my_org_id(); this version must win.
-- This file does not rewrite rows.
-- Live catalog was not queried from this repo (no database credentials).
-- Names below are the latest definitions in web/supabase/migrations.
-- A DO block at the end NOTICE-lists any extra public functions still missing
-- search_path, and any extra RLS-enabled tables that still have zero policies.
--
-- Leaked-password protection is a Supabase Auth dashboard toggle
-- (Authentication → Providers → Email → leaked password protection).
-- It is not SQL. Do not flip it from this migration.

-- ---------------------------------------------------------------------------
-- 1) Default privileges and existing table grants.
--    New public tables must not receive TRUNCATE / REFERENCES / TRIGGER, and
--    anon must not receive write. product_issue_reports INSERT for anon stays.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['postgres', 'supabase_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      RAISE NOTICE 'skip default privileges; role % does not exist', role_name;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated',
        role_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon',
        role_name
      );
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'cannot alter default privileges for role %', role_name;
    END;
  END LOOP;
END $$;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Anon does not write application tables. Guest browse is SELECT.
-- Report an Issue keeps anon INSERT on product_issue_reports (see section 4).
DO $$
DECLARE
  rel text;
BEGIN
  FOR rel IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon',
      rel
    );
  END LOOP;
  IF to_regclass('public.product_issue_reports') IS NOT NULL THEN
    EXECUTE 'GRANT INSERT ON TABLE public.product_issue_reports TO anon';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Active org. Do not trust a raw user_profiles.organization_id.
--    Prefer active_organization_id when that id is a real membership,
--    otherwise a membership row (home first).
--    Claimed clinic owners have no membership: created_by stays the service
--    company, so organization_id is used only for customer/clinic org types
--    the caller did not create. A self-serve join of another service company
--    does not match. Column writes are revoked by 20261006_000400 when applied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    ),
    (
      SELECT p.organization_id
      FROM public.user_profiles p
      JOIN public.organizations o ON o.id = p.organization_id
      WHERE p.id = auth.uid()
        AND o.created_by IS DISTINCT FROM auth.uid()
        AND lower(coalesce(o.type, '')) IN (
          'customer', 'laser_clinic', 'laser_rental', 'laser_reseller'
        )
      LIMIT 1
    )
  );
$$;

COMMENT ON FUNCTION public.get_my_org_id() IS
  'Active shop: membership-validated active_organization_id, else a membership (home first), else a claimed clinic the caller did not create. Not an unchecked user_profiles.organization_id.';

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.get_my_org_id();
$$;

COMMENT ON FUNCTION public.user_org_id() IS
  'Same as get_my_org_id(). Team-roster RLS must not read a raw profile organization_id.';

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    org_id IS NOT NULL
    AND (
      org_id = public.get_my_org_id()
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND o.created_by = auth.uid()
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 3) open_service_requests was a security-definer view (invoker off)
--    so bidders could see a redacted open/bidding list while base RLS stayed
--    member-only. Recreating the view as security_invoker against the base
--    table would hide other shops' open jobs.
--    The narrow definer is list_open_service_requests() (safe columns only).
--    The view is security_invoker and only calls that function, so PostgREST
--    clients keep .from('open_service_requests').
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  wanted text[] := ARRAY[
    'id', 'title', 'description', 'status', 'urgency', 'manufacturer', 'model',
    'service_type', 'city', 'state', 'location', 'category', 'created_at',
    'budget_max', 'organization_id'
  ];
  coldef text;
  colsel text;
BEGIN
  IF to_regclass('public.service_requests') IS NULL THEN
    RAISE NOTICE 'service_requests missing; skip open list';
    RETURN;
  END IF;

  SELECT
    string_agg(format('%I %s', c.col, c.typ), ', ' ORDER BY c.ord),
    string_agg(format('%I', c.col), ', ' ORDER BY c.ord)
  INTO coldef, colsel
  FROM (
    SELECT
      wanted[i] AS col,
      i AS ord,
      CASE ic.udt_name
        WHEN 'int8' THEN 'bigint'
        WHEN 'int4' THEN 'integer'
        WHEN 'int2' THEN 'smallint'
        WHEN 'float8' THEN 'double precision'
        WHEN 'float4' THEN 'real'
        WHEN 'bool' THEN 'boolean'
        ELSE ic.udt_name
      END AS typ
    FROM generate_subscripts(wanted, 1) AS i
    JOIN information_schema.columns ic
      ON ic.table_schema = 'public'
     AND ic.table_name = 'service_requests'
     AND ic.column_name = wanted[i]
  ) c;

  IF coldef IS NULL THEN
    RAISE NOTICE 'service_requests has none of the bid-list columns';
    RETURN;
  END IF;

  EXECUTE 'DROP VIEW IF EXISTS public.open_service_requests';
  EXECUTE 'DROP FUNCTION IF EXISTS public.list_open_service_requests()';
  EXECUTE format($fn$
    CREATE FUNCTION public.list_open_service_requests()
    RETURNS TABLE (%s)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $body$
      SELECT %s
      FROM public.service_requests
      WHERE status IN ('open', 'bidding')
    $body$
  $fn$, coldef, colsel);

  EXECUTE 'COMMENT ON FUNCTION public.list_open_service_requests() IS ''Redacted open/bidding service requests for signed-in bidders. Omits equipment, photos, serials, contacts, and logos. Not granted to anon.''';
  EXECUTE 'REVOKE ALL ON FUNCTION public.list_open_service_requests() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.list_open_service_requests() FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_open_service_requests() TO authenticated';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_open_service_requests() TO service_role';
  END IF;

  EXECUTE $view$
    CREATE VIEW public.open_service_requests
    WITH (security_barrier = true, security_invoker = true)
    AS SELECT * FROM public.list_open_service_requests()
  $view$;
  EXECUTE 'COMMENT ON VIEW public.open_service_requests IS ''security_invoker wrapper. Rows come from list_open_service_requests(), which is the only definer and returns the redacted column list. Base service_requests RLS stays member-only.''';
  EXECUTE 'REVOKE ALL ON public.open_service_requests FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON public.open_service_requests FROM anon';
  EXECUTE 'GRANT SELECT ON public.open_service_requests TO authenticated';
END $$;

-- ---------------------------------------------------------------------------
-- 4) RLS enabled, no policies in repo migrations (service role bypasses RLS).
--    Confirmed client paths use getSupabaseAdmin(), not a user JWT:
--      product_issue_reports  web/app/api/product-issues (guest UI posts there)
--      clinic_service_leads    web/app/api/clinic-service-leads
--      god_email_sends         god invite/blast routes and /unsubscribe
--      manual_search_index     god reindex + search API via service role or
--                              search_manual_catalog (authenticated RPC)
--    manufacturers and laser_models are shared catalogs. Signed-in clients
--    SELECT both. A signed-in user may INSERT a manufacturer when auth.uid()
--    is set and the name is non-empty. UPDATE is revoked from authenticated:
--    renaming any catalog row was vandalism. Remember-name upserts go through
--    POST /api/catalog/manufacturers (service role, insert-or-ignore). God
--    table renames already use the service role. laser_models stays read-only
--    here (000401 revokes client writes).
--    Any further zero-policy public table is NOTICE'd and loses anon writes.
--    No policy is invented for an unknown table.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.manufacturers') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.manufacturers FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.manufacturers TO anon, authenticated';
    EXECUTE 'GRANT INSERT ON TABLE public.manufacturers TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "read manufacturers" ON public.manufacturers';
    EXECUTE 'CREATE POLICY "read manufacturers" ON public.manufacturers FOR SELECT TO authenticated, anon USING (true)';
    EXECUTE 'DROP POLICY IF EXISTS manufacturers_authenticated_insert ON public.manufacturers';
    EXECUTE 'DROP POLICY IF EXISTS manufacturers_authenticated_write ON public.manufacturers';
    EXECUTE 'DROP POLICY IF EXISTS manufacturers_authenticated_update ON public.manufacturers';
    EXECUTE 'DROP POLICY IF EXISTS manufacturers_insert_name ON public.manufacturers';
    EXECUTE 'DROP POLICY IF EXISTS manufacturers_update_name ON public.manufacturers';
    EXECUTE $policy$
      CREATE POLICY manufacturers_insert_name ON public.manufacturers
        FOR INSERT TO authenticated
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND nullif(btrim(name), '') IS NOT NULL
        )
    $policy$;
  END IF;
  IF to_regclass('public.laser_models') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.laser_models ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "read laser_models" ON public.laser_models';
    EXECUTE 'CREATE POLICY "read laser_models" ON public.laser_models FOR SELECT TO authenticated, anon USING (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE public.product_issue_reports FROM anon, authenticated;
GRANT INSERT ON TABLE public.product_issue_reports TO anon;

DO $$
DECLARE
  rel text;
BEGIN
  IF to_regclass('public.clinic_service_leads') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.clinic_service_leads FROM anon, authenticated';
  END IF;
  IF to_regclass('public.god_email_sends') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.god_email_sends FROM anon, authenticated';
  END IF;
  IF to_regclass('public.manual_search_index') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.manual_search_index FROM anon, authenticated';
  END IF;

  FOR rel IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid
      )
      AND c.relname NOT IN (
        'product_issue_reports',
        'clinic_service_leads',
        'god_email_sends',
        'manual_search_index'
      )
  LOOP
    RAISE NOTICE 'RLS enabled with no policy (left locked; anon write revoked): %', rel;
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM anon, authenticated', rel);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5) SECURITY DEFINER functions: anon and PUBLIC lose EXECUTE.
--    No unauthenticated page calls an RPC. /e/{token} uses
--    /api/billing/estimate-action. Marketplace guests and Report an Issue
--    use API routes. Signed-in clients call switch_active_organization,
--    leave_organization, and (fallback) search_manual_catalog.
--    Trigger and RLS helpers stay executable by authenticated and service_role
--    so those statements still run. They are not granted to anon.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
  fn_name text;
BEGIN
  FOR fn, fn_name IN
    SELECT p.oid::regprocedure, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

-- Repo SECURITY DEFINER set (latest migration wins). Live may have more;
-- the loop above covers every public definer function, including ones
-- absent from this repo (for example is_admin in generated types).
--   accept_team_invite, auth_login_email, auth_member_of_org,
--   can_view_service_report_for_history, get_my_org_id, handle_new_auth_user,
--   leave_organization, list_open_service_requests, logo_object_readable,
--   membership_insert_allowed, my_membership_org_ids, search_manual_catalog,
--   switch_active_organization, user_is_winning_bidder, user_org_id,
--   user_owns_or_created_org, user_owns_service_request,
--   user_profiles_guard_identity, user_profiles_sync_membership

-- ---------------------------------------------------------------------------
-- 6) Mutable search_path. Set it on every public function that has none.
--    Known in-repo functions without SET search_path:
--      public.update_updated_at_column()
--      public.storage_org_id_from_name(text)
--    The advisor's other names are not in migrations; the loop sets them
--    and NOTICE-lists them. Functions that already set search_path are left
--    alone except the ones replaced above (public, pg_temp).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
  fname text;
BEGIN
  FOR fn, fname IN
    SELECT p.oid::regprocedure, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    RAISE NOTICE 'set search_path on %', fn;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp';
  END IF;
  IF to_regprocedure('public.storage_org_id_from_name(text)') IS NOT NULL THEN
    EXECUTE 'ALTER FUNCTION public.storage_org_id_from_name(text) SET search_path = public, pg_temp';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
