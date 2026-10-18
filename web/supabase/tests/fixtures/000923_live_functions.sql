-- Live (prod 2026-10-17) helper definitions for the 000923 proof, verbatim from
-- pg_get_functiondef. md5 is of the pg_get_functiondef text. Fixture only.

-- public.profile_role_from_membership md5 9b22cfb899d2783c23c754a4cb96180d
CREATE OR REPLACE FUNCTION public.profile_role_from_membership(p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN lower(btrim(coalesce(p_role, ''))) = 'admin' THEN 'company_admin'
    WHEN nullif(btrim(p_role), '') IS NULL THEN 'fse'
    ELSE btrim(p_role)
  END;
$function$;

-- public.invitation_is_open md5 fe368efe7d1f226014e23661ae1f3dbb
CREATE OR REPLACE FUNCTION public.invitation_is_open(p_accepted boolean, p_expires_at timestamp with time zone, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_accepted, false) = false
    AND (
      (p_expires_at IS NOT NULL AND p_expires_at > now())
      OR (
        p_expires_at IS NULL
        AND p_created_at IS NOT NULL
        AND p_created_at > (now() - interval '14 days')
      )
    );
$function$;

-- public.auth_login_email md5 8e62a69e2e8d8fa232743389155a6647
CREATE OR REPLACE FUNCTION public.auth_login_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(lower(btrim(u.email)), '')
  FROM auth.users AS u
  WHERE u.id = auth.uid();
$function$;

-- private.profile_email_is_auth_email md5 c1e351f0dfde5d738cbc50d2a50040d5
CREATE OR REPLACE FUNCTION private.profile_email_is_auth_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = auth.uid()
      AND btrim(coalesce(p_email, '')) <> ''
      AND lower(btrim(u.email)) = lower(btrim(p_email))
  );
$function$;

-- is_active_org_member md5 4cfcdb6ad83ec1138c0982d18b6488e5
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = p_org
  );
$function$;

-- get_my_org_id md5 40bff6a0c88ba346da45f8ecc6f2c709
CREATE OR REPLACE FUNCTION public.get_my_org_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT p.active_organization_id
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.active_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships m
          WHERE m.user_id = auth.uid()
            AND m.organization_id = p.active_organization_id
        )
      LIMIT 1
    ),
    (
      SELECT m.organization_id
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
      ORDER BY m.is_home DESC NULLS LAST, m.created_at ASC NULLS LAST
      LIMIT 1
    )
  );
$function$;

-- auth_member_of_org md5 371c95a2db3862d19731deb3394fe43d
CREATE OR REPLACE FUNCTION public.auth_member_of_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = org_id
    );
$function$;

-- org_unclaimed_new md5 55ea489285da1ecbacc54462c283a501
CREATE OR REPLACE FUNCTION public.org_unclaimed_new(p_org bigint, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_at IS NOT NULL
    AND p_created_at > now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers oc
      WHERE oc.customer_organization_id = p_org
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_org
    );
$function$;

-- user_owns_or_created_org md5 e32cf8ef2ed365adaece403f7455dbba
CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    org_id IS NOT NULL
    AND (
      (
        org_id = public.get_my_org_id()
        AND public.is_active_org_member(org_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND public.org_creator_access(o.id, o.created_by, o.created_at)
      )
    );
$function$;

-- organization_memberships_enforce_single_home md5 95470d53106d7179962345ef02a610b1
CREATE OR REPLACE FUNCTION public.organization_memberships_enforce_single_home()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
BEGIN
  IF NEW.is_home IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE user_id = NEW.user_id
    AND organization_id IS DISTINCT FROM NEW.organization_id
    AND is_home IS TRUE;

  RETURN NEW;
END;
$function$;

-- set_home_membership md5 456b5da279d833d3746bb99f34e1a585
CREATE OR REPLACE FUNCTION public.set_home_membership(p_user_id uuid, p_organization_id bigint, p_role text DEFAULT NULL::text, p_sync_profile boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET row_security TO 'off'
AS $function$
DECLARE
  n integer;
  next_role text;
  homes integer;
BEGIN
  IF p_user_id IS NULL OR p_organization_id IS NULL THEN
    RAISE EXCEPTION 'set_home_membership requires a user and an organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'set_home_membership organization % not found', p_organization_id;
  END IF;

  next_role := CASE
    WHEN p_role IS NULL OR btrim(p_role) = '' THEN NULL
    ELSE public.profile_role_from_membership(p_role)
  END;

  -- Clear first. A later failure raises and rolls this back with the insert.
  UPDATE public.organization_memberships
  SET is_home = false,
      updated_at = now()
  WHERE user_id = p_user_id
    AND organization_id IS DISTINCT FROM p_organization_id
    AND is_home IS TRUE;

  INSERT INTO public.organization_memberships (user_id, organization_id, role, is_home)
  VALUES (
    p_user_id,
    p_organization_id,
    COALESCE(next_role, 'fse'),
    true
  )
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET is_home = true,
        updated_at = now(),
        role = COALESCE(next_role, public.organization_memberships.role);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'set_home_membership expected 1 membership row, changed %', n;
  END IF;

  IF p_sync_profile THEN
    UPDATE public.user_profiles
    SET
      organization_id = p_organization_id,
      active_organization_id = p_organization_id,
      role = public.profile_role_from_membership(COALESCE(next_role, role)),
      updated_at = now()
    WHERE id = p_user_id;
  END IF;

  SELECT count(*) INTO homes
  FROM public.organization_memberships
  WHERE user_id = p_user_id
    AND is_home IS TRUE;
  IF homes <> 1 THEN
    RAISE EXCEPTION 'set_home_membership left % home rows', homes;
  END IF;
END;
$function$;

-- user_profiles_sync_membership md5 512b618a2a4e6d1e32055913b81c88a1
CREATE OR REPLACE FUNCTION public.user_profiles_sync_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- user_profiles_client_identity_guard md5 f4c5c5b49042719f65ab89872bd48b7c
CREATE OR REPLACE FUNCTION public.user_profiles_client_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    IF current_user IN ('authenticated', 'anon') THEN
      IF NEW.id IS DISTINCT FROM auth.uid()
         OR NOT private.profile_email_is_auth_email(NEW.email) THEN
        RAISE EXCEPTION 'user_profiles.email must match the auth login email'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      SELECT NULLIF(lower(btrim(u.email)), '') INTO auth_email
      FROM auth.users u
      WHERE u.id = NEW.id;

      IF auth_email IS NULL
         OR lower(btrim(COALESCE(NEW.email, ''))) IS DISTINCT FROM auth_email THEN
        RAISE EXCEPTION 'user_profiles.email must match the auth login email'
          USING ERRCODE = '42501';
      END IF;
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
$function$;
