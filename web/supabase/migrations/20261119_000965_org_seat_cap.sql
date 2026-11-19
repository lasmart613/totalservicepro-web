-- 000965: seat cap on membership writes that skipped the app check.
--
-- user_profiles_sync_membership (live body from 000904, SECURITY DEFINER)
-- inserts organization_memberships when a profile's organization changes,
-- with no seat check. A profile write can put a company over its plan seats.
-- membership_insert_allowed (live body from 000917) is the client INSERT
-- policy check and has the same hole on the founder and invite branches.
--
-- Both now use org_seat_limit(), a SQL port of web/lib/org-plan.ts
-- orgSeatLimit:
--   Team or Enterprise by exact plan/subscription_tier name, still paid,
--   and not an expired complimentary window: 10 seats.
--   Everything else is 1 seat. That includes Free, paid Premium, and
--   complimentary Premium (is_premium / premium_until still in the future,
--   plan not team or enterprise). "pro" is not a paid name.
-- An expired complimentary window (premium_until <= now) is 1 seat even
-- when the tier name still says team. premium_grant is not part of the
-- limit, matching the app.
--
-- A person who already has a membership row is allowed through, so an org
-- that is already over its cap keeps every member. This file does not
-- DELETE or UPDATE any membership. It only refuses a new row.
-- If the organization cannot be read, the check raises. It does not assume
-- a limit and let the row in.
--
-- Open invites are not counted here. Counting them would block the invitee
-- from accepting the seat the invite already reserved. The invite API
-- counts unaccepted, unexpired invites when the invite is created.
--
-- New helpers are not SECURITY DEFINER and are not granted to client
-- roles. The two functions that already were SECURITY DEFINER call them,
-- so the member count is not filtered by the caller's RLS.
-- search_path is pinned. row_security is off on the helpers so a partial
-- RLS view cannot under-count and let another seat in; a policy that
-- would hide rows makes the check fail instead.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- One transaction. Safe to re-run.
-- Rollback: 20261119_000965_org_seat_cap_rollback.sql
-- restores the live 000904 user_profiles_sync_membership and the live
-- 000917 membership_insert_allowed (000904 did not define that function).

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.org_seat_limit(p_org bigint)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
SET row_security = off
AS $function$
  -- NULL when the org row is missing. Callers must fail closed on NULL.
  -- 1:1 with orgSeatLimit() in web/lib/org-plan.ts (SOLO 1, TEAM 10).
  SELECT (
    SELECT CASE
      WHEN (
        CASE
          WHEN o.premium_until IS NOT NULL AND o.premium_until <= pg_catalog.now()
            THEN lower(pg_catalog.btrim(coalesce(o.subscription_tier, ''))) IN ('premium', 'team', 'enterprise')
              OR lower(pg_catalog.btrim(coalesce(o.plan, ''))) IN ('premium', 'team', 'enterprise')
          ELSE o.is_premium IS TRUE
            OR lower(pg_catalog.btrim(coalesce(o.subscription_tier, ''))) IN ('premium', 'team', 'enterprise')
            OR lower(pg_catalog.btrim(coalesce(o.plan, ''))) IN ('premium', 'team', 'enterprise')
        END
      )
      AND (
        lower(pg_catalog.btrim(coalesce(o.subscription_tier, ''))) IN ('team', 'enterprise')
        OR lower(pg_catalog.btrim(coalesce(o.plan, ''))) IN ('team', 'enterprise')
      )
      AND NOT (o.premium_until IS NOT NULL AND o.premium_until <= pg_catalog.now())
      THEN 10
      ELSE 1
    END
    FROM public.organizations o
    WHERE o.id = p_org
  );
$function$;

COMMENT ON FUNCTION public.org_seat_limit(bigint) IS
  '000965: SQL port of lib/org-plan.ts orgSeatLimit. Team/Enterprise 10; Free, Premium, and complimentary Premium 1. NULL if the org row is missing. Expired complimentary (premium_until <= now) is 1 even when the tier name is team.';

CREATE OR REPLACE FUNCTION public.org_membership_seat_allows(p_org bigint, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  lim integer;
  used integer;
BEGIN
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'organization seat limit could not be checked'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Already on the team: an over-cap org keeps this person. No new row.
  IF p_user IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_org
      AND m.user_id = p_user
  ) THEN
    RETURN true;
  END IF;

  lim := public.org_seat_limit(p_org);
  IF lim IS NULL THEN
    RAISE EXCEPTION 'organization seat limit could not be checked'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer INTO used
  FROM public.organization_memberships m
  WHERE m.organization_id = p_org;

  IF coalesce(used, 0) >= lim THEN
    IF lim >= 10 THEN
      RAISE EXCEPTION 'You''re using % of % seats — contact us for more.', used, lim
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'You''re using % of % % — upgrade to Team to add more people.',
      used,
      lim,
      CASE WHEN lim = 1 THEN 'seat' ELSE 'seats' END
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN true;
END;
$function$;

COMMENT ON FUNCTION public.org_membership_seat_allows(bigint, uuid) IS
  '000965: true when p_user may gain a new membership in p_org. Raises when the org is missing or already at org_seat_limit. Does not remove anyone.';

REVOKE ALL ON FUNCTION public.org_seat_limit(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_membership_seat_allows(bigint, uuid) FROM PUBLIC, anon, authenticated;

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
    IF NOT public.org_membership_seat_allows(NEW.organization_id, NEW.id) THEN
      RAISE EXCEPTION 'organization seat limit could not be checked'
        USING ERRCODE = 'check_violation';
    END IF;
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

  IF NOT public.org_membership_seat_allows(NEW.organization_id, NEW.id) THEN
    RAISE EXCEPTION 'organization seat limit could not be checked'
      USING ERRCODE = 'check_violation';
  END IF;
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
  'BEFORE INSERT/UPDATE. Client org changes require creator, existing membership, or an unaccepted invite for auth.users email. Membership role comes from that invite or the existing membership, never from an elevated self-assigned role. Service role (auth.uid() IS NULL) may write founder roles. A service-role profile or org switch sets is_home true only when the user has no home row. It does not move an existing home. Founder and create-org use set_home_membership. A new membership is refused at org_seat_limit (000965). Existing members stay.';

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(p_user_id uuid, p_organization_id bigint, p_role text, p_is_home boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN (
      p_user_id IS NOT DISTINCT FROM auth.uid()
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
      )
    )
    -- Seat check only after the insert would otherwise be allowed, so a
    -- stranger still gets the RLS denial and not a seat-count error.
    -- Raises when the org is at cap or the cap cannot be read.
    THEN public.org_membership_seat_allows(p_organization_id, p_user_id)
    ELSE false
  END;
$function$;

COMMENT ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) IS
  'Client membership insert: own shop at the founder role for that org type (never platform admin), or an unexpired unaccepted invite whose role matches after admin is mapped to company_admin. NULL expires_at is open only when created_at is within 14 days. Invite inserts cannot set is_home. A new row is refused at org_seat_limit (000965). Existing members are not removed.';
