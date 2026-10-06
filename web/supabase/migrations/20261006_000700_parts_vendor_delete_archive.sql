-- Catalog vendor delete and part archive. Not applied by the app.
-- Live (Oct 2026): parts_catalog.is_active already exists. part_vendors has no creator column.
-- parts_catalog_update was USING (true), so any signed-in user could change is_active.
-- inventory_transactions.part_id references parts_catalog(id) with no ON DELETE CASCADE,
-- so parts are archived (is_active = false) instead of deleted.
-- Same-org admin is organization_memberships.role in (admin, company_admin).
-- part_vendors INSERT and UPDATE policies are left unchanged (#215 scopes those).
-- This file only replaces parts_catalog UPDATE and adds part_vendors DELETE.

ALTER TABLE public.parts_catalog
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

ALTER TABLE public.part_vendors
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

COMMENT ON COLUMN public.part_vendors.created_by IS
  'Auth user who inserted the vendor row. Null on rows created before this column existed.';

ALTER TABLE public.parts_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_vendors ENABLE ROW LEVEL SECURITY;

-- Replace the open update. Permissive policies are OR'd, so the old USING (true)
-- policy has to go or anyone could still set is_active.
DROP POLICY IF EXISTS parts_catalog_update ON public.parts_catalog;
DROP POLICY IF EXISTS parts_catalog_update_owner ON public.parts_catalog;
CREATE POLICY parts_catalog_update_owner
  ON public.parts_catalog
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships owner_m
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = owner_m.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(admin_m.role) IN ('admin', 'company_admin')
      WHERE owner_m.user_id = parts_catalog.created_by
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships owner_m
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = owner_m.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(admin_m.role) IN ('admin', 'company_admin')
      WHERE owner_m.user_id = parts_catalog.created_by
    )
  );

DROP POLICY IF EXISTS part_vendors_delete_owner ON public.part_vendors;
CREATE POLICY part_vendors_delete_owner
  ON public.part_vendors
  FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.parts_catalog p
      WHERE p.id = part_vendors.part_id
        AND p.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parts_catalog p
      JOIN public.organization_memberships owner_m
        ON owner_m.user_id = p.created_by
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = owner_m.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(admin_m.role) IN ('admin', 'company_admin')
      WHERE p.id = part_vendors.part_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships vendor_m
      JOIN public.organization_memberships admin_m
        ON admin_m.organization_id = vendor_m.organization_id
       AND admin_m.user_id = auth.uid()
       AND lower(admin_m.role) IN ('admin', 'company_admin')
      WHERE vendor_m.user_id = part_vendors.created_by
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE public.parts_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.part_vendors TO authenticated;

NOTIFY pgrst, 'reload schema';
