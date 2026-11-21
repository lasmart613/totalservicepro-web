-- 000966: follow-ups to the seat cap. Does not change seat numbers.
--
-- 1. The no-JWT catch in user_profiles_sync_membership only applies to
--    INSERT. A service-role UPDATE that would move a profile onto a full
--    org raises, so organization_id and active_organization_id stay put.
--    A signup INSERT into a full org still keeps the new profile and skips
--    the membership.
-- 2. trg_zz_enforce_seat_cap returns NEW when an authenticated caller fails
--    membership_insert_allowed. Row-level security then denies that insert
--    with the same text whether the org is full or empty. Service role
--    still gets the generic refusal, because it bypasses row-level security.
--
-- Does not sweep existing memberships. claim_team_invite_seat deletes only
-- the membership the caller is leaving, and only after the new row exists.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Rollback: 20261119_000966_seat_cap_followups_rollback.sql restores the
-- 000965 bodies of these two functions and drops claim_team_invite_seat.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.organization_memberships_enforce_seat_cap()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'organization seat limit could not be checked'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tsp.org_seat:' || NEW.organization_id::text, 0)
  );
  -- An authenticated caller who is not allowed to insert still takes this
  -- lock and the seat check. Row-level security does not apply inside a
  -- SECURITY DEFINER writer (the profile trigger inserts as its owner), so
  -- returning NEW without the check let a creator rejoin a full org.
  -- When the org is full, raise the same text row-level security uses, so a
  -- stranger sees identical bytes under the cap and at the cap. When a seat
  -- is free, return NEW and let row-level security deny a stranger.
  IF auth.uid() IS NOT NULL
     AND NOT public.membership_insert_allowed(NEW.user_id, NEW.organization_id, NEW.role, NEW.is_home) THEN
    BEGIN
      PERFORM public.org_membership_seat_allows(NEW.organization_id, NEW.user_id, false);
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION 'new row violates row-level security policy for table "organization_memberships"'
          USING ERRCODE = '42501';
    END;
    RETURN NEW;
  END IF;
  PERFORM public.org_membership_seat_allows(NEW.organization_id, NEW.user_id, false);
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.organization_memberships_enforce_seat_cap() IS
  '000966 BEFORE INSERT. Locks the org, then refuses a new member at org_seat_limit. An authenticated caller who fails membership_insert_allowed still takes that lock: a full org raises the row-level security text, a free seat returns NEW. Service role still gets a generic refusal with no count and no plan.';

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

  -- Service role / SECURITY DEFINER caller with no JWT user. Trusted for
  -- roles, not for skipping the seat cap.
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
    -- Signup INSERT (auth.users → profile, no JWT) must not be rolled back
    -- when the invited org is already full. Keep that new profile and skip
    -- the seat. An UPDATE that would point an existing profile at a full org
    -- raises, so organization_id and active_organization_id stay where they were.
    BEGIN
      PERFORM public.org_membership_seat_allows(NEW.organization_id, NEW.id, true);
    EXCEPTION
      WHEN check_violation THEN
        IF SQLERRM ILIKE '%could not be checked%' OR TG_OP <> 'INSERT' THEN
          RAISE;
        END IF;
        RAISE NOTICE '000966: seat cap full; kept new profile % without a membership in org %',
          NEW.id, NEW.organization_id;
        IF NEW.active_organization_id IS NULL THEN
          NEW.active_organization_id := NEW.organization_id;
        END IF;
        RETURN NEW;
    END;
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

  PERFORM public.org_membership_seat_allows(NEW.organization_id, NEW.id, true);
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
  'BEFORE INSERT/UPDATE. Client org changes require creator, existing membership, or an unaccepted invite for auth.users email. A service-role INSERT into a full org keeps the new profile and skips the membership (000966). A service-role UPDATE onto a full org raises, so the previous organization_id stays.';

-- Claim join: insert the new membership, drop the old one, and accept the
-- invite in one transaction. The seat trigger locks the org on the insert.
-- If that insert is refused, this function raises and the delete and the
-- accept never happen.
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
    UPDATE public.engineer_invitations
    SET accepted = true,
        accepted_at = pg_catalog.now()
    WHERE id = p_invite_id
      AND organization_id = p_organization_id
      AND accepted IS NOT TRUE;
    GET DIAGNOSTICS accepted_rows = ROW_COUNT;
    IF accepted_rows <> 1 THEN
      RAISE EXCEPTION 'invite was not accepted' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) IS
  '000966: seat a claimed invite. Insert (under the org seat lock), then delete the membership being left, then mark the invite accepted. A refused insert rolls all of it back.';

REVOKE ALL ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_team_invite_seat(uuid, bigint, text, boolean, boolean, bigint, bigint) TO service_role;

COMMIT;
