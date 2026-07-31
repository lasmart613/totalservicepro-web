-- Allow users to read teammates in the same organization (team roster).
-- Without this, RLS typically only allows SELECT on your own user_profiles row,
-- so Company Profile / Admin Team only show the logged-in user.

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated;

-- Drop overly-restrictive policies if present (keep update/insert as-is when separate)
DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_select_self ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS users_select_own_profile ON public.user_profiles;

-- Self OR same organization
DROP POLICY IF EXISTS user_profiles_select_self_or_org ON public.user_profiles;
CREATE POLICY user_profiles_select_self_or_org ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.user_org_id()
    )
  );

-- Ensure authenticated can still update own row (common pattern)
DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

NOTIFY pgrst, 'reload schema';
