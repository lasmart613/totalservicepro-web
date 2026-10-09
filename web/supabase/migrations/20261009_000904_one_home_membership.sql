-- One home membership per user.
--
-- is_home marks the founder shop. Moonlight (a second org) stays is_home false.
-- Creating your own org, a first team membership, a clinic-owner claim, and
-- replacing an empty company created after a team invite all move home.
-- Those writes go through set_home_membership (service role). The BEFORE
-- trigger clears other homes when a row is marked is_home, including a
-- client INSERT of their own shop with is_home true.
-- user_profiles_sync_membership is replaced here so a profile write or org
-- switch sets is_home true only when the user has no home row. It does not
-- treat "I created this org" as home.
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

CREATE OR REPLACE FUNCTION public.user_profiles_sync_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  grant_role text;
  invite_role text;
  existing_role text;
  own_created boolean;
  member_of_new boolean;
  home boolean;
  org_changed boolean;
  elevated text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager', 'crm'
  ];
BEGIN
  actor := auth.uid();

  org_changed :=
    (TG_OP = 'INSERT' AND NEW.organization_id IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id);

  -- Service role / SECURITY DEFINER caller with no JWT user. Trusted.
  IF actor IS NULL THEN
    IF NEW.organization_id IS NULL THEN
      RETURN NEW;
    END IF;
    grant_role := public.profile_role_from_membership(COALESCE(NULLIF(TRIM(NEW.role), ''), 'fse'));
    -- A profile write or org switch must not steal home. is_home becomes true
    -- only when this user has no home row. Founder and create-org call
    -- set_home_membership, which has already marked the new home, so this
    -- stays false and the conflict update keeps that row.
    SELECT NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = NEW.id
        AND m.is_home IS TRUE
    ) INTO home;
    INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
    VALUES (NEW.id, NEW.organization_id, grant_role, home)
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET updated_at = now(),
          is_home = public.organization_memberships.is_home OR EXCLUDED.is_home,
          role = CASE
            WHEN public.organization_memberships.is_home THEN public.organization_memberships.role
            ELSE EXCLUDED.role
          END;
    IF NEW.active_organization_id IS NULL THEN
      NEW.active_organization_id := NEW.organization_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'user_profiles insert must be your own row';
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
      AND NEW.active_organization_id IS NOT NULL)
     OR (TG_OP = 'INSERT' AND NEW.active_organization_id IS NOT NULL) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = NEW.active_organization_id
    )
    AND (
      NEW.active_organization_id IS DISTINCT FROM NEW.organization_id
      OR NEW.organization_id IS NULL
    ) THEN
      RAISE EXCEPTION 'active_organization_id must reference an existing membership';
    END IF;
  END IF;

  IF NOT org_changed OR NEW.organization_id IS NULL THEN
    IF TG_OP = 'UPDATE'
       AND NEW.role IS DISTINCT FROM OLD.role
       AND lower(COALESCE(NEW.role, '')) = ANY (elevated) THEN
      SELECT m.role INTO existing_role
      FROM public.organization_memberships m
      WHERE m.user_id = actor
        AND m.organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
      LIMIT 1;
      IF existing_role IS NULL
         OR lower(public.profile_role_from_membership(existing_role)) IS DISTINCT FROM lower(btrim(NEW.role)) THEN
        RAISE EXCEPTION 'cannot self-assign an elevated role';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organizations o
    WHERE o.id = NEW.organization_id AND o.created_by = actor
  ) INTO own_created;

  SELECT m.role INTO existing_role
  FROM public.organization_memberships m
  WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
  LIMIT 1;
  member_of_new := existing_role IS NOT NULL;

  SELECT NULLIF(TRIM(i.role), '') INTO invite_role
  FROM public.engineer_invitations i
  WHERE i.organization_id = NEW.organization_id
    AND public.auth_login_email() IS NOT NULL
    AND lower(btrim(i.email)) = public.auth_login_email()
    AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
  ORDER BY i.created_at DESC NULLS LAST, i.id DESC
  LIMIT 1;

  IF member_of_new THEN
    grant_role := public.profile_role_from_membership(COALESCE(NULLIF(TRIM(existing_role), ''), 'fse'));
  ELSIF own_created THEN
    IF lower(COALESCE(NEW.role, '')) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
    grant_role := public.profile_role_from_membership(COALESCE(NULLIF(TRIM(NEW.role), ''), 'fse'));
    IF lower(grant_role) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
  ELSIF invite_role IS NOT NULL THEN
    grant_role := public.profile_role_from_membership(invite_role);
  ELSE
    RAISE EXCEPTION 'cannot join an organization you did not create, are not a member of, and were not invited to';
  END IF;

  IF lower(COALESCE(NEW.role, '')) = ANY (elevated)
     AND NOT (TG_OP = 'UPDATE' AND lower(btrim(OLD.role)) = 'admin')
     AND lower(btrim(NEW.role)) IS DISTINCT FROM lower(btrim(grant_role)) THEN
    RAISE EXCEPTION 'cannot self-assign an elevated role';
  END IF;

  NEW.role := CASE
    WHEN TG_OP = 'UPDATE' AND lower(btrim(OLD.role)) = 'admin' THEN 'admin'
    ELSE grant_role
  END;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (NEW.id, NEW.organization_id, grant_role, false)
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET updated_at = now(),
        is_home = public.organization_memberships.is_home,
        role = CASE
          WHEN public.organization_memberships.is_home THEN public.organization_memberships.role
          ELSE EXCLUDED.role
        END;

  IF NEW.active_organization_id IS NULL THEN
    NEW.active_organization_id := NEW.organization_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.user_id = actor AND m.organization_id = NEW.active_organization_id
  ) AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  RETURN NEW;
END;
$$;


COMMENT ON FUNCTION public.user_profiles_sync_membership() IS
  'BEFORE INSERT/UPDATE. Client org changes require creator, existing membership, or an unaccepted invite for auth.users email. Membership role comes from that invite or the existing membership, never from an elevated self-assigned role. Service role (auth.uid() IS NULL) may write founder roles. A service-role profile or org switch sets is_home true only when the user has no home row. It does not move an existing home. Founder and create-org use set_home_membership.';


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
