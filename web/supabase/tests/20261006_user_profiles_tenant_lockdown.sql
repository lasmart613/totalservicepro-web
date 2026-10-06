-- Trigger and privilege checks for 20261006_000400_user_profiles_tenant_lockdown.
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

ROLLBACK;
