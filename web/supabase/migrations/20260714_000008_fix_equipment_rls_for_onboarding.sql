-- Fix equipment insert RLS failures during clinic onboarding (Google OAuth + email).
-- Root cause: policy checked user_profiles via a normal subquery, which can fail
-- mid-onboarding when profile.organization_id was just set, or when nested RLS
-- makes the membership check evaluate empty. Use SECURITY DEFINER helpers instead,
-- and allow inserts for orgs the user just created (created_by = auth.uid()).

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_or_created_org(bigint) TO authenticated;

DROP POLICY IF EXISTS equipment_org_member_all ON public.equipment;
DROP POLICY IF EXISTS equipment_pro_select ON public.equipment;
DROP POLICY IF EXISTS "equipment_org_member_all" ON public.equipment;
DROP POLICY IF EXISTS "equipment_pro_select" ON public.equipment;

-- Facility members / creators manage their lasers
CREATE POLICY equipment_facility_manage ON public.equipment
  FOR ALL
  TO authenticated
  USING (public.user_owns_or_created_org(customer_organization_id))
  WITH CHECK (public.user_owns_or_created_org(customer_organization_id));

-- Service pros can view facility equipment for jobs (read-only)
CREATE POLICY equipment_authenticated_select ON public.equipment
  FOR SELECT
  TO authenticated
  USING (true);

SELECT 'ok' AS status;
