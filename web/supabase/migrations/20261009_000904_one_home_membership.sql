-- One home membership per user.
--
-- is_home marks the founder shop. Moonlight (a second org) stays is_home false.
-- Creating your own org, a first team membership, a clinic-owner claim, and
-- replacing a company created after a team invite all move home. Those writes
-- go through set_home_membership (service role) or the BEFORE trigger below.
-- The trigger also covers user_profiles_sync_membership, which sets is_home
-- when the service role links a profile to an org that user created, and a
-- client INSERT of their own shop with is_home true.
-- accept_team_invite still inserts is_home false and does not move home.
-- It is not called by the app.
--
-- This file does not change existing rows. A second home row makes the
-- partial unique index fail, and that rolls this whole migration back.
-- Apply web/supabase/oneoff/20261009_tony_single_home.sql first.
--
-- APPLY ON LIVE SUPABASE after that oneoff. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run
-- once the index exists.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_home_membership(
  p_user_id uuid,
  p_organization_id bigint,
  p_role text DEFAULT NULL,
  p_sync_profile boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  n integer;
  next_role text;
  homes integer;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'set_home_membership requires a user and an organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'set_home_membership organization % not found', p_organization_id;
  END IF;

  next_role := CASE
    WHEN p_role IS NULL OR btrim(p_role) = '' THEN NULL
    ELSE public.profile_role_from_membership(p_role)
  END;

  -- Clear first. A later failure raises and rolls this back with the insert.
  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE user_id = p_user_id
    AND organization_id IS DISTINCT FROM p_organization_id
    AND is_home IS TRUE;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (
    p_user_id,
    p_organization_id,
    COALESCE(next_role, 'fse'),
    true
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_home = true,
        updated_at = now(),
        role = COALESCE(next_role, public.organization_memberships.role);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'set_home_membership expected 1 membership row, changed %', n;
  END IF;

  IF p_sync_profile THEN
    UPDATE public.user_profiles
    SET
      organization_id = p_organization_id,
      active_organization_id = p_organization_id,
      role = public.profile_role_from_membership(COALESCE(next_role, role)),
      updated_at = now()
    WHERE id = p_user_id;
  END IF;

  SELECT count(*) INTO homes
  FROM public.organization_memberships
  WHERE user_id = p_user_id
    AND is_home IS TRUE;
  IF homes <> 1 THEN
    RAISE EXCEPTION 'set_home_membership left % home rows', homes;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_home_membership(uuid, bigint, text, boolean) IS
  'Move is_home to one organization. Clears the user''s other home rows, then marks the target. Optional profile pointer update is in the same transaction. Service role only.';

REVOKE ALL ON FUNCTION public.set_home_membership(uuid, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_home_membership(uuid, bigint, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.organization_memberships_enforce_single_home()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF NEW.is_home IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE user_id = NEW.user_id
    AND organization_id IS DISTINCT FROM NEW.organization_id
    AND is_home IS TRUE;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.organization_memberships_enforce_single_home() IS
  'BEFORE INSERT/UPDATE when is_home becomes true. Clears this user''s other home rows in the same statement so the partial unique index can build and a direct write cannot leave two homes.';

REVOKE ALL ON FUNCTION public.organization_memberships_enforce_single_home() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organization_memberships_enforce_single_home ON public.organization_memberships;
CREATE TRIGGER organization_memberships_enforce_single_home
  BEFORE INSERT OR UPDATE OF is_home ON public.organization_memberships
  FOR EACH ROW
  WHEN (NEW.is_home IS TRUE)
  EXECUTE FUNCTION public.organization_memberships_enforce_single_home();

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_one_home_per_user
  ON public.organization_memberships (user_id)
  WHERE is_home;
