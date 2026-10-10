-- Rollback for 20261010_000907_remove_organization_member_profile_role.sql.
-- Restores public.remove_organization_member(uuid, bigint, uuid) from
-- pg_get_functiondef on project yljztfajyvjzqikxdddf on 2026-10-10, the
-- definition applied by 20261009_000905. The function body is that live
-- text. The header matches pg_get_functiondef (search_path TO, $function$).
-- Does not restore memberships, invites, or profile rows already changed.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.remove_organization_member(p_user_id uuid, p_organization_id bigint, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

COMMENT ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) IS
  'Service-role only. Deletes one membership and expires pending invites for that email in that org. Retargets user_profiles.organization_id and active_organization_id when either still names the removed org: remaining home, else the latest other membership via set_home_membership, else NULL. Does not change user_profiles.role or delete auth.users.';

REVOKE ALL ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) TO service_role;
