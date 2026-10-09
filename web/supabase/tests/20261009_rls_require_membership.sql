-- Behavioral check for 20261009_000906_rls_require_membership.sql.
-- Apply that migration first. Do not run this on production.
-- It inserts fixture rows only inside a transaction that ends in ROLLBACK.
--
-- Usage (staging or a local database that already has the migration applied):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f web/supabase/tests/20261009_rls_require_membership.sql

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_active_org_member(bigint)') IS NULL THEN
    RAISE EXCEPTION 'FAIL apply 20261009_000906_rls_require_membership.sql first';
  END IF;
  IF position('SECURITY DEFINER' IN pg_get_functiondef('public.is_active_org_member(bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL is_active_org_member is not security definer';
  END IF;
  IF position('laser_clinic' IN pg_get_functiondef('public.get_my_org_id()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'FAIL get_my_org_id still returns a profile org with no membership';
  END IF;
  IF position('is_active_org_member' IN pg_get_functiondef('public.user_owns_or_created_org(bigint)'::regprocedure)) = 0
     OR position('created_by' IN pg_get_functiondef('public.user_owns_or_created_org(bigint)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL user_owns_or_created_org dropped created_by or the membership check';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organization_memberships'
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%is_active_org_member%'
        OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%is_active_org_member%'
      )
  ) THEN
    RAISE EXCEPTION 'FAIL organization_memberships policies call is_active_org_member';
  END IF;
END $$;

-- Profile org without a membership is denied. A member is allowed.
-- assigned_to_fse and created_by still allow the stale profile.
DO $$
DECLARE
  stale uuid := '00000000-0000-4000-8000-0000000000a1';
  member uuid := '00000000-0000-4000-8000-0000000000a2';
  other uuid := '00000000-0000-4000-8000-0000000000a3';
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
     'stale-rls@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', member, 'authenticated', 'authenticated',
     'member-rls@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', other, 'authenticated', 'authenticated',
     'other-rls@example.test', '', now(), '{}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  INSERT INTO public.organizations (name, type, created_by)
  VALUES ('RLS membership fixture', 'service_company', other)
  RETURNING id INTO shop;

  UPDATE public.user_profiles
  SET organization_id = shop,
      active_organization_id = shop,
      role = 'fse',
      email = 'stale-rls@example.test'
  WHERE id = stale;

  UPDATE public.user_profiles
  SET organization_id = shop,
      active_organization_id = shop,
      role = 'fse',
      email = 'member-rls@example.test'
  WHERE id = member;

  DELETE FROM public.organization_memberships
  WHERE user_id = stale
    AND organization_id = shop;

  INSERT INTO public.subscriptions (user_id, organization_id, tier, status)
  VALUES (other, shop, 'free', 'active');

  INSERT INTO public.test_equipment (user_id, type, organization_id, owned_by, assigned_to_fse)
  VALUES
    (other, 'rls-org-only', shop, other, NULL),
    (other, 'rls-assigned', shop, other, stale);

  INSERT INTO public.service_reports (model_type, status, organization_id, created_by)
  VALUES
    ('rls-org-report', 'draft', shop, other),
    ('rls-own-report', 'draft', shop, stale);

  PERFORM set_config('request.jwt.claim.sub', stale::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', stale)::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO seen
  FROM public.subscriptions
  WHERE organization_id = shop;
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL profile org without membership can read subscriptions (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.test_equipment
  WHERE organization_id = shop
    AND type = 'rls-org-only';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL profile org without membership can read test equipment';
  END IF;

  SELECT count(*) INTO seen
  FROM public.test_equipment
  WHERE organization_id = shop
    AND type = 'rls-assigned';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL assigned_to_fse lost access without a membership (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'rls-org-report';
  IF seen <> 0 THEN
    RAISE EXCEPTION 'FAIL profile org without membership can read another user service report';
  END IF;

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'rls-own-report';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL created_by lost access to their own service report (saw %)', seen;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', member::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member)::text, true);

  SELECT count(*) INTO seen
  FROM public.subscriptions
  WHERE organization_id = shop;
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot read the organization subscription (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.test_equipment
  WHERE organization_id = shop
    AND type = 'rls-org-only';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot read organization test equipment (saw %)', seen;
  END IF;

  SELECT count(*) INTO seen
  FROM public.service_reports
  WHERE organization_id = shop
    AND model_type = 'rls-org-report';
  IF seen <> 1 THEN
    RAISE EXCEPTION 'FAIL member cannot read the organization service report (saw %)', seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

ROLLBACK;
