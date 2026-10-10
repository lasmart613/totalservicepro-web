-- Expire pending invites for the removed member's auth.users email, and stop
-- client writes from treating user_profiles.email or a split active org as
-- identity.
--
-- remove_organization_member is the 000907 body with one change: member_email
-- comes from auth.users (SELECT email for the target id), compared with
-- lower(btrim()) = lower(btrim(invite.email)). user_profiles.email is no
-- longer the invite key. A profile email edit cannot keep a pending invite
-- alive or expire someone else's.
--
-- user_profiles_client_identity_guard is BEFORE INSERT OR UPDATE, SECURITY
-- INVOKER, so current_user is the caller. service_role returns immediately
-- and may set any email and any org pointers.
--
-- Authenticated/anon (and any other role, including postgres when a
-- SECURITY DEFINER function writes the row):
--   * An email change must equal auth.users.email for that id
--     (lower(btrim)). An unchanged email is left alone. INSERT may omit
--     email. Column UPDATE on email stays granted because set-password,
--     auth callback, and onboarding upsert user.email; a column REVOKE
--     would fail those writes even when the value matches. Live grants
--     (2026-10-10): authenticated has column UPDATE/INSERT on email and
--     no table-level UPDATE. RLS user_profiles_update_own is id = auth.uid().
--   * A change to active_organization_id must land on the same value as
--     organization_id in the new row (both columns may change together
--     when the new values are equal).
--   * A change to organization_id must not leave a non-null
--     active_organization_id pointing somewhere else. active NULL is
--     allowed on that path.
--
-- Client .update/.upsert of user_profiles does not send organization_id
-- or active_organization_id (profile, onboarding, callback, set-password).
-- Those columns are not in the authenticated UPDATE grant. Service-role
-- and SECURITY DEFINER writers set them to the same value, so this guard
-- allows them: setActiveOrganization, ensureTeamMemberProfile,
-- applyInviteToExistingUser, /api/org/leave (both NULL),
-- set_home_membership, switch_active_organization, leave_organization,
-- accept_team_invite, remove_organization_member.
--
-- sync_user_profile_email_from_auth copies auth.users.email onto
-- user_profiles when the auth email changes. It runs as the function
-- owner and writes the auth email, which this guard allows.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
--
-- When remove_organization_member moves user_profiles pointers to another
-- organization, set user_profiles.role from that membership. The previous
-- body called set_home_membership with profile sync off and left the old
-- role in place, so a company_admin removed from one shop kept company_admin
-- at the shop they landed on.
--
-- This matches live leave_organization (pg_get_functiondef on
-- yljztfajyvjzqikxdddf, 2026-10-10): if the profile role is platform admin,
-- keep admin; otherwise copy the next membership through
-- profile_role_from_membership. That mapper turns a membership role of
-- admin into company_admin and never returns platform admin. is_admin() is
-- exactly user_profiles.role = 'admin'. /api/god uses the auth allowlist
-- (isGodIdentity), not a membership role. Rewriting those profiles would
-- make is_admin() false, so this path leaves a platform admin role as it is
-- and never assigns admin.
--
-- leave_organization does not write a role when no membership remains
-- (it leaves the old role and returns null). A cleared profile here gets
-- fse, the least-privileged role on the ladder
-- (owner/customer > company_admin > service_manager >
-- billing_manager/dispatcher > fse) and the value
-- profile_role_from_membership uses for a blank role. fse is allowed by
-- user_profiles_role_check. Platform admin stays admin in that case too.
--
-- user_profiles_one_owner_per_organization is a partial unique index on
-- organization_id WHERE role = 'owner'. If the destination membership role
-- is owner and another profile is already owner of that org, raise before
-- any delete so the transaction writes nothing.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.remove_organization_member(
  p_user_id uuid,
  p_organization_id bigint,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  mem public.organization_memberships%ROWTYPE;
  org_created_by uuid;
  profile_org bigint;
  profile_active bigint;
  profile_json jsonb;
  profile_role text;
  member_email text;
  revoked_count integer := 0;
  founder_flag boolean;
  next_org bigint;
  next_membership_role text;
  next_profile_role text;
  home_moved_to bigint;
  profile_cleared boolean := false;
  deleted_count integer := 0;
  platform_admin boolean := false;
  pointers_follow boolean := false;
  mark_home boolean := false;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 400,
      'error', 'userId and organizationId are required.'
    );
  END IF;

  SELECT * INTO mem
  FROM public.organization_memberships
  WHERE user_id = p_user_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'not_member',
      'error', 'That person is not a member of this organization.'
    );
  END IF;

  IF p_actor_id IS NOT NULL AND p_actor_id = p_user_id THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'self',
      'error', 'You cannot remove yourself. Use Leave company instead.'
    );
  END IF;

  SELECT o.created_by INTO org_created_by
  FROM public.organizations o
  WHERE o.id = p_organization_id;

  SELECT p.organization_id, p.active_organization_id, to_jsonb(p), p.role
  INTO profile_org, profile_active, profile_json, profile_role
  FROM public.user_profiles p
  WHERE p.id = p_user_id;

  platform_admin := lower(btrim(COALESCE(profile_role, ''))) = 'admin';

  SELECT lower(btrim(u.email)) INTO member_email
  FROM auth.users u
  WHERE u.id = p_user_id;

  founder_flag :=
    lower(COALESCE(to_jsonb(mem)->>'is_founder', '')) IN ('true', 't', '1', 'yes')
    OR lower(COALESCE(to_jsonb(mem)->>'founder', '')) IN ('true', 't', '1', 'yes')
    OR lower(COALESCE(profile_json->>'is_founder', '')) IN ('true', 't', '1', 'yes')
    OR lower(COALESCE(profile_json->>'founder', '')) IN ('true', 't', '1', 'yes')
    OR (org_created_by IS NOT NULL AND mem.user_id = org_created_by);

  IF lower(btrim(COALESCE(mem.role, ''))) = 'owner'
     OR (
       profile_org IS NOT DISTINCT FROM p_organization_id
       AND lower(btrim(COALESCE(profile_json->>'role', ''))) = 'owner'
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'owner',
      'error', 'The organization owner cannot be removed.'
    );
  END IF;

  IF founder_flag THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'founder',
      'error', 'The organization founder cannot be removed.'
    );
  END IF;

  -- Pick the destination before deleting so an owner conflict raises
  -- with nothing written. Home moves to the latest other membership.
  -- A non-home delete follows the same pointer repair as before: remaining
  -- home, else that same latest-membership pick.
  IF mem.is_home THEN
    pointers_follow := true;
    SELECT m.organization_id, m.role
    INTO next_org, next_membership_role
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.organization_id IS DISTINCT FROM p_organization_id
    ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
    LIMIT 1
    FOR UPDATE;
    IF next_org IS NOT NULL THEN
      mark_home := true;
    END IF;
  ELSIF profile_org IS NOT DISTINCT FROM p_organization_id
     OR profile_active IS NOT DISTINCT FROM p_organization_id THEN
    pointers_follow := true;
    SELECT m.organization_id, m.role
    INTO next_org, next_membership_role
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.organization_id IS DISTINCT FROM p_organization_id
      AND m.is_home IS TRUE
    ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
    LIMIT 1
    FOR UPDATE;

    IF next_org IS NULL THEN
      SELECT m.organization_id, m.role
      INTO next_org, next_membership_role
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id
        AND m.organization_id IS DISTINCT FROM p_organization_id
      ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
      LIMIT 1
      FOR UPDATE;
      IF next_org IS NOT NULL THEN
        mark_home := true;
      END IF;
    END IF;
  END IF;

  IF pointers_follow AND next_org IS NOT NULL AND NOT platform_admin THEN
    next_profile_role := public.profile_role_from_membership(next_membership_role);
    IF lower(btrim(COALESCE(next_profile_role, ''))) = 'admin' THEN
      RAISE EXCEPTION 'remove_organization_member refused platform admin';
    END IF;
    IF lower(btrim(COALESCE(next_profile_role, ''))) = 'owner'
       AND EXISTS (
         SELECT 1
         FROM public.user_profiles other
         WHERE other.organization_id = next_org
           AND other.role = 'owner'
           AND other.id IS DISTINCT FROM p_user_id
         FOR UPDATE
       ) THEN
      RAISE EXCEPTION 'remove_organization_member refused owner role for organization %; that organization already has an owner profile', next_org;
    END IF;
  END IF;

  IF mem.is_home THEN
    DELETE FROM public.organization_memberships
    WHERE user_id = p_user_id
      AND organization_id = p_organization_id
      AND lower(btrim(role)) <> 'owner';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN
      RAISE EXCEPTION 'remove_organization_member deleted % home rows', deleted_count;
    END IF;
  ELSE
    DELETE FROM public.organization_memberships
    WHERE user_id = p_user_id
      AND organization_id = p_organization_id
      AND is_home = false
      AND lower(btrim(role)) <> 'owner';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN
      RAISE EXCEPTION 'remove_organization_member deleted % membership rows', deleted_count;
    END IF;
  END IF;

  IF pointers_follow THEN
    IF next_org IS NOT NULL THEN
      IF mark_home THEN
        PERFORM public.set_home_membership(p_user_id, next_org, NULL, false);
      END IF;
      UPDATE public.user_profiles
      SET
        organization_id = next_org,
        active_organization_id = next_org,
        role = CASE
          WHEN platform_admin THEN role
          ELSE next_profile_role
        END,
        updated_at = now()
      WHERE id = p_user_id;
      home_moved_to := next_org;
      profile_cleared := false;
    ELSE
      UPDATE public.user_profiles
      SET
        organization_id = NULL,
        active_organization_id = NULL,
        role = CASE
          WHEN platform_admin THEN role
          ELSE 'fse'
        END,
        updated_at = now()
      WHERE id = p_user_id;
      home_moved_to := NULL;
      profile_cleared := true;
    END IF;
  ELSE
    home_moved_to := NULL;
    profile_cleared := false;
  END IF;

  IF member_email IS NOT NULL AND member_email <> '' THEN
    UPDATE public.engineer_invitations AS i
    SET expires_at = now() - interval '1 second'
    WHERE i.organization_id = p_organization_id
      AND lower(btrim(i.email)) = member_email
      AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at);
    GET DIAGNOSTICS revoked_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'user_id', p_user_id,
    'organization_id', p_organization_id,
    'home_moved_to', home_moved_to,
    'profile_cleared', profile_cleared,
    'revoked_invite_count', revoked_count,
    'account_kept', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) TO service_role;

COMMENT ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) IS
  'Service-role only. Deletes one membership and expires pending invites for the auth.users email of that user in that org (lower(btrim) equality, not user_profiles.email). When profile pointers move, user_profiles.role becomes the destination membership role via profile_role_from_membership (membership admin becomes company_admin; platform admin is never granted). A profile role of admin is left unchanged. No remaining membership sets role fse unless the profile is platform admin. Raises, writing nothing, when the destination role is owner and that org already has an owner profile. Does not delete auth.users.';

-- Client writes. service_role is unrestricted. Runs before
-- user_profiles_guard_identity and user_profiles_sync_membership (name order)
-- so those triggers cannot hide a diverging active org or a forged email.
CREATE OR REPLACE FUNCTION public.user_profiles_client_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  auth_email text;
  email_changed boolean;
  active_changed boolean;
  org_changed boolean;
BEGIN
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    email_changed := lower(btrim(COALESCE(NEW.email, '')))
      IS DISTINCT FROM lower(btrim(COALESCE(OLD.email, '')));
  ELSE
    email_changed := NEW.email IS NOT NULL;
  END IF;

  IF email_changed THEN
    SELECT NULLIF(lower(btrim(u.email)), '') INTO auth_email
    FROM auth.users u
    WHERE u.id = NEW.id;

    IF auth_email IS NULL
       OR lower(btrim(COALESCE(NEW.email, ''))) IS DISTINCT FROM auth_email THEN
      RAISE EXCEPTION 'user_profiles.email must match the auth login email'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.active_organization_id IS NOT NULL
       AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'active_organization_id must match organization_id'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  active_changed := NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id;
  org_changed := NEW.organization_id IS DISTINCT FROM OLD.organization_id;

  IF active_changed
     AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'active_organization_id must match organization_id'
      USING ERRCODE = '42501';
  END IF;

  IF org_changed
     AND NEW.active_organization_id IS NOT NULL
     AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'organization_id must not leave active_organization_id pointing elsewhere'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_profiles_client_identity_guard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_profiles_client_identity_guard() TO authenticated, service_role;

COMMENT ON FUNCTION public.user_profiles_client_identity_guard() IS
  'BEFORE INSERT OR UPDATE, SECURITY INVOKER. service_role may set any email and any org pointers. Other callers may change user_profiles.email only to auth.users.email, and may not leave active_organization_id different from organization_id. active NULL is allowed when organization_id changes. An unchanged email is kept.';

DROP TRIGGER IF EXISTS user_profiles_client_identity_guard ON public.user_profiles;
CREATE TRIGGER user_profiles_client_identity_guard
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_client_identity_guard();

-- Keep the profile email aligned when the auth login email changes.
-- Writes the auth email, which the client guard allows for non-service roles.
CREATE OR REPLACE FUNCTION public.sync_user_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND lower(btrim(COALESCE(NEW.email, '')))
       IS NOT DISTINCT FROM lower(btrim(COALESCE(OLD.email, ''))) THEN
    RETURN NEW;
  END IF;

  UPDATE public.user_profiles
  SET
    email = NULLIF(lower(btrim(NEW.email)), ''),
    updated_at = now()
  WHERE id = NEW.id
    AND lower(btrim(COALESCE(email, ''))) IS DISTINCT FROM lower(btrim(COALESCE(NEW.email, '')));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_user_profile_email_from_auth() IS
  'AFTER INSERT OR UPDATE OF email on auth.users. Copies that login email onto user_profiles. Does not use user_profiles.email as an input.';

DROP TRIGGER IF EXISTS sync_user_profile_email ON auth.users;
CREATE TRIGGER sync_user_profile_email
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_profile_email_from_auth();
