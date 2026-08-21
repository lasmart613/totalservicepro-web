-- Claimed clinic owners must be able to edit THEIR organization
-- (Directory Add Customer creates the org as the service company user).
-- Reuses user_owns_or_created_org() from the equipment onboarding migration.
-- Does not wipe data. Does not grant access to other clinics.
--
-- Optional hardening on the database. Preview/prod do NOT apply this
-- automatically. Claimed-owner Facility Profile save goes through
-- POST /api/org/profile (service role, own org only) so Larry does not
-- need to paste SQL for the QA fix.
--
-- If you later apply it: Supabase → SQL Editor → paste this file → Run.

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

-- Extra UPDATE policy (OR'd with any existing created_by policy).
DROP POLICY IF EXISTS organizations_member_update ON public.organizations;
CREATE POLICY organizations_member_update ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.user_owns_or_created_org(id))
  WITH CHECK (public.user_owns_or_created_org(id));

-- Claimed owners add/edit contacts on their own facility (CRM policies stay).
DROP POLICY IF EXISTS contacts_claimed_owner_manage ON public.contacts;
CREATE POLICY contacts_claimed_owner_manage ON public.contacts
  FOR ALL
  TO authenticated
  USING (public.user_owns_or_created_org(organization_id))
  WITH CHECK (public.user_owns_or_created_org(organization_id));

SELECT 'ok' AS status;
