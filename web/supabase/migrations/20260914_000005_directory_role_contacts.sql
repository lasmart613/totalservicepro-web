-- Customer Directory multi-contact roles (Owner, Medical Director, Physician,
-- Laser Technician, Office Manager) plus a primary-contact flag.
--
-- Main office email/phone stay on organizations.email / organizations.phone.
-- Person-roles are stored on organizations.directory_contacts (JSONB) and
-- synced into public.contacts (title = role label, is_primary).
-- Legacy organizations.contact_name is left in place for older rows.
--
-- Soft beta. No paid ads. Safe to re-run.
--
-- LIVE SQL (Supabase SQL editor after merge):
--   1. Paste this file and Run.
--   2. Confirm the column:
--        select id, name, contact_name, email, phone, directory_contacts
--        from organizations
--        where type in ('customer', 'laser_clinic')
--        order by id desc
--        limit 20;
--   3. Optional: confirm a service-company user can insert a contacts row on a
--      linked customer (Directory save does this automatically).
--   Preview/prod do not apply this automatically.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS directory_contacts jsonb;

COMMENT ON COLUMN public.organizations.directory_contacts IS
  'Customer Directory person-roles: {version, primaryRole, roles{owner,medical_director,physician,laser_technician,office_manager:{name,email,phone}}}. Main office email/phone stay on organizations.email / organizations.phone.';

CREATE INDEX IF NOT EXISTS contacts_organization_primary_idx
  ON public.contacts (organization_id)
  WHERE is_primary IS TRUE;

-- Service-company staff manage contacts on customers linked via organization_customers.
-- Claimed-owner self-edit stays on contacts_claimed_owner_manage.
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

DROP POLICY IF EXISTS contacts_service_company_linked_manage ON public.contacts;
CREATE POLICY contacts_service_company_linked_manage ON public.contacts
  FOR ALL
  TO authenticated
  USING (
    public.user_owns_or_created_org(organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.organization_customers oc
      WHERE oc.customer_organization_id = contacts.organization_id
        AND oc.service_organization_id = public.get_my_org_id()
    )
  )
  WITH CHECK (
    public.user_owns_or_created_org(organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.organization_customers oc
      WHERE oc.customer_organization_id = contacts.organization_id
        AND oc.service_organization_id = public.get_my_org_id()
    )
  );

NOTIFY pgrst, 'reload schema';

SELECT 'ok' AS status;
