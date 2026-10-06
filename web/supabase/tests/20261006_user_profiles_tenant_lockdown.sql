-- Trigger and privilege checks for 20261006_000400 and 20261006_000401.
-- Apply both migrations first. 000401 closes the live open write policies.
-- Do not run this on production. It rolls back. It inserts fixture rows only
-- inside a transaction that ends in ROLLBACK.
--
-- Usage (staging or a local database that already has the migration applied):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f web/supabase/tests/20261006_user_profiles_tenant_lockdown.sql

BEGIN;

-- Privilege assertions. These do not write customer data.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.user_profiles', 'organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE user_profiles.organization_id';
  END IF;
  IF has_column_privilege('authenticated', 'public.user_profiles', 'role', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE user_profiles.role';
  END IF;
  IF has_column_privilege('authenticated', 'public.user_profiles', 'active_organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE user_profiles.active_organization_id';
  END IF;
  IF has_column_privilege('anon', 'public.user_profiles', 'organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL anon can still UPDATE user_profiles.organization_id';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.user_profiles', 'phone', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated lost UPDATE on user_profiles.phone';
  END IF;
  IF has_table_privilege('authenticated', 'public.organization_memberships', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE organization_memberships';
  END IF;
  IF has_table_privilege('authenticated', 'public.subscriptions', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL authenticated can still INSERT subscriptions';
  END IF;
  IF position('cannot self-assign an elevated role' IN pg_get_functiondef('public.user_profiles_sync_membership()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL sync trigger does not raise on elevated self-assign';
  END IF;
  IF position('cannot join an organization you did not create' IN pg_get_functiondef('public.user_profiles_sync_membership()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL sync trigger does not raise on cross-tenant join';
  END IF;
  IF position('SET search_path TO ''public'', ''pg_temp''' IN pg_get_functiondef('public.user_profiles_sync_membership()'::regprocedure)) = 0
     AND position('SET search_path TO public, pg_temp' IN pg_get_functiondef('public.user_profiles_sync_membership()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL sync function search_path is not public, pg_temp';
  END IF;
END $$;

-- Behavioral fixture. Synthetic ids only. ROLLED BACK at the end of this file.
-- auth.uid() is simulated with the request JWT claim Supabase reads.
DO $$
DECLARE
  victim uuid := '00000000-0000-4000-8000-0000000000aa';
  attacker uuid := '00000000-0000-4000-8000-0000000000bb';
  victim_org bigint;
  attacker_org bigint;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', victim, 'authenticated', 'authenticated',
     'victim-lockdown@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', attacker, 'authenticated', 'authenticated',
     'attacker-lockdown@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  INSERT INTO public.organizations (name, type, created_by, is_premium)
  VALUES ('Victim Shop', 'service_company', victim, false)
  RETURNING id INTO victim_org;

  INSERT INTO public.organizations (name, type, created_by, is_premium)
  VALUES ('Attacker Shop', 'service_company', attacker, false)
  RETURNING id INTO attacker_org;

  INSERT INTO public.user_profiles (id, email, role, organization_id, active_organization_id)
  VALUES
    (victim, 'victim-lockdown@example.test', 'company_admin', victim_org, victim_org),
    (attacker, 'attacker-lockdown@example.test', 'company_admin', attacker_org, attacker_org);

  PERFORM set_config('request.jwt.claim.sub', attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', attacker)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    UPDATE public.user_profiles
    SET organization_id = victim_org, role = 'owner'
    WHERE id = attacker;
    RAISE EXCEPTION 'FAIL cross-tenant profile update was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%cannot join an organization%'
         OR SQLERRM ILIKE '%cannot self-assign%'
         OR SQLERRM ILIKE '%permission denied%' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;
END $$;

-- Open write policies from the live sweep. 000401 must already be applied.
DO $$
DECLARE
  open_table text;
  open_tables text[] := ARRAY[
    'contacts',
    'engineer_invitations',
    'forum_attachments',
    'forum_bookmarks',
    'forum_categories',
    'forum_posts',
    'forum_reactions',
    'forum_threads',
    'labor_log',
    'notifications',
    'parts',
    'parts_used',
    'sites'
  ];
BEGIN
  FOREACH open_table IN ARRAY open_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = open_table
        AND policyname = 'Allow all - ' || open_table
    ) THEN
      RAISE EXCEPTION 'FAIL Allow all policy still present on %', open_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'notifications_insert_authenticated'
  ) THEN
    RAISE EXCEPTION 'FAIL notifications_insert_authenticated still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'Authenticated can create customer orgs'
  ) THEN
    RAISE EXCEPTION 'FAIL customer org insert still has no created_by check';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'laser_models'
      AND policyname IN ('auth_insert_laser_models', 'Authenticated can insert laser_models')
  ) THEN
    RAISE EXCEPTION 'FAIL laser_models insert policy still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'parts_catalog' AND policyname = 'parts_catalog_update'
  ) THEN
    RAISE EXCEPTION 'FAIL parts_catalog_update is still USING true';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'parts_catalog' AND policyname = 'parts_catalog_update_owner'
      AND coalesce(qual, '') ILIKE '%company_admin%'
      AND coalesce(with_check, '') ILIKE '%company_admin%'
  ) THEN
    RAISE EXCEPTION 'FAIL parts_catalog_update_owner is missing';
  END IF;
  IF has_column_privilege('authenticated', 'public.parts_catalog', 'created_by', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE parts_catalog.created_by';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'waitlist' AND policyname = 'public insert waitlist'
  ) THEN
    RAISE EXCEPTION 'FAIL public insert waitlist was removed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'forum_threads'
      AND policyname = 'forum_threads_write_author'
      AND with_check ILIKE '%author_id%'
  ) THEN
    RAISE EXCEPTION 'FAIL forum threads are not limited to the author';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'labor_log' AND policyname = 'labor_log_ticket_org'
  ) THEN
    RAISE EXCEPTION 'FAIL labor_log is not scoped to the ticket org';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'parts_used' AND policyname = 'parts_used_ticket_org'
  ) THEN
    RAISE EXCEPTION 'FAIL parts_used is not scoped to the ticket org';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sites' AND policyname = 'sites_org_member'
  ) THEN
    RAISE EXCEPTION 'FAIL sites are not scoped to the organization';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('locations_insert', 'stock_insert', 'stock_update', 'transactions_insert', 'part_vendors_insert', 'part_vendors_update', 'parts_catalog_insert')
      AND coalesce(with_check, qual, '') IN ('true', '(true)')
  ) THEN
    RAISE EXCEPTION 'FAIL an inventory or catalog write policy is still USING/CHECK true';
  END IF;

  IF has_column_privilege('anon', 'public.contacts', 'organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL anon can still UPDATE contacts.organization_id';
  END IF;
  IF has_column_privilege('authenticated', 'public.contacts', 'organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE contacts.organization_id';
  END IF;
  IF has_column_privilege('anon', 'public.notifications', 'user_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL anon can still UPDATE notifications.user_id';
  END IF;
  IF has_column_privilege('authenticated', 'public.notifications', 'user_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still UPDATE notifications.user_id';
  END IF;
  IF has_table_privilege('authenticated', 'public.notifications', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL authenticated can still INSERT notifications';
  END IF;
  IF has_table_privilege('authenticated', 'public.laser_models', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL authenticated can still INSERT laser_models';
  END IF;
  IF has_column_privilege('anon', 'public.bids', 'bidder_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL anon can still UPDATE bids.bidder_id';
  END IF;
  IF has_column_privilege('anon', 'public.sites', 'organization_id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL anon can still UPDATE sites.organization_id';
  END IF;

  IF has_table_privilege('authenticated', 'public.engineer_invitations', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL authenticated can still INSERT engineer_invitations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engineer_invitations'
      AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'FAIL engineer_invitations still has an INSERT policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'engineer_invitations'
      AND policyname = 'engineer_invitations_select'
      AND qual ILIKE '%auth_login_email%'
  ) THEN
    RAISE EXCEPTION 'FAIL invitees can still read invitation tokens';
  END IF;
  IF has_table_privilege('anon', 'public.contacts', 'SELECT')
     OR has_table_privilege('anon', 'public.engineer_invitations', 'SELECT')
     OR has_table_privilege('anon', 'public.notifications', 'SELECT')
     OR has_table_privilege('anon', 'public.forum_bookmarks', 'SELECT')
     OR has_table_privilege('anon', 'public.parts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.parts', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL anon or authenticated can still read a revoked open table';
  END IF;
  IF public.profile_role_from_membership('admin') IS DISTINCT FROM 'company_admin' THEN
    RAISE EXCEPTION 'FAIL membership admin is copied onto the profile as platform admin';
  END IF;
  IF position('role = ''admin''' IN pg_get_functiondef('public.is_admin()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL is_admin() is not user_profiles.role = admin';
  END IF;
  IF position('invitation_is_open' IN pg_get_functiondef('public.accept_team_invite(bigint, bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL an expired invite can still be accepted';
  END IF;
  IF position('invitation_is_open' IN pg_get_functiondef('public.membership_insert_allowed(uuid, bigint, text, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL an expired invite can still insert a membership';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_estimates'
      AND policyname = 'service_estimates_member_all'
      AND (coalesce(qual, '') ILIKE '%IS NULL%' OR coalesce(with_check, '') ILIKE '%IS NULL%')
  ) OR EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_invoices'
      AND policyname = 'service_invoices_member_all'
      AND (coalesce(qual, '') ILIKE '%IS NULL%' OR coalesce(with_check, '') ILIKE '%IS NULL%')
  ) THEN
    RAISE EXCEPTION 'FAIL null-org estimates or invoices are still visible to every member';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_customers'
      AND policyname = 'organization_customers_insert_linked'
      AND with_check ILIKE '%customer_org_link_allowed%'
  ) THEN
    RAISE EXCEPTION 'FAIL organization_customers can still link an arbitrary customer org';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'forum_bookmarks'
      AND cmd = 'SELECT'
      AND coalesce(qual, '') IN ('true', '(true)')
  ) THEN
    RAISE EXCEPTION 'FAIL forum bookmarks are still readable by everyone';
  END IF;
  IF has_column_privilege('authenticated', 'public.organizations', 'is_premium', 'INSERT')
     OR has_column_privilege('authenticated', 'public.organizations', 'is_premium', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.organizations', 'created_by', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL authenticated can still write organizations premium or created_by';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.organizations', 'name', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL authenticated lost INSERT on organizations.name';
  END IF;
  IF NOT (
    has_column_privilege('authenticated', 'public.organizations', 'timezone', 'INSERT')
    AND has_column_privilege('authenticated', 'public.organizations', 'timezone', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'FAIL authenticated lost organizations.timezone';
  END IF;
  IF to_regclass('public.service_reports') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'guard_tenant_owner_cols'
         AND tgrelid = 'public.service_reports'::regclass
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'FAIL service_reports can still move organization_id or created_by from a client';
  END IF;
  IF to_regclass('public.marketplace_listings') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'guard_tenant_owner_cols'
         AND tgrelid = 'public.marketplace_listings'::regclass
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'FAIL marketplace_listings can still move organization_id, seller_id, or created_by from a client';
  END IF;
  IF to_regclass('public.service_estimates') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'guard_tenant_owner_cols'
         AND tgrelid = 'public.service_estimates'::regclass
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'FAIL service_estimates has no guard_tenant_owner_cols trigger';
  END IF;
  IF to_regclass('public.service_invoices') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'guard_tenant_owner_cols'
         AND tgrelid = 'public.service_invoices'::regclass
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'FAIL service_invoices has no guard_tenant_owner_cols trigger';
  END IF;
  IF to_regclass('public.service_estimates') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'service_estimates'
         AND (
           coalesce(qual, '') ~* 'or[[:space:]]+created_by[[:space:]]*=[[:space:]]*auth\.uid\(\)'
           OR coalesce(with_check, '') ~* 'or[[:space:]]+created_by[[:space:]]*=[[:space:]]*auth\.uid\(\)'
         )
     ) THEN
    RAISE EXCEPTION 'FAIL service_estimates still allows created_by to plant any organization_id';
  END IF;
  IF to_regclass('public.service_invoices') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'service_invoices'
         AND (
           coalesce(qual, '') ~* 'or[[:space:]]+created_by[[:space:]]*=[[:space:]]*auth\.uid\(\)'
           OR coalesce(with_check, '') ~* 'or[[:space:]]+created_by[[:space:]]*=[[:space:]]*auth\.uid\(\)'
         )
     ) THEN
    RAISE EXCEPTION 'FAIL service_invoices still allows created_by to plant any organization_id';
  END IF;
  IF to_regclass('public.service_invoices') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'service_invoices' AND column_name = 'voided_at'
     )
     AND NOT (
       has_column_privilege('authenticated', 'public.service_invoices', 'voided_at', 'UPDATE')
       AND has_column_privilege('authenticated', 'public.service_invoices', 'void_reason', 'UPDATE')
       AND has_column_privilege('authenticated', 'public.service_invoices', 'status', 'UPDATE')
     ) THEN
    RAISE EXCEPTION 'FAIL authenticated lost service_invoices void columns';
  END IF;
  IF has_function_privilege('anon', 'public.profile_org_change_allowed(uuid, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can still execute profile_org_change_allowed';
  END IF;
  IF position('invitation_is_open' IN pg_get_functiondef('public.profile_org_change_allowed(uuid,bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL profile_org_change_allowed does not use the 14-day invite rule';
  END IF;
  IF position('current_user' IN pg_get_functiondef('public.user_profiles_guard_identity()'::regprocedure)) = 0
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'user_profiles_guard_identity' AND p.prosecdef
     ) THEN
    RAISE EXCEPTION 'FAIL user_profiles_guard_identity is not an invoker current_user bypass';
  END IF;
  IF position('profile_role_from_membership' IN pg_get_functiondef('public.leave_organization(bigint)'::regprocedure)) = 0
     OR position('left_organization_id' IN pg_get_functiondef('public.leave_organization(bigint)'::regprocedure)) = 0
     OR position('account_kept' IN pg_get_functiondef('public.leave_organization(bigint)'::regprocedure)) = 0
     OR position('pg_temp' IN pg_get_functiondef('public.leave_organization(bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL leave_organization still copies a raw membership role';
  END IF;
  IF position('email_confirmed_at' IN pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL handle_new_auth_user joins an unconfirmed invite email';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
      AND tgfoid = 'public.handle_new_auth_user()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'FAIL handle_new_auth_user is attached to auth.users';
  END IF;
  IF position('get_my_org_id' IN pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)) = 0
     OR position('laser_clinic' IN pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL customer_org_link_allowed is still the moonlighter check';
  END IF;
  IF to_regclass('public.organization_customers') IS NOT NULL
     AND (
       has_column_privilege('authenticated', 'public.organization_customers', 'customer_organization_id', 'UPDATE')
       OR has_column_privilege('authenticated', 'public.organization_customers', 'service_organization_id', 'UPDATE')
     ) THEN
    RAISE EXCEPTION 'FAIL organization_customers link columns are still updatable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_memberships_role_not_platform_admin'
      AND conrelid = 'public.organization_memberships'::regclass
  ) THEN
    RAISE EXCEPTION 'FAIL membership role admin is still allowed';
  END IF;
END $$;

ROLLBACK;
