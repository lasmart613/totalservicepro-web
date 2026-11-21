-- 000967: claim_team_invite_seat may accept only an invite whose email
-- matches auth.users.email for p_user_id. Trimmed and case-insensitive.
-- Checked inside the existing per-org seat lock, on the accept update and
-- on the already-accepted success path. A mismatch raises the same generic
-- refusal, so the insert and the leave delete roll back.
-- Signature is unchanged. EXECUTE stays service_role only.
-- Does not change membership rows.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Rollback: 20261120_000967_claim_invite_owner_check_rollback.sql restores
-- the 000966 function byte for byte.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.claim_team_invite_seat(
  p_user_id uuid,
  p_organization_id bigint,
  p_role text,
  p_is_home boolean,
  p_sync_profile boolean,
  p_leave_organization_id bigint,
  p_invite_id bigint
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  accepted_rows integer;
  already_member boolean;
  caller_email text;
  invite_email text;
  owns_invite boolean;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'claim requires a user and an organization' USING ERRCODE = '22023';
  END IF;
  IF p_leave_organization_id IS NOT NULL AND p_leave_organization_id = p_organization_id THEN
    RAISE EXCEPTION 'cannot leave the organization being joined' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.org_seat:' || p_organization_id::text, 0)
  );

  -- After the lock, a concurrent claim by this same user has committed.
  -- Checked before the insert so a stranger is not counted as already seated.
  already_member := EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.organization_id = p_organization_id
  );

  IF COALESCE(p_is_home, false) THEN
    PERFORM public.set_home_membership(
      p_user_id,
      p_organization_id,
      p_role,
      COALESCE(p_sync_profile, false)
    );
  ELSE
    INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
    VALUES (
      p_user_id,
      p_organization_id,
      COALESCE(NULLIF(pg_catalog.btrim(p_role), ''), 'fse'),
      false
    )
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  IF p_leave_organization_id IS NOT NULL THEN
    DELETE FROM public.organization_memberships
    WHERE user_id = p_user_id
      AND organization_id = p_leave_organization_id;
  END IF;

  IF p_invite_id IS NOT NULL THEN
    -- Invite email must be this caller's auth.users email. Empty and
    -- missing rows fail closed. Both the accept and the repeat path use it.
    caller_email := NULL;
    invite_email := NULL;
    SELECT pg_catalog.lower(pg_catalog.btrim(coalesce(u.email, '')))
      INTO caller_email
    FROM auth.users u
    WHERE u.id = p_user_id;
    SELECT pg_catalog.lower(pg_catalog.btrim(coalesce(i.email, '')))
      INTO invite_email
    FROM public.engineer_invitations i
    WHERE i.id = p_invite_id
      AND i.organization_id = p_organization_id;
    owns_invite := coalesce(caller_email, '') <> ''
      AND caller_email = invite_email;

    UPDATE public.engineer_invitations
    SET accepted = true,
        accepted_at = pg_catalog.now()
    WHERE id = p_invite_id
      AND organization_id = p_organization_id
      AND accepted IS NOT TRUE
      AND owns_invite
      AND pg_catalog.lower(pg_catalog.btrim(coalesce(email, ''))) = caller_email;
    GET DIAGNOSTICS accepted_rows = ROW_COUNT;
    IF accepted_rows <> 1 THEN
      -- Same caller, same org, invite already accepted: the first claim won.
      -- The email match is required here too, or another member's invite
      -- would let this leave-org delete commit.
      IF already_member AND owns_invite AND EXISTS (
        SELECT 1
        FROM public.engineer_invitations i
        JOIN auth.users u ON u.id = p_user_id
        WHERE i.id = p_invite_id
          AND i.organization_id = p_organization_id
          AND i.accepted IS TRUE
          AND pg_catalog.lower(pg_catalog.btrim(coalesce(u.email, ''))) <> ''
          AND pg_catalog.lower(pg_catalog.btrim(coalesce(u.email, '')))
            = pg_catalog.lower(pg_catalog.btrim(coalesce(i.email, '')))
      ) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'invite was not accepted' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) IS
  '000967: seat a claimed invite under the org seat lock. The invite email must match auth.users.email for p_user_id, trimmed and case-insensitive, both when accepting it and when a repeat finds it already accepted. A mismatch raises invite was not accepted and rolls the claim back.';

REVOKE ALL ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) TO service_role;

COMMIT;
