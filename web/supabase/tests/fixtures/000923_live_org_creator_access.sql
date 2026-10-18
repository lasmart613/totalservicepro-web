-- Live (prod 2026-10-17, after 000921) org_creator_access, md5 1da0681b61ebe21162188f5a1a98cd84. Fixture only.
CREATE OR REPLACE FUNCTION public.org_creator_access(p_org bigint, p_created_by uuid, p_created_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_org IS NOT NULL
    AND p_created_by IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND p_created_by = auth.uid()
    AND (
      public.is_active_org_member(p_org)
      -- 000921: a linking shop's creator keeps access only while the clinic
      -- has no members (CRM edits of a clinic the shop added).
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.organization_memberships cm
          WHERE cm.organization_id = p_org
        )
        AND EXISTS (
          SELECT 1 FROM public.organization_customers oc
          WHERE oc.customer_organization_id = p_org
            AND public.is_active_org_member(oc.service_organization_id)
        )
      )
      OR (
        public.org_unclaimed_new(p_org, p_created_at)
        AND NOT EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = p_org
            AND o.creator_shop_org_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_reports r
          WHERE r.customer_organization_id = p_org
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.service_tickets t
          WHERE t.customer_organization_id = p_org
        )
      )
    );
$function$;
