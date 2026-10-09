-- Undo 20261009_000903. Drops the one-owner index and the invite auth-user column.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.user_profiles_one_owner_per_organization;

ALTER TABLE public.engineer_invitations
  DROP COLUMN IF EXISTS created_auth_user_id;
