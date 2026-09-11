-- Sellers already manage rows they created (seller_id / created_by).
-- This adds the same for supplier org admins of the listing's organization
-- so Larry can edit/remove a teammate's Luxor Photonix listing.
--
-- Preview/prod listing edits go through PATCH/DELETE
-- /api/marketplace/parts/:id (service role, ownership checked in app code),
-- so this SQL is defense in depth and is not required for the UI to ship.
--
-- If you apply it: Supabase → SQL Editor → paste this file → Run.

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_org_id() TO authenticated;

DROP POLICY IF EXISTS "Org admins manage org listings" ON public.marketplace_listings;
CREATE POLICY "Org admins manage org listings" ON public.marketplace_listings
  FOR ALL
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = public.get_my_org_id()
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN (
            'admin',
            'company_admin',
            'owner',
            'parts_supplier',
            'supplier'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = marketplace_listings.organization_id
          AND lower(coalesce(o.type, '')) IN ('parts_supplier', 'vendor')
      )
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = public.get_my_org_id()
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN (
            'admin',
            'company_admin',
            'owner',
            'parts_supplier',
            'supplier'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = marketplace_listings.organization_id
          AND lower(coalesce(o.type, '')) IN ('parts_supplier', 'vendor')
      )
    )
  );

NOTIFY pgrst, 'reload schema';
