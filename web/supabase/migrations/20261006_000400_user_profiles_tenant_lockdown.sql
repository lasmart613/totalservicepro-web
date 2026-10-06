-- Block cross-tenant org/role self-assignment on user_profiles.
--
-- Live hole: anon/authenticated can UPDATE user_profiles.role,
-- organization_id, and active_organization_id. RLS is only id = auth.uid().
-- user_profiles_sync_membership (SECURITY DEFINER) then INSERTs an
-- organization_memberships row for whatever organization_id the user set,
-- downgrading admin/company_admin but letting owner and other roles through.
--
-- This file is idempotent. Apply it in the Supabase SQL editor or CLI.
-- It does not UPDATE, DELETE, or rewrite customer rows.
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

REVOKE ALL ON FUNCTION public.auth_login_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_login_email() TO authenticated;

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
     AND meta_org IS NOT NULL
     AND meta_org ~ '^[0-9]+$'
     AND EXISTS (
       SELECT 1
       FROM public.engineer_invitations i
       WHERE i.organization_id = meta_org::bigint
         AND lower(btrim(i.email)) = lower(btrim(NEW.email))
         AND COALESCE(i.accepted, false) = false
     ) THEN
    org_id := meta_org::bigint;
    SELECT COALESCE(NULLIF(TRIM(i.role), ''), 'fse')
      INTO urole
    FROM public.engineer_invitations i
    WHERE i.organization_id = org_id
      AND lower(btrim(i.email)) = lower(btrim(NEW.email))
      AND COALESCE(i.accepted, false) = false
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
  'Creates user_profiles. organization_id and role are copied only from a matching unaccepted engineer_invitations row, never from raw_user_meta_data.role.';

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

REVOKE ALL ON FUNCTION public.get_my_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_owns_or_created_org(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_or_created_org(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Guard + membership sync. Client writes RAISE. Service role (auth.uid()
--    IS NULL) is trusted. BEFORE INSERT OR UPDATE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profiles_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid;
  own_created boolean;
  member_of_new boolean;
  invited boolean;
  member_role text;
  elevated text[] := ARRAY[
    'admin', 'company_admin', 'owner', 'parts_supplier', 'supplier',
    'service_manager', 'dispatcher', 'scheduler', 'billing_manager', 'crm'
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
     AND NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND NEW.active_organization_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = NEW.active_organization_id
     )
     AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.active_organization_id IS NOT NULL
     AND NEW.active_organization_id IS DISTINCT FROM NEW.organization_id
     AND NOT EXISTS (
       SELECT 1 FROM public.organization_memberships m
       WHERE m.user_id = actor AND m.organization_id = NEW.active_organization_id
     ) THEN
    RAISE EXCEPTION 'active_organization_id must reference an existing membership';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.organization_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.organization_id IS DISTINCT FROM OLD.organization_id AND NEW.organization_id IS NOT NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by = actor
    ) INTO own_created;
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = actor AND m.organization_id = NEW.organization_id
    ) INTO member_of_new;
    SELECT EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = NEW.organization_id
        AND public.auth_login_email() IS NOT NULL
        AND lower(btrim(i.email)) = public.auth_login_email()
        AND COALESCE(i.accepted, false) = false
    ) INTO invited;
    IF NOT own_created AND NOT member_of_new AND NOT invited THEN
      RAISE EXCEPTION 'cannot join an organization you did not create, are not a member of, and were not invited to';
    END IF;
    IF own_created AND NOT member_of_new AND lower(COALESCE(NEW.role, '')) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
  END IF;

  IF (TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role)
     OR TG_OP = 'INSERT' THEN
    IF lower(COALESCE(NEW.role, '')) = ANY (elevated) THEN
      SELECT m.role INTO member_role
      FROM public.organization_memberships m
      WHERE m.user_id = actor
        AND m.organization_id = COALESCE(NEW.organization_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.organization_id ELSE NULL END)
      LIMIT 1;
      IF member_role IS NULL OR lower(btrim(member_role)) IS DISTINCT FROM lower(btrim(NEW.role)) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = NEW.organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND COALESCE(i.accepted, false) = false
            AND lower(btrim(COALESCE(i.role, ''))) = lower(btrim(NEW.role))
        ) THEN
          RAISE EXCEPTION 'cannot self-assign an elevated role';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.user_profiles_guard_identity() IS
  'BEFORE INSERT/UPDATE. Authenticated callers cannot self-join another tenant or self-assign an elevated role. auth.uid() IS NULL (service role) passes.';

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
    grant_role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'fse');
    home := lower(grant_role) IN ('admin', 'company_admin', 'owner', 'parts_supplier', 'supplier');
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
         OR lower(btrim(existing_role)) IS DISTINCT FROM lower(btrim(NEW.role)) THEN
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
    AND COALESCE(i.accepted, false) = false
  ORDER BY i.created_at DESC NULLS LAST, i.id DESC
  LIMIT 1;

  IF member_of_new THEN
    grant_role := COALESCE(NULLIF(TRIM(existing_role), ''), 'fse');
  ELSIF own_created THEN
    IF lower(COALESCE(NEW.role, '')) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
    grant_role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'fse');
    IF lower(grant_role) = ANY (elevated) THEN
      RAISE EXCEPTION 'cannot self-assign an elevated role';
    END IF;
  ELSIF invite_role IS NOT NULL THEN
    grant_role := invite_role;
  ELSE
    RAISE EXCEPTION 'cannot join an organization you did not create, are not a member of, and were not invited to';
  END IF;

  IF lower(COALESCE(NEW.role, '')) = ANY (elevated)
     AND lower(btrim(NEW.role)) IS DISTINCT FROM lower(btrim(grant_role)) THEN
    RAISE EXCEPTION 'cannot self-assign an elevated role';
  END IF;

  NEW.role := grant_role;

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

REVOKE ALL ON FUNCTION public.founder_role_for_org(bigint) FROM PUBLIC;
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
        AND EXISTS (
          SELECT 1 FROM public.engineer_invitations i
          WHERE i.organization_id = p_organization_id
            AND public.auth_login_email() IS NOT NULL
            AND lower(btrim(i.email)) = public.auth_login_email()
            AND COALESCE(i.accepted, false) = false
            AND lower(btrim(coalesce(p_role, ''))) = lower(btrim(coalesce(NULLIF(TRIM(i.role), ''), 'fse')))
        )
      )
    );
$$;

COMMENT ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) IS
  'Client membership insert: own shop at the founder role for that org type (never platform admin), or an open invite whose role matches exactly. Invite inserts cannot set is_home.';

REVOKE ALL ON FUNCTION public.membership_insert_allowed(uuid, bigint, text, boolean) FROM PUBLIC;
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

DO $$
DECLARE
  col text;
  locked text[] := ARRAY['is_premium', 'premium_until', 'premium_grant', 'subscription_tier', 'plan'];
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;
  FOREACH col IN ARRAY locked LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = col
    ) THEN
      EXECUTE format(
        'REVOKE INSERT (%I), UPDATE (%I) ON TABLE public.organizations FROM PUBLIC, anon, authenticated',
        col, col
      );
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'created_by'
  ) THEN
    EXECUTE 'REVOKE UPDATE (created_by) ON TABLE public.organizations FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8) Invitations: an invitee cannot retarget email, org, or role.
--    Admins of that org may insert. Role platform admin is rejected.
-- ---------------------------------------------------------------------------
ALTER TABLE public.engineer_invitations ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.engineer_invitations FROM PUBLIC, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.engineer_invitations FROM authenticated;

DO $$
DECLARE
  col text;
  locked text[] := ARRAY['email', 'organization_id', 'role', 'invited_by', 'token'];
  present text[];
BEGIN
  present := ARRAY[]::text[];
  FOREACH col IN ARRAY ARRAY['accepted', 'accepted_at']::text[] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'engineer_invitations' AND column_name = col
    ) THEN
      present := array_append(present, format('%I', col));
    END IF;
  END LOOP;
  IF coalesce(array_length(present, 1), 0) > 0 THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.engineer_invitations TO authenticated',
      array_to_string(present, ', ')
    );
  END IF;
  FOREACH col IN ARRAY locked LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'engineer_invitations' AND column_name = col
    ) THEN
      EXECUTE format(
        'REVOKE UPDATE (%I) ON TABLE public.engineer_invitations FROM PUBLIC, anon, authenticated',
        col
      );
    END IF;
  END LOOP;
  GRANT SELECT, INSERT ON TABLE public.engineer_invitations TO authenticated;
END $$;

DROP POLICY IF EXISTS engineer_invitations_select ON public.engineer_invitations;
CREATE POLICY engineer_invitations_select ON public.engineer_invitations
  FOR SELECT TO authenticated
  USING (
    (public.auth_login_email() IS NOT NULL AND lower(btrim(email)) = public.auth_login_email())
    OR invited_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = engineer_invitations.organization_id
        AND lower(m.role) IN ('admin', 'company_admin', 'owner', 'service_manager')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.organization_id = engineer_invitations.organization_id
        AND lower(coalesce(p.role, '')) IN ('admin', 'company_admin', 'owner', 'service_manager')
    )
  );

DROP POLICY IF EXISTS engineer_invitations_insert_admin ON public.engineer_invitations;
CREATE POLICY engineer_invitations_insert_admin ON public.engineer_invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND COALESCE(accepted, false) = false
    AND lower(btrim(coalesce(role, ''))) <> 'admin'
    AND (
      EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = engineer_invitations.organization_id
          AND lower(m.role) IN ('admin', 'company_admin', 'owner', 'service_manager')
      )
      OR EXISTS (
        SELECT 1 FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND p.organization_id = engineer_invitations.organization_id
          AND lower(coalesce(p.role, '')) IN ('admin', 'company_admin', 'owner', 'service_manager')
      )
    )
  );

DROP POLICY IF EXISTS engineer_invitations_accept_own ON public.engineer_invitations;
CREATE POLICY engineer_invitations_accept_own ON public.engineer_invitations
  FOR UPDATE TO authenticated
  USING (
    public.auth_login_email() IS NOT NULL
    AND lower(btrim(email)) = public.auth_login_email()
  )
  WITH CHECK (
    public.auth_login_email() IS NOT NULL
    AND lower(btrim(email)) = public.auth_login_email()
  );

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
