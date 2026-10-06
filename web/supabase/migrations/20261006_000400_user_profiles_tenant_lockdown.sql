-- Block cross-tenant org/role self-assignment on user_profiles.
--
-- Live hole: anon/authenticated can UPDATE user_profiles.role,
-- organization_id, and active_organization_id. RLS is only id = auth.uid().
-- user_profiles_sync_membership (SECURITY DEFINER) then INSERTs an
-- organization_memberships row for whatever organization_id the user set,
-- downgrading admin/company_admin but letting owner and other roles through.
--
-- This file is idempotent. Apply it in the Supabase SQL editor or CLI.
-- The only row rewrite is organization_memberships.role 'admin' ->
-- 'company_admin' (platform admin must not come from a membership).
-- It does not UPDATE or DELETE customer, invoice, or profile rows.
--
-- Sweep (repo migrations + generated types; privilege columns vs own-row writes):
--   user_profiles              FIXED  column UPDATE/INSERT revoked; trigger raises
--   organization_memberships   FIXED  UPDATE/DELETE revoked; invite role must match
--   organizations              FIXED  drop USING(true) writes; block plan/created_by
--   engineer_invitations       FIXED  RLS; cannot retarget email/org/role
--   subscriptions              FIXED  writes revoked from anon/authenticated
--   service_requests, equipment, purchase_orders, test_equipment,
--   marketplace_*, bids, contacts, locations, service_reports
--                              CHECKED  organization_id is the caller's existing
--                              shop via get_my_org_id()/membership, not a
--                              self-serve join of a different tenant. Left in place.
--   get_my_org_id()            REVIEWED  still reads user_profiles.organization_id
--                              because claimed clinic owners are linked only by
--                              that column (created_by stays the service company).
--                              Clients can no longer write the column. search_path
--                              tightened. Do not require a membership row here or
--                              those owners lose their facility.

-- ---------------------------------------------------------------------------
-- 1) Login email. search_path includes pg_temp.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_login_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(lower(btrim(u.email)), '')
  FROM auth.users AS u
  WHERE u.id = auth.uid();
$$;

COMMENT ON FUNCTION public.auth_login_email() IS
  'Lowercased auth.users.email for auth.uid(). Never user_profiles.email.';

REVOKE ALL ON FUNCTION public.auth_login_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_login_email() TO authenticated;

-- NULL expires_at is expired unless created_at is within the last 14 days.
-- A row with both expires_at and created_at NULL is expired.
-- accepted = true is never open.
CREATE OR REPLACE FUNCTION public.invitation_is_open(
  p_accepted boolean,
  p_expires_at timestamptz,
  p_created_at timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(p_accepted, false) = false
    AND (
      (p_expires_at IS NOT NULL AND p_expires_at > now())
      OR (
        p_expires_at IS NULL
        AND p_created_at IS NOT NULL
        AND p_created_at > (now() - interval '14 days')
      )
    );
$$;

COMMENT ON FUNCTION public.invitation_is_open(boolean, timestamptz, timestamptz) IS
  'Unaccepted invite that has not expired. NULL expires_at counts only when created_at is within 14 days; otherwise it is expired.';

REVOKE ALL ON FUNCTION public.invitation_is_open(boolean, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invitation_is_open(boolean, timestamptz, timestamptz) TO authenticated;

-- Org-level membership role 'admin' is company_admin on the profile.
-- is_admin() is user_profiles.role = 'admin' and must not follow a membership.
CREATE OR REPLACE FUNCTION public.profile_role_from_membership(p_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN lower(btrim(coalesce(p_role, ''))) = 'admin' THEN 'company_admin'
    WHEN nullif(btrim(p_role), '') IS NULL THEN 'fse'
    ELSE btrim(p_role)
  END;
$$;

COMMENT ON FUNCTION public.profile_role_from_membership(text) IS
  'Role copied from organization_memberships or an invite onto user_profiles. admin becomes company_admin. Never grants platform admin.';

REVOKE ALL ON FUNCTION public.profile_role_from_membership(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_role_from_membership(text) TO authenticated;

-- Replaces 20261006030456_hotfix_user_profiles_guard_identity_20261005. NULL expires_at follows invitation_is_open (14 days),
-- not the hotfix's "null expires_at is open forever".
CREATE OR REPLACE FUNCTION public.profile_org_change_allowed(p_uid uuid, p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT p_org IS NULL
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_org AND o.created_by = p_uid
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = p_uid AND m.organization_id = p_org
    )
    OR EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = p_org
        AND public.auth_login_email() IS NOT NULL
        AND lower(btrim(i.email)) = public.auth_login_email()
        AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
    );
$$;

COMMENT ON FUNCTION public.profile_org_change_allowed(uuid, bigint) IS
  'Profile may take this org: null, creator, member, or an open invite for the signed-in email. NULL expires_at is open only when created_at is within 14 days.';

REVOKE ALL ON FUNCTION public.profile_org_change_allowed(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_org_change_allowed(uuid, bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) New-user trigger: metadata cannot mint an org or an elevated role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  org_id bigint;
  urole text;
  invited boolean;
  meta_org text;
BEGIN
  org_id := NULL;
  urole := NULL;
  invited := lower(COALESCE(NEW.raw_user_meta_data->>'invited_member', '')) IN ('true', 't', '1');
  meta_org := NEW.raw_user_meta_data->>'organization_id';

  IF invited
     AND NEW.email_confirmed_at IS NOT NULL
     AND meta_org IS NOT NULL
     AND meta_org ~ '^[0-9]+$'
     AND EXISTS (
       SELECT 1
       FROM public.engineer_invitations i
       WHERE i.organization_id = meta_org::bigint
         AND lower(btrim(i.email)) = lower(btrim(NEW.email))
         AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
     ) THEN
    org_id := meta_org::bigint;
    SELECT public.profile_role_from_membership(COALESCE(NULLIF(TRIM(i.role), ''), 'fse'))
      INTO urole
    FROM public.engineer_invitations i
    WHERE i.organization_id = org_id
      AND lower(btrim(i.email)) = lower(btrim(NEW.email))
      AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
    ORDER BY i.created_at DESC NULLS LAST, i.id DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.user_profiles (
    id, email, first_name, last_name, role, organization_id, job_title, onboarding_completed
  ) VALUES (
    NEW.id,
    LOWER(NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
    urole,
    org_id,
    NULLIF(NEW.raw_user_meta_data->>'job_title', ''),
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.user_profiles.email),
    first_name = COALESCE(EXCLUDED.first_name, public.user_profiles.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.user_profiles.last_name),
    job_title = COALESCE(EXCLUDED.job_title, public.user_profiles.job_title);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Creates user_profiles. An invite-based org and role are copied only when NEW.email_confirmed_at is set and the invite is open. Not attached to auth.users: signup and team join go through /api/auth/signup and /api/team/claim. Do not recreate on_auth_user_created in this security migration.';

-- Do not drop on_auth_user_created here. The live apply of this file left that
-- line out, so a replay must match what ran. Signup does not use the trigger.

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3) Active-org helper. Same result as before; clients cannot write the column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT organization_id
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_org_id() IS
  'Active org from user_profiles.organization_id. Safe only because authenticated/anon cannot UPDATE that column (20261006 tenant lockdown). Claimed clinic owners have no organization_memberships row and no created_by match; do not add that requirement here.';

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    org_id IS NOT NULL
    AND (
      org_id = (SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1)
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = org_id AND o.created_by = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_my_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_owns_or_created_org(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_or_created_org(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Guard + membership sync.
--    user_profiles_guard_identity replaces the 20261006030456 hotfix (same
--    trigger name, so it still sorts before user_profiles_sync_membership).
--    The trigger function is SECURITY INVOKER. current_user not in
--    (authenticated, anon) returns NEW. That is the hotfix bypass.
--    auth.uid() IS NULL is not equivalent: SECURITY DEFINER functions run as
--    postgres while auth.uid() stays the JWT user, so accept_team_invite,
--    switch_active_organization, and leave_organization would be policed by
--    an auth.uid() check and blocked by a DEFINER guard's current_user check
--    (current_user would always be the owner). Those three keep their own
--    role mapping, including preserving profile role admin.
--    Client checks run in a DEFINER helper so RLS does not hide invitations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity_enforce(
  p_op text,
  new_row public.user_profiles,
  old_row public.user_profiles
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  actor uuid;
  own_created boolean;
  member_of_new boolean;
  member_role text;
  elevated text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager', 'crm'
  ];
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN;
  END IF;

  IF p_op = 'INSERT' AND new_row.id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'user_profiles insert must be your own row';
  END IF;

  IF p_op = 'UPDATE' AND new_row.id IS DISTINCT FROM old_row.id THEN
    RAISE EXCEPTION 'user_profiles id cannot be changed';
  END IF;

  IF lower(coalesce(new_row.role, '')) = 'admin'
     AND (p_op = 'INSERT' OR lower(coalesce(old_row.role, '')) <> 'admin') THEN
    RAISE EXCEPTION 'Not allowed to set this role' USING ERRCODE = '42501';
  END IF;

  IF (p_op = 'INSERT' OR new_row.organization_id IS DISTINCT FROM old_row.organization_id)
     AND NOT public.profile_org_change_allowed(new_row.id, new_row.organization_id) THEN
    RAISE EXCEPTION 'Not a member of that organization' USING ERRCODE = '42501';
  END IF;

  IF (p_op = 'INSERT' OR new_row.active_organization_id IS DISTINCT FROM old_row.active_organization_id)
     AND NOT public.profile_org_change_allowed(new_row.id, new_row.active_organization_id) THEN
    RAISE EXCEPTION 'Not a member of that organization' USING ERRCODE = '42501';
  END IF;

  IF p_op = 'UPDATE'
     AND new_row.active_organization_id IS DISTINCT FROM old_row.active_organization_id
     AND new_row.active_organization_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = new_row.active_organization_id
     )
     AND new_row.active_organization_id IS DISTINCT FROM new_row.organization_id THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF p_op = 'INSERT'
     AND new_row.active_organization_id IS NOT NULL
     AND new_row.active_organization_id IS DISTINCT FROM new_row.organization_id
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = new_row.active_organization_id
     ) THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF (p_op = 'INSERT' AND new_row.organization_id IS NOT NULL)
     OR (p_op = 'UPDATE' AND new_row.organization_id IS DISTINCT FROM old_row.organization_id AND new_row.organization_id IS NOT NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = new_row.organization_id AND o.created_by = actor
    ) INTO own_created;
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = new_row.organization_id
    ) INTO member_of_new;
    IF own_created AND NOT member_of_new AND lower(COALESCE(new_row.role, '')) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
  END IF;

  IF (p_op = 'UPDATE' AND new_row.role IS DISTINCT FROM old_row.role)
     OR p_op = 'INSERT' THEN
    IF lower(COALESCE(new_row.role, '')) = ANY (elevated) THEN
      SELECT m.role INTO member_role
      FROM public.organization_memberships m
      WHERE m.user_id = actor
        AND m.organization_id = COALESCE(new_row.organization_id, CASE WHEN p_op = 'UPDATE' THEN old_row.organization_id ELSE NULL END)
      LIMIT 1;
      IF member_role IS NULL
         OR lower(public.profile_role_from_membership(member_role)) IS DISTINCT FROM lower(btrim(new_row.role)) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = new_row.organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND public.invitation_is_open(i.accepted, i.expires_at, i.created_at)
            AND lower(public.profile_role_from_membership(COALESCE(i.role, ''))) = lower(btrim(new_row.role))
        ) THEN
          RAISE EXCEPTION 'cannot self-assign an elevated role';
        END IF;
      END IF;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.user_profiles_guard_identity_enforce(text, public.user_profiles, public.user_profiles) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_profiles_guard_identity_enforce(text, public.user_profiles, public.user_profiles) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM public.user_profiles_guard_identity_enforce(TG_OP, NEW, OLD);
  ELSE
    PERFORM public.user_profiles_guard_identity_enforce(TG_OP, NEW, NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.user_profiles_guard_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_profiles_guard_identity() TO authenticated, service_role;

COMMENT ON FUNCTION public.user_profiles_guard_identity() IS
  'BEFORE INSERT/UPDATE, SECURITY INVOKER. Client roles cannot self-join another tenant, newly set role admin, or self-assign an elevated role. current_user outside authenticated/anon (service role and SECURITY DEFINER callers) passes. auth.uid() IS NULL is not the bypass.';

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
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by IS NOT DISTINCT FROM NEW.id
    ) INTO own_created;
    home := own_created;
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
  'BEFORE INSERT/UPDATE. Client org changes require creator, existing membership, or an unaccepted invite for auth.users email. Membership role comes from that invite or the existing membership, never from an elevated self-assigned role. Service role (auth.uid() IS NULL) may write founder roles.';

DROP TRIGGER IF EXISTS user_profiles_guard_identity ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_identity
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_guard_identity();

DROP TRIGGER IF EXISTS user_profiles_sync_membership ON public.user_profiles;
CREATE TRIGGER user_profiles_sync_membership
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_sync_membership();

-- ---------------------------------------------------------------------------
-- 5) Column privileges. Table UPDATE/INSERT revoked, then safe columns only.
--    Safe list is what the web client still writes itself (name, phone, avatar,
--    onboarding flags, address). role / organization_id / active_organization_id
--    / additional_roles stay revoked. There is no locale column on this table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  safe_cols text[] := ARRAY[
    'id', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'avatar_url', 'bio',
    'address_line1', 'city', 'state', 'postal_code', 'website', 'linkedin_url',
    'emergency_contact_name', 'emergency_contact_phone', 'certifications',
    'experience_years', 'notification_prefs', 'preferred_regions', 'territory',
    'onboarding_completed', 'onboarding_completed_at', 'signature_data', 'updated_at'
  ];
  present text[];
  col text;
  list text;
BEGIN
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_profiles FROM PUBLIC;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_profiles FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_profiles FROM authenticated;

  present := ARRAY[]::text[];
  FOREACH col IN ARRAY safe_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = col
    ) THEN
      present := array_append(present, format('%I', col));
    END IF;
  END LOOP;

  IF coalesce(array_length(present, 1), 0) = 0 THEN
    RAISE EXCEPTION 'user_profiles safe column list matched no columns';
  END IF;

  list := array_to_string(present, ', ');
  EXECUTE format('GRANT UPDATE (%s) ON TABLE public.user_profiles TO authenticated', list);
  EXECUTE format('GRANT INSERT (%s) ON TABLE public.user_profiles TO authenticated', list);
  GRANT SELECT ON TABLE public.user_profiles TO authenticated;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Membership inserts: invite role must match exactly (owner no longer
--    passes through). UPDATE/DELETE of membership rows are not a client privilege.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.founder_role_for_org(p_organization_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE lower(btrim(coalesce(o.type, '')))
    WHEN 'parts_supplier' THEN 'parts_supplier'
    WHEN 'supplier' THEN 'parts_supplier'
    WHEN 'vendor' THEN 'parts_supplier'
    WHEN 'customer' THEN 'owner'
    WHEN 'laser_clinic' THEN 'owner'
    WHEN 'laser_rental' THEN 'owner'
    WHEN 'laser_reseller' THEN 'owner'
    WHEN 'service_company' THEN 'company_admin'
    ELSE 'company_admin'
  END
  FROM public.organizations o
  WHERE o.id = p_organization_id;
$$;

REVOKE ALL ON FUNCTION public.founder_role_for_org(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.founder_role_for_org(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.membership_insert_allowed(
  p_user_id uuid,
  p_organization_id bigint,
  p_role text,
  p_is_home boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      (
        EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_organization_id AND o.created_by = auth.uid()
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
$$;

COMMENT ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) IS
  'Client membership insert: own shop at the founder role for that org type (never platform admin), or an unexpired unaccepted invite whose role matches after admin is mapped to company_admin. NULL expires_at is open only when created_at is within 14 days. Invite inserts cannot set is_home.';

REVOKE ALL ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organization_memberships FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organization_memberships FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.organization_memberships FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.organization_memberships TO authenticated;

DROP POLICY IF EXISTS organization_memberships_insert_own_home ON public.organization_memberships;
CREATE POLICY organization_memberships_insert_own_home ON public.organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.membership_insert_allowed(user_id, organization_id, role, is_home)
  );

-- ---------------------------------------------------------------------------
-- 7) Organizations: no USING (true) write policies. Clients cannot change
--    created_by or grant themselves premium / plan.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  qual text;
  chk text;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY';

  FOR r IN
    SELECT pol.polname AS name,
           pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS chk
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organizations'
      AND pol.polcmd IN ('w', 'a', '*')
  LOOP
    qual := coalesce(r.qual, 'true');
    chk := coalesce(r.chk, 'true');
    IF qual IN ('true', '(true)') AND chk IN ('true', '(true)') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.organizations', r.name);
    END IF;
  END LOOP;

  EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_insert ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_update ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_legacy_delete ON public.organizations';
  EXECUTE 'DROP POLICY IF EXISTS organizations_insert_self ON public.organizations';
  EXECUTE $policy$
    CREATE POLICY organizations_insert_self ON public.organizations
      FOR INSERT TO authenticated
      WITH CHECK (created_by IS NULL OR created_by = auth.uid())
  $policy$;
END $$;

CREATE OR REPLACE FUNCTION public.organizations_guard_privilege()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  newj jsonb := to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NOT NULL AND NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'created_by must be the signed-in user';
    END IF;
    IF coalesce((newj->>'is_premium')::boolean, false) IS TRUE THEN
      RAISE EXCEPTION 'is_premium cannot be self-granted';
    END IF;
    IF nullif(newj->>'premium_until', '') IS NOT NULL
       OR nullif(newj->>'premium_grant', '') IS NOT NULL THEN
      RAISE EXCEPTION 'premium fields cannot be self-granted';
    END IF;
    IF lower(coalesce(newj->>'subscription_tier', '')) NOT IN ('', 'free')
       OR lower(coalesce(newj->>'plan', '')) NOT IN ('', 'free') THEN
      RAISE EXCEPTION 'plan cannot be self-granted';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by cannot be changed';
  END IF;
  IF (newj->>'is_premium') IS DISTINCT FROM (oldj->>'is_premium')
     OR (newj->>'premium_until') IS DISTINCT FROM (oldj->>'premium_until')
     OR (newj->>'premium_grant') IS DISTINCT FROM (oldj->>'premium_grant')
     OR (newj->>'subscription_tier') IS DISTINCT FROM (oldj->>'subscription_tier')
     OR (newj->>'plan') IS DISTINCT FROM (oldj->>'plan') THEN
    RAISE EXCEPTION 'plan and premium fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_guard_privilege ON public.organizations;
CREATE TRIGGER organizations_guard_privilege
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_guard_privilege();

-- Table INSERT/UPDATE revoked, then safe columns only. Column-level REVOKE
-- does nothing while the table privilege remains, so the table privilege goes
-- first. Premium, plan, and subscription columns are not re-granted. created_by
-- may be set on INSERT (the guard requires it to be the caller) and cannot be
-- UPDATEd. timezone is included so company and onboarding saves can store it.
DO $$
DECLARE
  col text;
  insert_cols text[] := ARRAY[
    'name', 'type', 'address', 'city', 'state', 'zip', 'phone', 'email', 'website',
    'notes', 'is_active', 'updated_at', 'ticket_prefix', 'logo_url', 'description',
    'years_in_business', 'supported_brands', 'service_territories', 'biz_type',
    'specialties', 'created_by', 'services_offered', 'num_techs', 'tax_id',
    'num_laser_systems', 'laser_models', 'facility_type', 'preferred_services',
    'bio', 'slogan', 'alt_phone', 'num_locations', 'contact_name', 'list_in_directory',
    'directory_contacts', 'storefront_enabled', 'storefront_slug', 'storefront_bio',
    'brand_primary_color', 'brand_accent_color', 'currency_code', 'number_format',
    'timezone'
  ];
  present_ins text[] := ARRAY[]::text[];
  present_upd text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organizations FROM PUBLIC;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organizations FROM anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.organizations FROM authenticated;
  GRANT SELECT ON TABLE public.organizations TO authenticated;

  FOREACH col IN ARRAY insert_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = col
    ) THEN
      present_ins := array_append(present_ins, format('%I', col));
      IF col <> 'created_by' THEN
        present_upd := array_append(present_upd, format('%I', col));
      END IF;
    END IF;
  END LOOP;

  IF coalesce(array_length(present_ins, 1), 0) = 0 THEN
    RAISE EXCEPTION 'organizations safe column list matched no columns';
  END IF;

  EXECUTE format(
    'GRANT INSERT (%s) ON TABLE public.organizations TO authenticated',
    array_to_string(present_ins, ', ')
  );
  EXECUTE format(
    'GRANT UPDATE (%s) ON TABLE public.organizations TO authenticated',
    array_to_string(present_upd, ', ')
  );
END $$;

-- ---------------------------------------------------------------------------
-- 8) Invitations. Drop every existing policy first. Allow-all is FOR ALL
--    to public, so any tighter policy is moot until it is gone.
--    Clients cannot INSERT. Same-org admins can SELECT. Invitees read and
--    accept through the service role (POST /api/team/claim).
-- ---------------------------------------------------------------------------
ALTER TABLE public.engineer_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.engineer_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.engineer_invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.engineer_invitations FROM authenticated;
REVOKE SELECT ON TABLE public.engineer_invitations FROM authenticated;

-- Same-org admins can read invite rows, not the token. Service role keeps
-- its existing table grant and still reads token for /api/team/invite.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'engineer_invitations'
    AND column_name <> 'token';
  IF cols IS NULL THEN
    RAISE EXCEPTION 'engineer_invitations has no non-token columns';
  END IF;
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.engineer_invitations TO authenticated',
    cols
  );
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pol.polname AS name
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'engineer_invitations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.engineer_invitations', r.name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS engineer_invitations_select ON public.engineer_invitations;
CREATE POLICY engineer_invitations_select ON public.engineer_invitations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = engineer_invitations.organization_id
        AND lower(m.role) IN ('company_admin', 'owner', 'service_manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id = engineer_invitations.organization_id
        AND lower(coalesce(p.role, '')) IN ('admin', 'company_admin', 'owner', 'service_manager')
    )
  );

-- ---------------------------------------------------------------------------
-- 8b) Copying a membership role onto the profile never grants platform admin.
--     Live accept_team_invite is recreated with the same behavior, plus an
--     unaccepted and unexpired invite lookup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_active_organization(p_organization_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  mem public.organization_memberships%ROWTYPE;
  profile_role text;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  SELECT * INTO mem
  FROM public.organization_memberships
  WHERE user_id = actor AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not a member of that organization';
  END IF;

  SELECT role INTO profile_role FROM public.user_profiles WHERE id = actor;
  profile_role := CASE
    WHEN lower(btrim(profile_role)) = 'admin' THEN 'admin'
    ELSE public.profile_role_from_membership(mem.role)
  END;

  UPDATE public.user_profiles
  SET
    organization_id = mem.organization_id,
    active_organization_id = mem.organization_id,
    role = profile_role,
    updated_at = now()
  WHERE id = actor;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', mem.organization_id,
    'role', profile_role,
    'is_home', mem.is_home
  );
END;
$$;

REVOKE ALL ON FUNCTION public.switch_active_organization(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.switch_active_organization(bigint) TO authenticated;

-- Live leave_organization(bigint) as of 2026-10-05 ~8:10 PM PT.
-- Same control flow and return keys (ok, left_organization_id,
-- organization_id, role, account_kept). organization_id in the return is
-- still the next membership, including when the left org was not active.
-- role is no longer next_mem.role raw: profile role admin stays admin, and
-- every other next membership role goes through profile_role_from_membership.
-- A missing next membership still returns role null (the mapper would turn
-- that into fse). search_path adds pg_temp.
--
-- Other live functions from that same read:
--   handle_new_auth_user() is not attached to auth.users (dropped above).
--   handle_new_user() is SECURITY DEFINER with no search_path and inserts role 'engineer'.
--   generate_ticket_number(bigint) is SECURITY DEFINER with no search_path and uses ticket_number_seq.
--   generate_ticket_number(uuid) already has search_path public and is left as-is.
--   set_organization_created_by() is SECURITY DEFINER with no search_path.
-- The three with no search_path are altered at the end of this file.
CREATE OR REPLACE FUNCTION public.leave_organization(p_organization_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  mem public.organization_memberships%ROWTYPE;
  next_mem public.organization_memberships%ROWTYPE;
  was_active bigint;
  kept_role text;
  next_role text;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  SELECT * INTO mem
  FROM public.organization_memberships
  WHERE user_id = actor AND organization_id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not a member of that organization';
  END IF;

  SELECT organization_id, role INTO was_active, kept_role
  FROM public.user_profiles
  WHERE id = actor;

  DELETE FROM public.organization_memberships
  WHERE user_id = actor AND organization_id = p_organization_id;

  SELECT * INTO next_mem
  FROM public.organization_memberships
  WHERE user_id = actor
  ORDER BY is_home DESC, created_at ASC
  LIMIT 1;

  IF next_mem.organization_id IS NULL THEN
    next_role := NULL;
  ELSIF lower(btrim(kept_role)) = 'admin' THEN
    next_role := 'admin';
  ELSE
    next_role := public.profile_role_from_membership(next_mem.role);
  END IF;

  IF was_active IS NOT DISTINCT FROM p_organization_id THEN
    IF next_mem.organization_id IS NOT NULL THEN
      UPDATE public.user_profiles
      SET
        organization_id = next_mem.organization_id,
        active_organization_id = next_mem.organization_id,
        role = next_role,
        updated_at = now()
      WHERE id = actor;
    ELSE
      UPDATE public.user_profiles
      SET
        organization_id = NULL,
        active_organization_id = NULL,
        updated_at = now()
      WHERE id = actor;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'left_organization_id', p_organization_id,
    'organization_id', next_mem.organization_id,
    'role', next_role,
    'account_kept', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_organization(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_organization(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_team_invite(
  p_invite_id bigint,
  p_leave_organization_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  actor_email text;
  inv public.engineer_invitations%ROWTYPE;
  home_mem public.organization_memberships%ROWTYPE;
  has_any boolean;
  mapped_role text;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  actor_email := public.auth_login_email();
  IF actor_email IS NULL THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;

  SELECT * INTO inv
  FROM public.engineer_invitations
  WHERE id = p_invite_id
    AND lower(btrim(email)) = actor_email
    AND public.invitation_is_open(accepted, expires_at, created_at);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;

  mapped_role := public.profile_role_from_membership(COALESCE(NULLIF(TRIM(inv.role), ''), 'fse'));

  IF p_leave_organization_id IS NOT NULL THEN
    SELECT * INTO home_mem
    FROM public.organization_memberships
    WHERE user_id = actor AND organization_id = p_leave_organization_id;

    IF FOUND AND (home_mem.is_home OR lower(home_mem.role) IN (
      'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier'
    )) THEN
      RAISE EXCEPTION 'founder/owner of their home shop cannot be removed by another company invite';
    END IF;
  END IF;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (
    actor,
    inv.organization_id,
    mapped_role,
    false
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET updated_at = now(),
        role = CASE
          WHEN public.organization_memberships.is_home THEN public.organization_memberships.role
          ELSE EXCLUDED.role
        END;

  UPDATE public.engineer_invitations
  SET accepted = true, accepted_at = now()
  WHERE id = inv.id;

  IF p_leave_organization_id IS NOT NULL THEN
    DELETE FROM public.organization_memberships
    WHERE user_id = actor
      AND organization_id = p_leave_organization_id
      AND is_home = false
      AND lower(role) NOT IN ('admin', 'company_admin', 'owner', 'parts_supplier', 'supplier');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships WHERE user_id = actor
  ) INTO has_any;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = actor AND organization_id IS NOT NULL
  ) THEN
    UPDATE public.user_profiles
    SET
      organization_id = inv.organization_id,
      active_organization_id = inv.organization_id,
      role = CASE
        WHEN lower(btrim(user_profiles.role)) = 'admin' THEN 'admin'
        ELSE mapped_role
      END,
      updated_at = now()
    WHERE id = actor;
  ELSIF p_leave_organization_id IS NOT NULL THEN
    UPDATE public.user_profiles
    SET
      organization_id = inv.organization_id,
      active_organization_id = inv.organization_id,
      role = CASE
        WHEN lower(btrim(user_profiles.role)) = 'admin' THEN 'admin'
        ELSE mapped_role
      END,
      updated_at = now()
    WHERE id = actor
      AND organization_id IS NOT DISTINCT FROM p_leave_organization_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', inv.organization_id,
    'role', mapped_role,
    'moonlight', has_any
  );
END;
$$;

COMMENT ON FUNCTION public.accept_team_invite(bigint, bigint) IS
  'Accept one unexpired invite for auth.users email. Membership role admin is stored as company_admin. NULL expires_at is open only when created_at is within 14 days.';

REVOKE ALL ON FUNCTION public.accept_team_invite(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_team_invite(bigint, bigint) TO authenticated;

-- Membership role admin is the org role, not platform admin.
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.organization_memberships
  SET role = 'company_admin',
      updated_at = now()
  WHERE lower(btrim(role)) = 'admin';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'organization_memberships admin -> company_admin: %', n;

  ALTER TABLE public.organization_memberships
    DROP CONSTRAINT IF EXISTS organization_memberships_role_not_platform_admin;
  ALTER TABLE public.organization_memberships
    ADD CONSTRAINT organization_memberships_role_not_platform_admin
    CHECK (role IS NULL OR lower(btrim(role)) <> 'admin');
END $$;

-- Live nits: these SECURITY DEFINER functions have no search_path.
-- handle_new_user() inserts role 'engineer'. generate_ticket_number(bigint)
-- uses ticket_number_seq. set_organization_created_by() sets organizations.created_by.
-- generate_ticket_number(uuid) already has search_path public and is not altered.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_ticket_number'
      AND pg_get_function_identity_arguments(p.oid) = 'org_id bigint'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.generate_ticket_number(bigint) SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    EXECUTE 'ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_organization_created_by'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_organization_created_by() SET search_path = public, pg_temp';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9) Subscriptions are written by the service role (Stripe / Play). Clients
--    cannot insert or update tier, organization_id, or status.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.subscriptions FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.subscriptions TO authenticated';
  EXECUTE 'DROP POLICY IF EXISTS subscriptions_select_own ON public.subscriptions';
  EXECUTE $policy$
    CREATE POLICY subscriptions_select_own ON public.subscriptions
      FOR SELECT TO authenticated
      USING (user_id = auth.uid())
  $policy$;
END $$;

NOTIFY pgrst, 'reload schema';
