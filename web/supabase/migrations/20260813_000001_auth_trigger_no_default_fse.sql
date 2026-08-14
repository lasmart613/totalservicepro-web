-- Do not default brand-new signups to fse. Invites still pass role in metadata.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id bigint;
  urole text;
BEGIN
  org_id := NULL;
  IF NEW.raw_user_meta_data ? 'organization_id'
     AND (NEW.raw_user_meta_data->>'organization_id') ~ '^[0-9]+$' THEN
    org_id := (NEW.raw_user_meta_data->>'organization_id')::bigint;
  END IF;

  urole := NULLIF(TRIM(NEW.raw_user_meta_data->>'role'), '');

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
    role = COALESCE(EXCLUDED.role, public.user_profiles.role),
    organization_id = COALESCE(EXCLUDED.organization_id, public.user_profiles.organization_id),
    job_title = COALESCE(EXCLUDED.job_title, public.user_profiles.job_title);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Creates user_profiles for new auth.users. Role comes from metadata (invites); signup founders are not defaulted to fse.';
