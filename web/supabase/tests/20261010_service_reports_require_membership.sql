-- Behavioral check for 20261010_000909_service_reports_require_membership.sql.
-- Apply that migration first. Do not run this on production.
-- It inserts fixture rows only inside a transaction that ends in ROLLBACK.
--
-- 20261009_rls_require_membership.sql still expects created_by alone to
-- read a report. That was 000906. This file is the check after 000909.
--
-- Usage (staging or a local database that already has the migration applied):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f web/supabase/tests/20261010_service_reports_require_membership.sql

BEGIN;

DO $$
DECLARE
  qual text;
  chk text;
  hist text;
BEGIN
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION 'FAIL apply 20261009_000906_rls_require_membership.sql first';
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid)
  INTO qual
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'service_reports'
    AND pol.polname = 'service_reports_select';
  IF qual IS NULL
     OR qual !~ 'created_by = auth\.uid\(\)\)*[[:space:]]*AND[[:space:]]+(public\.)?is_active_org_member'
     OR qual !~ '\(organization_id\)::text' THEN
    RAISE EXCEPTION 'FAIL service_reports_select created_by does not require is_active_org_member';
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid)
  INTO qual, chk
  FROM pg_policy pol
  JOIN pg_class c ON c.oid = pol.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'service_reports'
    AND pol.polname = 'service_reports_update';
  IF qual IS NULL
     OR chk IS NULL
     OR qual !~ 'created_by = auth\.uid\(\)\)*[[:space:]]*AND[[:space:]]+(public\.)?is_active_org_member'
     OR chk !~ 'created_by = auth\.uid\(\)\)*[[:space:]]*AND[[:space:]]+(public\.)?is_active_org_member' THEN
    RAISE EXCEPTION 'FAIL service_reports_update created_by does not require is_active_org_member';
  END IF;

  hist := pg_get_functiondef('public.can_view_service_report_for_history(public.service_reports)'::regprocedure);
  IF hist !~ 'r\.created_by = auth\.uid\(\)'
     OR position('is_active_org_member(r.organization_id)' IN hist) = 0
     OR position('public.get_my_org_id()' IN hist) = 0
     OR position('public.user_owns_or_created_org' IN hist) = 0 THEN
    RAISE EXCEPTION 'FAIL can_view_service_report_for_history dropped a history arm or the membership gate';
  END IF;
END $$;

-- Profile org plus a membership can read and update. created_by without a
-- membership cannot, including through the equipment-history policy.
DO $$
DECLARE
  stale uuid := '00000000-0000-4000-8000-0000000000b1';
  member uuid := '00000000-0000-4000-8000-0000000000b2';
  other uuid := '00000000-0000-4000-8000-0000000000b3';
  shop bigint;
  seen integer;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', stale, 'authenticated', 'authenticated',
     'stale-report@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', member, 'authenticated', 'authenticated',
     'member-report@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', other, 'authenticated', 'authenticated',
     'other-report@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  INSERT INTO public.organizations (name, type, created_by)
  VALUES ('Service report membership fixture', 'service_company', other)
  RETURNING id INTO shop;

  UPDATE public.user_profiles
  SET organization_id = shop,
      active_organization_id = shop,
      role = 'fse',
      email = 'stale-report@example.test'
  WHERE id = stale;

  UPDATE public.user_profiles
  SET organization_id = shop,
      active_organization_id = shop,
      role = 'fse',
      email = 'member-report@example.test'
  WHERE id = member;

  DELETE FROM public.organization_memberships
  WHERE user_id = stale
    AND organization_id = shop;

  INSERT INTO public.service_reports (model_type, status, organization_id, created_by)
  VALUES
    ('former-author-report', 'draft', shop, stale),
    ('org-report', 'draft', shop, other);

  PERFORM set_config('request.jwt.claim.sub', stale::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stale)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'former-author-report';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL former author can read a service report after leaving the org (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'org-report';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL former author can read another user service report (saw %)', seen;
  END IF;

  UPDATE public.service_reports
  SET status = 'complete'
  WHERE organization_id = shop
    AND model_type = 'former-author-report';
  GET DIAGNOSTICS seen = ROW_COUNT;
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL former author can update a service report after leaving the org (saw %)', seen;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member)::text, true);

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'org-report';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot read the organization service report (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'former-author-report';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot read a former author service report (saw %)', seen;
  END IF;

  UPDATE public.service_reports
  SET status = 'complete'
  WHERE organization_id = shop
    AND model_type = 'org-report';
  GET DIAGNOSTICS seen = ROW_COUNT;
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot update the organization service report (saw %)', seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

ROLLBACK;
