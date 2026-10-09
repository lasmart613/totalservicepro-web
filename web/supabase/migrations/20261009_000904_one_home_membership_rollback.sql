-- Undo 20261009_000904. Drops the one-home index, trigger, and functions.
-- Does not change membership rows. APPLY ON LIVE SUPABASE after review.
-- This repo does not auto-apply SQL.

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS organization_memberships_enforce_single_home ON public.organization_memberships;

DROP FUNCTION IF EXISTS public.organization_memberships_enforce_single_home();

DROP FUNCTION IF EXISTS public.set_home_membership(uuid, bigint, text, boolean);

DROP INDEX IF EXISTS public.organization_memberships_one_home_per_user;
