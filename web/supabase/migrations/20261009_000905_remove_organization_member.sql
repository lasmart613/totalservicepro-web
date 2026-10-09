-- Admin removal of one organization_memberships row, plus pending invites
-- for that email in that org, in a single transaction.
--
-- Does not change user_profiles, auth.users, is_home, or any other org.
-- Home, owner, and founder rows are refused
-- before the delete. Pending means invitation_is_open (unaccepted and unexpired).
-- Revoke sets expires_at in the past. There is no revoked column.
-- An accepted invite is left accepted so a later invite can reopen it.
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
  profile_json jsonb;
  member_email text;
  revoked_count integer := 0;
  founder_flag boolean;
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

  SELECT p.organization_id, to_jsonb(p), lower(btrim(p.email))
  INTO profile_org, profile_json, member_email
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
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'home',
      'error', 'A home membership cannot be removed.'
    );
  END IF;

  DELETE FROM public.organization_memberships
  WHERE user_id = p_user_id
    AND organization_id = p_organization_id
    AND is_home = false
    AND lower(btrim(role)) <> 'owner';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'code', 'not_member',
      'error', 'That person is not a member of this organization.'
    );
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
    'profile_still_points_here', profile_org IS NOT DISTINCT FROM p_organization_id,
    'revoked_invite_count', revoked_count,
    'account_kept', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) TO service_role;

COMMENT ON FUNCTION public.remove_organization_member(uuid, bigint, uuid) IS
  'Service-role only. Deletes one non-home membership and expires pending invites for that email in that org. Does not update user_profiles or delete auth.users.';
