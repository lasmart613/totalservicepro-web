-- Run: bash /path/run_proof.sh <db> supabase/tests/directory-registration-926/proof.sql  (fresh DB on local PG17)
-- Then: supabase/tests/directory-registration-926/race.sh <db>
\set ON_ERROR_STOP 1
\ir setup.sql
INSERT INTO fp VALUES ('before', pg_temp.fingerprint());
CREATE FUNCTION pg_temp.ok(c boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c THEN RAISE NOTICE 'PASS %', label; ELSE RAISE WARNING 'FAILED %', label; END IF; END $$;
BEGIN; \ir ../../../web/supabase/migrations/20261018_000926_directory_registration.sql
COMMIT;
BEGIN; \ir ../../../web/supabase/migrations/20261018_000926_directory_registration.sql
COMMIT;
SELECT pg_temp.ok(true, 'migration applies twice (idempotent)');
\ir cases.sql
\ir review_cases.sql
-- The rollback refuses while a directory-review clinic invite is claimed (Lima). Undo that claim the way support would first.
SELECT pg_temp.ok((SELECT count(*) FROM public.clinic_owner_invites WHERE issued_via = 'directory_review' AND consumed_at IS NOT NULL) = 1, 'one claimed directory-review invite before rollback');
DELETE FROM public.organization_memberships WHERE user_id = '00000000-0000-0000-0000-00000000c102';
UPDATE public.user_profiles SET organization_id = NULL, active_organization_id = NULL, role = NULL WHERE id = '00000000-0000-0000-0000-00000000c102';
DELETE FROM public.clinic_owner_invites WHERE issued_via = 'directory_review' AND consumed_at IS NOT NULL;
BEGIN; \ir ../../../web/supabase/migrations/20261018_000926_directory_registration_rollback.sql
COMMIT;
SELECT pg_temp.ok(to_regclass('public.directory_registrations') IS NULL AND to_regclass('public.directory_registration_attempts') IS NULL
  AND to_regprocedure('public.directory_registration_step1(text,text,text,text,text,text)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'directory\_%'), 'rollback removes all objects');
SELECT pg_temp.ok((SELECT count(*) FROM public.organizations WHERE NOT is_active) > 0, 'rollback keeps pending orgs');
SELECT pg_temp.ok(pg_temp.fingerprint() = (SELECT v FROM fp WHERE k = 'before'), 'rollback restores the pre-000926 schema exactly (fingerprint)');
BEGIN; \ir ../../../web/supabase/migrations/20261018_000926_directory_registration.sql
COMMIT;
SELECT pg_temp.ok(to_regclass('public.directory_registrations') IS NOT NULL, 're-apply after rollback');
