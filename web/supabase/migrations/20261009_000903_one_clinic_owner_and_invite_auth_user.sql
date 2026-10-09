-- One clinic owner per organization, and proof of which auth user an invite created.
--
-- Claim writes user_profiles.role = 'owner'. A partial unique index stops two
-- concurrent claims from both becoming owner. Live read-only check on
-- 2026-10-09:
--   role counts: company_admin 27, fse 14, owner 10, parts_supplier 5,
--   admin 2, engineer 2, customer 0.
--   No organization had more than one role = 'owner' row, so this index builds.
--   Organization 4 had two admin rows and a company_admin, so a predicate that
--   treats admin or company_admin as the owner would not build.
--   Two organizations have more than one fse. fse is not an owner role.
-- customer stays out of the index. Claim never writes that role. The claim
-- route still treats a legacy customer row as occupying the owner slot.
--
-- engineer_invitations.created_auth_user_id stores the auth user id returned
-- when this invite flow first creates the account. A later resend may email a
-- set-password link only when that id still matches and the user has never
-- signed in. Null means this row did not prove it created the account.
-- Authenticated and anon do not receive the new column.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_one_owner_per_organization
  ON public.user_profiles (organization_id)
  WHERE role = 'owner';

ALTER TABLE public.engineer_invitations
  ADD COLUMN IF NOT EXISTS created_auth_user_id uuid;

REVOKE SELECT (created_auth_user_id) ON TABLE public.engineer_invitations FROM PUBLIC, anon, authenticated;
REVOKE INSERT (created_auth_user_id) ON TABLE public.engineer_invitations FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (created_auth_user_id) ON TABLE public.engineer_invitations FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.engineer_invitations.created_auth_user_id IS
  'Auth user created by this invite. Null unless this flow created the account.';
