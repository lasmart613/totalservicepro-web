-- Rollback for 000965. Restores the functions this migration replaced
-- and drops the seat helpers. Does not change membership rows.
--
-- user_profiles_sync_membership is the live body from
-- 20261009_000904_one_home_membership.sql (nothing after 000904 replaced it).
-- membership_insert_allowed is the live body from
-- 20261015_000917_customer_org_atomic_founder_block.sql. 000904 did not
-- define that function. Restoring an older copy would undo the 000916 and
-- 000917 founder-claim checks, so the rollback puts back the definition
-- that is live immediately before 000965.
--
-- Roll the app back first (or together): the invite API in this change
-- counts open invites, and the database functions stop enforcing the cap.
-- Drops organization_memberships_enforce_seat_cap before restoring the
-- live functions, so a new insert is not checked after this file commits.
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS organization_memberships_enforce_seat_cap ON public.organization_memberships;
DROP FUNCTION IF EXISTS public.organization_memberships_enforce_seat_cap();

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

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        -- Founder of a brand-new org only: a creator can't join a customer
        -- org that a shop already serves, that already has members, or that a
        -- shop user created (000917).
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id
            AND o.created_by = auth.uid()
            AND public.org_founder_claim_allowed(o.id)
        )
        AND lower(btrim(coalesce(p_role, ''))) IN (
          public.founder_role_for_org(p_organization_id),
          'fse', 'engineer', 'technician'
        )
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND lower(btrim(coalesce(p_role, ''))) <> 'admin'
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(btrim(coalesce(p_role, ''))) = public.profile_role_from_membership(
              coalesce(NULLIF(TRIM(i.role), ''), 'fse')
            )
        )
      )
    );
$function$;

COMMENT ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) IS
  'Client membership insert: own shop at the founder role for that org type (never platform admin), or an unexpired unaccepted invite whose role matches after admin is mapped to company_admin. NULL expires_at is open only when created_at is within 14 days. Invite inserts cannot set is_home.';

DROP FUNCTION IF EXISTS public.org_membership_seat_allows(bigint, uuid);
DROP FUNCTION IF EXISTS public.org_seat_limit(bigint);

COMMIT;
