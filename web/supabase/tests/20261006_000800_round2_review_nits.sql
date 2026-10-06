-- Run after 20261006_000800 on a throwaway database. Rolls back.
BEGIN;

DO $$
BEGIN
  IF position('organization_customers' IN pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)) = 0
     OR position('IS DISTINCT FROM p_service' IN pg_get_functiondef('public.customer_org_link_allowed(bigint,bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL customer_org_link_allowed still allows a customer linked to another service org';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'parts_catalog'
      AND pol.polname = 'parts_catalog_update_owner'
      AND position('caller_is_part_creator_admin' IN pg_get_expr(pol.polqual, pol.polrelid)) > 0
      AND position('caller_is_part_creator_admin' IN pg_get_expr(pol.polwithcheck, pol.polrelid)) > 0
  ) THEN
    RAISE EXCEPTION 'FAIL parts_catalog_update_owner does not use caller_is_part_creator_admin';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'part_vendors'
      AND pol.polname = 'part_vendors_delete_owner'
      AND position('caller_is_part_creator_admin' IN pg_get_expr(pol.polqual, pol.polrelid)) > 0
  ) THEN
    RAISE EXCEPTION 'FAIL part_vendors_delete_owner does not use caller_is_part_creator_admin';
  END IF;
  IF has_function_privilege('anon', 'public.caller_is_part_creator_admin(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.caller_is_part_creator_admin(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.caller_is_part_creator_admin(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL caller_is_part_creator_admin grants';
  END IF;
  IF position('row_security' IN pg_get_functiondef('public.caller_is_part_creator_admin(uuid)'::regprocedure)) = 0
     OR position('NOT EXISTS' IN pg_get_functiondef('public.caller_is_part_creator_admin(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL caller_is_part_creator_admin is not the home-org fallback';
  END IF;
  IF has_table_privilege('authenticated', 'public.part_vendors', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.part_vendors', 'created_by', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.part_vendors', 'vendor_name', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL part_vendors created_by is still client-writable';
  END IF;

  IF to_regprocedure('public.profile_org_change_allowed(uuid, bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL old profile_org_change_allowed signature remains';
  END IF;
  IF has_function_privilege('anon', 'public.profile_org_change_allowed(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.profile_org_change_allowed(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL profile_org_change_allowed grants';
  END IF;
  IF position('profile_org_change_allowed(new_row.organization_id)' IN pg_get_functiondef('public.user_profiles_guard_identity_enforce(text,public.user_profiles,public.user_profiles)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL guard still calls profile_org_change_allowed(uuid, bigint)';
  END IF;

  IF has_table_privilege('anon', 'public.product_issue_reports', 'INSERT') THEN
    RAISE EXCEPTION 'FAIL anon can still INSERT product_issue_reports';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_issue_reports' AND policyname = 'product_issue_reports_insert_anon'
  ) THEN
    RAISE EXCEPTION 'FAIL product_issue_reports_insert_anon remains';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'laser_models' AND cmd = 'SELECT'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL laser_models does not have exactly one read policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'laser_models' AND policyname = 'laser_models_read'
  ) THEN
    RAISE EXCEPTION 'FAIL laser_models_read is missing';
  END IF;

  IF position('engineer_id cannot name another user' IN pg_get_functiondef('public.guard_client_attribution()'::regprocedure)) = 0
     OR position('company_admin' IN pg_get_functiondef('public.caller_is_company_admin(bigint)'::regprocedure)) = 0
     OR position('current_user' IN pg_get_functiondef('public.guard_client_attribution()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL attribution guard is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'guard_client_attribution' AND tgrelid = 'public.labor_log'::regclass AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'guard_client_attribution' AND tgrelid = 'public.inventory_transactions'::regclass AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'FAIL attribution trigger is missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.labor_log', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL labor_log still has table UPDATE';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.labor_log', 'engineer_id', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.labor_log', 'notes', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.labor_log', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL labor_log safe column grant';
  END IF;
  IF has_function_privilege('anon', 'public.accept_team_invite(bigint, bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.accept_team_invite(bigint, bigint)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.accept_team_invite(bigint, bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL accept_team_invite is executable by a client role';
  END IF;
  IF has_table_privilege('authenticated', 'public.inventory_transactions', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.inventory_transactions', 'performed_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.inventory_transactions', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL inventory_transactions safe column grant';
  END IF;
END $$;

ROLLBACK;
