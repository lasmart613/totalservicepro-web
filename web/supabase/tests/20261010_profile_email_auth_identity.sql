-- Behavioral check for 20261010_000908_profile_email_auth_identity.sql.
-- Apply that migration first. Do not run this on production.
-- It writes only inside a transaction that ends in ROLLBACK.
--
-- QA user (live auth.users, +qa-, read on 2026-10-10):
--   b417d70d-77a8-4653-9d1b-d8cde1b63539
--   fieldservicetotalservice+qa-236new-0855@gmail.com
--
-- Usage (staging or a local database that already has the migration applied):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f web/supabase/tests/20261010_profile_email_auth_identity.sql

BEGIN;

DO $$
DECLARE
  qa uuid := 'b417d70d-77a8-4653-9d1b-d8cde1b63539';
  auth_email text;
  seen text;
BEGIN
  IF to_regprocedure('private.profile_email_is_auth_email(text)') IS NULL THEN
    RAISE EXCEPTION 'FAIL apply 20261010_000908_profile_email_auth_identity.sql first';
  END IF;
  IF to_regprocedure('public.user_profiles_client_identity_guard()') IS NULL THEN
    RAISE EXCEPTION 'FAIL user_profiles_client_identity_guard is missing';
  END IF;
  IF position('SECURITY INVOKER' IN pg_get_functiondef('public.user_profiles_client_identity_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'FAIL client identity guard is not security invoker';
  END IF;
  IF position('auth.jwt()' IN pg_get_functiondef('private.profile_email_is_auth_email(text)'::regprocedure)) > 0
     OR position('auth.jwt()' IN pg_get_functiondef('public.user_profiles_client_identity_guard()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'FAIL email check uses auth.jwt()';
  END IF;

  SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = qa;
  IF auth_email IS NULL OR btrim(auth_email) = '' THEN
    RAISE EXCEPTION 'FAIL qa user % has no auth email', qa;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = qa) THEN
    RAISE EXCEPTION 'FAIL qa user % has no profile', qa;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', qa::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', qa, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('role', 'authenticated', true);

  -- Upsert includes the login email. BEFORE INSERT runs on ON CONFLICT too.
  INSERT INTO public.user_profiles (id, email)
  VALUES (qa, auth_email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  SELECT email INTO seen FROM public.user_profiles WHERE id = qa;
  IF lower(btrim(seen)) IS DISTINCT FROM lower(btrim(auth_email)) THEN
    RAISE EXCEPTION 'FAIL matching upsert stored %', seen;
  END IF;

  BEGIN
    UPDATE public.user_profiles
    SET email = 'not-the-login@example.test'
    WHERE id = qa;
    RAISE EXCEPTION 'FAIL different email was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM NOT LIKE '%user_profiles.email must match the auth login email%' THEN
        RAISE EXCEPTION 'FAIL unexpected 42501: %', SQLERRM;
      END IF;
  END;

  -- Unchanged email must not call the helper. Revoke it, then update another column.
  PERFORM set_config('role', 'postgres', true);
  REVOKE EXECUTE ON FUNCTION private.profile_email_is_auth_email(text) FROM authenticated;
  PERFORM set_config('role', 'authenticated', true);

  UPDATE public.user_profiles
  SET first_name = first_name
  WHERE id = qa;

  BEGIN
    UPDATE public.user_profiles
    SET email = 'not-the-login@example.test'
    WHERE id = qa;
    RAISE EXCEPTION 'FAIL email change ran without the helper';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

ROLLBACK;
