-- Admin removal of one organization_memberships row, plus pending invites
-- for that email in that org, in a single transaction.
--
-- Owner, founder, and self are refused before any write. A home membership
-- of anyone else is removed:
--   * If another membership remains, home moves to the one with the latest
--     created_at. organization_id DESC breaks a tie (including NULL
--     created_at, which sorts last). set_home_membership marks that row
--     is_home and leaves its membership role alone (p_role NULL,
--     p_sync_profile false). user_profiles.organization_id and
--     active_organization_id then point at that org.
--   * If none remains, both pointers are set to NULL.
-- A non-home delete does the same pointer repair when either pointer still
-- equals the removed org. Live leave_organization retargets both columns
-- together when user_profiles.organization_id was the org just left, picks
-- the remaining row with is_home first, and clears both when nothing
-- remains. This function also retargets when only active_organization_id
-- still equals the removed org (RLS reads organization_id). The destination
-- is the remaining is_home membership. If none is home, the same latest
-- created_at / organization_id DESC pick is marked home with
-- set_home_membership. If nothing remains, both pointers become NULL.
-- If neither pointer equals the removed org, the profile is left alone.
-- Both columns are nullable. organization_id's foreign key is ON DELETE
-- SET NULL. active_organization_id has no foreign key.
-- profile_org_change_allowed treats NULL as allowed, and the identity
-- guard returns immediately when auth.uid() is null (service role).
-- user_profiles.role is not updated. user_profiles_role_check already
-- allows the current role with a null organization_id or a different org.
-- The partial unique index user_profiles_one_owner_per_organization does
-- not apply because owner targets are refused. p_sync_profile stays false
-- so profile_role_from_membership cannot rewrite a platform admin into
-- company_admin.
-- A signed-in user with no organization_id is sent to /onboarding by the
-- home dashboard and the auth callback. They are not left on a page that
-- assumes an org.
--
-- Pending means invitation_is_open (unaccepted and unexpired). Revoke sets
-- expires_at in the past. There is no revoked column. An accepted invite
-- is left accepted so a later invite can reopen it. auth.users is not
-- deleted. Other orgs' rows are not deleted.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- The migration runner applies this file as one transaction. Safe to re-run.
-- Until this function exists, POST /api/team/members/remove returns 503 and
-- writes nothing. Policy refusals (403) do not need the function.

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
  member_email text;
  revoked_count integer := 0;
  founder_flag boolean;
  next_org bigint;
  home_moved_to bigint;
  profile_cleared boolean := false;
  deleted_count integer := 0;
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

  SELECT p.organization_id, p.active_organization_id, to_jsonb(p), lower(btrim(p.email))
  INTO profile_org, profile_active, profile_json, member_email
  FROM public.user_profiles p
  WHERE p.id = p_user_id;

  IF member_email IS NULL OR member_email = '' THEN
    SELECT lower(btrim(u.email)) INTO member_email
    FROM auth.users u
    WHERE u.id = p_user_id;
  END IF;

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

  IF mem.is_home THEN
    -- Lock the destination before deleting home so the choice cannot move.
    SELECT m.organization_id INTO next_org
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.organization_id IS DISTINCT FROM p_organization_id
    ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
    LIMIT 1
    FOR UPDATE;

    DELETE FROM public.organization_memberships
    WHERE user_id = p_user_id
      AND organization_id = p_organization_id
      AND lower(btrim(role)) <> 'owner';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count <> 1 THEN
      RAISE EXCEPTION 'remove_organization_member deleted % home rows', deleted_count;
    END IF;

    IF next_org IS NOT NULL THEN
      PERFORM public.set_home_membership(p_user_id, next_org, NULL, false);
      UPDATE public.user_profiles
      SET
        organization_id = next_org,
        active_organization_id = next_org,
        updated_at = now()
      WHERE id = p_user_id;
      home_moved_to := next_org;
      profile_cleared := false;
    ELSE
      UPDATE public.user_profiles
      SET
        organization_id = NULL,
        active_organization_id = NULL,
        updated_at = now()
      WHERE id = p_user_id;
      home_moved_to := NULL;
      profile_cleared := true;
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
    IF profile_org IS NOT DISTINCT FROM p_organization_id
       OR profile_active IS NOT DISTINCT FROM p_organization_id THEN
      SELECT m.organization_id INTO next_org
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id
        AND m.is_home IS TRUE
      ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
      LIMIT 1
      FOR UPDATE;

      IF next_org IS NULL THEN
        SELECT m.organization_id INTO next_org
        FROM public.organization_memberships m
        WHERE m.user_id = p_user_id
        ORDER BY m.created_at DESC NULLS LAST, m.organization_id DESC
        LIMIT 1
        FOR UPDATE;
        IF next_org IS NOT NULL THEN
          PERFORM public.set_home_membership(p_user_id, next_org, NULL, false);
        END IF;
      END IF;

      IF next_org IS NOT NULL THEN
        UPDATE public.user_profiles
        SET
          organization_id = next_org,
          active_organization_id = next_org,
          updated_at = now()
        WHERE id = p_user_id;
        home_moved_to := next_org;
        profile_cleared := false;
      ELSE
        UPDATE public.user_profiles
        SET
          organization_id = NULL,
          active_organization_id = NULL,
          updated_at = now()
        WHERE id = p_user_id;
        home_moved_to := NULL;
        profile_cleared := true;
      END IF;
    ELSE
      home_moved_to := NULL;
      profile_cleared := false;
    END IF;
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
  'Service-role only. Deletes one membership and expires pending invites for that email in that org. Retargets user_profiles.organization_id and active_organization_id when either still names the removed org: remaining home, else the latest other membership via set_home_membership, else NULL. Does not change user_profiles.role or delete auth.users.';
