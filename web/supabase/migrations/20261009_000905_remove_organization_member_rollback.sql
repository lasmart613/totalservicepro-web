-- Undo 20261009_000905. Drops remove_organization_member.
-- Does not restore memberships or invites already removed.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.remove_organization_member(uuid, bigint, uuid);
