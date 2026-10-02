-- Identity follows the Auth login, not user_profiles.email.
--
-- user_profiles.email is writable by the signed-in user. Matching God access,
-- team-invite acceptance, or organization_memberships inserts to that column
-- lets someone paste an allowlisted or invited address onto their own profile.
--
-- This forward migration replaces the live functions and insert policy.
-- It does not rewrite earlier migration history.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI). Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Login email from auth.users for the current session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_login_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(lower(btrim(u.email)), '')
  FROM auth.users AS u
  WHERE u.id = auth.uid();
$$;

COMMENT ON FUNCTION public.auth_login_email() IS
  'Lowercased auth.users.email for auth.uid(). Never user_profiles.email.';

REVOKE ALL ON FUNCTION public.auth_login_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Invite acceptance uses the Auth email only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_team_invite(p_invite_id bigint, p_leave_organization_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  actor_email text;
  inv public.engineer_invitations%ROWTYPE;
  home_mem public.organization_memberships%ROWTYPE;
  has_any boolean;
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
    AND lower(btrim(email)) = actor_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;

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
    COALESCE(NULLIF(TRIM(inv.role), ''), 'fse'),
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
      role = COALESCE(NULLIF(TRIM(inv.role), ''), 'fse'),
      updated_at = now()
    WHERE id = actor;
  ELSIF p_leave_organization_id IS NOT NULL THEN
    UPDATE public.user_profiles
    SET
      organization_id = inv.organization_id,
      active_organization_id = inv.organization_id,
      role = COALESCE(NULLIF(TRIM(inv.role), ''), 'fse'),
      updated_at = now()
    WHERE id = actor
      AND organization_id IS NOT DISTINCT FROM p_leave_organization_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', inv.organization_id,
    'role', COALESCE(NULLIF(TRIM(inv.role), ''), 'fse'),
    'moonlight', has_any
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Profile attach checks the Auth email, not the email being written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  own_created boolean;
  invited boolean;
  member_of_new boolean;
  member_role text;
  locked_roles text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'customer', 'parts_supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager'
  ];
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'user_profiles insert must be your own row';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'user_profiles id cannot be changed';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    IF NEW.organization_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
      ) INTO member_of_new;
      IF member_of_new THEN
        NULL;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = NEW.organization_id AND o.created_by = actor
        ) INTO own_created;
        SELECT EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = NEW.organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND COALESCE(i.accepted, false) = false
        ) INTO invited;
        IF own_created OR invited THEN
          NULL;
        ELSIF OLD.organization_id IS NOT NULL THEN
          RAISE EXCEPTION 'organization_id cannot be changed by the client';
        ELSE
          RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
        END IF;
      END IF;
    ELSE
      NULL;
    END IF;
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
    ) INTO member_of_new;
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by = actor
    ) INTO own_created;
    SELECT EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = NEW.organization_id
        AND public.auth_login_email() IS NOT NULL
        AND lower(btrim(i.email)) = public.auth_login_email()
        AND COALESCE(i.accepted, false) = false
    ) INTO invited;
    IF NOT member_of_new AND NOT own_created AND NOT invited THEN
      RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role THEN
    SELECT m.role INTO member_role
    FROM public.organization_memberships m
    WHERE m.user_id = actor
      AND m.organization_id = COALESCE(NEW.organization_id, OLD.organization_id)
    LIMIT 1;

    IF member_role IS NOT NULL AND lower(NEW.role) = lower(member_role) THEN
      NULL;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = NEW.organization_id AND o.created_by = actor
      ) INTO own_created;

      IF own_created THEN
        NULL;
      ELSIF OLD.organization_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = OLD.organization_id AND o.created_by = actor
        ) INTO own_created;

        IF OLD.role IS NOT NULL AND lower(OLD.role) = ANY (locked_roles) THEN
          RAISE EXCEPTION 'role cannot be changed by the client once set';
        END IF;

        IF NOT own_created THEN
          RAISE EXCEPTION 'role cannot be changed by the client once set';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_profiles_guard_identity() IS
  'Blocks steal/self-attach. Invite matches use auth.users.email, not the profile email on the row being written.';

-- ---------------------------------------------------------------------------
-- 4) Profile sync must not mint admin / company_admin / is_home from an invite
--    the Auth account was not actually granted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profiles_sync_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  home boolean;
  grant_role text;
  invite_role text;
  existing_role text;
  own_created boolean;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  grant_role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'fse');
  home := lower(grant_role) IN (
    'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier'
  );

  IF auth.uid() IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by = auth.uid()
    ) INTO own_created;

    IF NOT own_created THEN
      -- Client did not create this shop. Do not grant a home row, and do not
      -- take admin / company_admin unless an open invite for the login email
      -- grants that role or the membership already has it.
      home := false;

      SELECT NULLIF(TRIM(i.role), '') INTO invite_role
      FROM public.engineer_invitations i
      WHERE i.organization_id = NEW.organization_id
        AND public.auth_login_email() IS NOT NULL
        AND lower(btrim(i.email)) = public.auth_login_email()
        AND COALESCE(i.accepted, false) = false
      ORDER BY i.created_at DESC NULLS LAST, i.id DESC
      LIMIT 1;

      SELECT m.role INTO existing_role
      FROM public.organization_memberships m
      WHERE m.user_id = NEW.id
        AND m.organization_id = NEW.organization_id;

      IF lower(grant_role) IN ('admin', 'company_admin')
         AND NOT (
           invite_role IS NOT NULL
           AND lower(grant_role) = lower(invite_role)
         )
         AND NOT (
           existing_role IS NOT NULL
           AND lower(btrim(existing_role)) = lower(grant_role)
         )
      THEN
        grant_role := COALESCE(invite_role, NULLIF(TRIM(existing_role), ''), 'fse');
        NEW.role := grant_role;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (NEW.id, NEW.organization_id, grant_role, home)
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET updated_at = now(),
        is_home = public.organization_memberships.is_home
                  OR EXCLUDED.is_home,
        role = CASE
          WHEN public.organization_memberships.is_home THEN public.organization_memberships.role
          ELSE EXCLUDED.role
        END;

  IF NEW.active_organization_id IS NULL THEN
    NEW.active_organization_id := NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Direct membership inserts: Auth email, and no stronger role than the invite.
--    Creating your own shop is unchanged (company_admin + is_home).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.membership_insert_allowed(
  p_user_id uuid,
  p_organization_id bigint,
  p_role text,
  p_is_home boolean
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT DISTINCT FROM auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = p_organization_id
          AND o.created_by = auth.uid()
      )
      OR (
        COALESCE(p_is_home, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND COALESCE(i.accepted, false) = false
            AND (
              lower(btrim(COALESCE(p_role, ''))) NOT IN ('admin', 'company_admin')
              OR lower(btrim(COALESCE(p_role, ''))) = lower(btrim(COALESCE(i.role, '')))
            )
        )
      )
    );
$$;

COMMENT ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) IS
  'Client membership insert: own created shop, or an open invite for the Auth email that grants the requested admin/company_admin role. Invite inserts cannot set is_home.';

REVOKE ALL ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) TO authenticated;

DROP POLICY IF EXISTS organization_memberships_insert_own_home ON public.organization_memberships;
CREATE POLICY organization_memberships_insert_own_home ON public.organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.membership_insert_allowed(user_id, organization_id, role, is_home)
  );

NOTIFY pgrst, 'reload schema';
