-- Lock user_profiles.organization_id / role against client self-attach.
-- QA 2026-08-22: header/session showed another org mid-onboarding / after switch.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI) before this deploy is fully effective.
-- Existing rows (first customer, Luxor Photonix) are not moved. They can still
-- edit name/phone/job_title. Service-role invite/claim/sync still work.
-- Founders can still link to an org they just created (created_by = auth.uid()).

-- ---------------------------------------------------------------------------
-- 1) New-user trigger: never copy organization_id from client signup metadata
--    unless a real pending engineer_invitations row matches this email + org.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id bigint;
  urole text;
  invited boolean;
  meta_org text;
BEGIN
  org_id := NULL;
  urole := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');
  invited := lower(COALESCE(NEW.raw_user_meta_data->>'invited_member', '')) IN ('true', 't', '1');
  meta_org := NEW.raw_user_meta_data->>'organization_id';

  IF invited
     AND meta_org IS NOT NULL
     AND meta_org ~ '^[0-9]+$'
     AND EXISTS (
       SELECT 1
       FROM public.engineer_invitations i
       WHERE i.organization_id = meta_org::bigint
         AND lower(i.email) = lower(NEW.email)
         AND COALESCE(i.accepted, false) = false
     ) THEN
    org_id := meta_org::bigint;
  ELSE
    -- Founder / public signup: keep role for onboarding UI, never inherit an org.
    org_id := NULL;
  END IF;

  INSERT INTO public.user_profiles (
    id,
    email,
    first_name,
    last_name,
    role,
    organization_id,
    job_title,
    onboarding_completed
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
    -- role + organization_id are not overwritten on conflict

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Creates user_profiles for new auth.users. organization_id is set only when an engineer_invitations row matches; public signup metadata cannot attach to another org.';

-- ---------------------------------------------------------------------------
-- 2) Guard: authenticated clients cannot join/steal another org or change role
--    after they already belong to one. Service role (auth.uid() IS NULL) passes.
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
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id cannot be changed by the client';
  END IF;

  IF NEW.organization_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.organization_id IS NULL) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = NEW.organization_id AND o.created_by = actor
    ) INTO own_created;

    SELECT EXISTS (
      SELECT 1 FROM public.engineer_invitations i
      WHERE i.organization_id = NEW.organization_id
        AND lower(i.email) = lower(COALESCE(NEW.email, ''))
        AND COALESCE(i.accepted, false) = false
    ) INTO invited;

    IF NOT own_created AND NOT invited THEN
      RAISE EXCEPTION 'cannot attach profile to an organization you did not create or were not invited to';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND OLD.organization_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = OLD.organization_id AND o.created_by = actor
    ) INTO own_created;

    IF OLD.role IS NOT NULL AND lower(OLD.role) = ANY (locked_roles) THEN
      RAISE EXCEPTION 'role cannot be changed by the client once set';
    END IF;

    -- fse/pending leftover from the old signup trigger: only the org creator may fix it
    IF NOT own_created THEN
      RAISE EXCEPTION 'role cannot be changed by the client once set';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_guard_identity ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_identity
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_guard_identity();

COMMENT ON FUNCTION public.user_profiles_guard_identity() IS
  'Blocks client self-attach to another organization and client role changes after org membership is established.';

-- ---------------------------------------------------------------------------
-- 3) Tighten UPDATE RLS (trigger is the column lock; policy stays own-row).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS user_profiles_insert_own ON public.user_profiles;
CREATE POLICY user_profiles_insert_own ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

NOTIFY pgrst, 'reload schema';
