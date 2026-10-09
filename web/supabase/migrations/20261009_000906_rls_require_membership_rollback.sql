-- Rollback for 20261009_000906_rls_require_membership.sql.
-- Restores the policy expressions and helper bodies pulled from project
-- yljztfajyvjzqikxdddf on 2026-10-09 (pg_get_expr / pg_get_functiondef),
-- then drops public.is_active_org_member(bigint).
--
-- Do not apply this in the same run as 000906. No top-level COMMIT.
-- Policies are restored first so nothing still depends on the helper.

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Listing sellers update bid status" ON public.bids;
CREATE POLICY "Listing sellers update bid status"
  ON public.bids
  FOR UPDATE
  TO authenticated
  USING (((listing_id IS NOT NULL) AND (listing_id IN ( SELECT ml.id
   FROM marketplace_listings ml
  WHERE ((ml.seller_id = auth.uid()) OR (ml.created_by = auth.uid()) OR ((ml.organization_id IS NOT NULL) AND (ml.organization_id IN ( SELECT up.organization_id
           FROM user_profiles up
          WHERE ((up.id = auth.uid()) AND (up.organization_id IS NOT NULL))))))))))
  WITH CHECK (((listing_id IS NOT NULL) AND (listing_id IN ( SELECT ml.id
   FROM marketplace_listings ml
  WHERE ((ml.seller_id = auth.uid()) OR (ml.created_by = auth.uid()) OR ((ml.organization_id IS NOT NULL) AND (ml.organization_id IN ( SELECT up.organization_id
           FROM user_profiles up
          WHERE ((up.id = auth.uid()) AND (up.organization_id IS NOT NULL))))))))));

DROP POLICY IF EXISTS "Listing sellers view bids" ON public.bids;
CREATE POLICY "Listing sellers view bids"
  ON public.bids
  FOR SELECT
  TO authenticated
  USING (((listing_id IS NOT NULL) AND (listing_id IN ( SELECT ml.id
   FROM marketplace_listings ml
  WHERE ((ml.seller_id = auth.uid()) OR (ml.created_by = auth.uid()) OR ((ml.organization_id IS NOT NULL) AND (ml.organization_id IN ( SELECT up.organization_id
           FROM user_profiles up
          WHERE ((up.id = auth.uid()) AND (up.organization_id IS NOT NULL))))))))));

DROP POLICY IF EXISTS equipment_service_org_manage ON public.equipment;
CREATE POLICY equipment_service_org_manage
  ON public.equipment
  FOR ALL
  TO authenticated
  USING ((user_owns_or_created_org(customer_organization_id) OR (EXISTS ( SELECT 1
   FROM (organization_customers oc
     JOIN user_profiles up ON ((up.organization_id = oc.service_organization_id)))
  WHERE ((up.id = auth.uid()) AND (oc.customer_organization_id = equipment.customer_organization_id))))))
  WITH CHECK ((user_owns_or_created_org(customer_organization_id) OR (EXISTS ( SELECT 1
   FROM (organization_customers oc
     JOIN user_profiles up ON ((up.organization_id = oc.service_organization_id)))
  WHERE ((up.id = auth.uid()) AND (oc.customer_organization_id = equipment.customer_organization_id))))));

DROP POLICY IF EXISTS locations_read ON public.inventory_locations;
CREATE POLICY locations_read
  ON public.inventory_locations
  FOR SELECT
  TO authenticated
  USING (((owner_user_id = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS stock_read ON public.inventory_stock;
CREATE POLICY stock_read
  ON public.inventory_stock
  FOR SELECT
  TO authenticated
  USING ((location_id IN ( SELECT inventory_locations.id
   FROM inventory_locations
  WHERE ((inventory_locations.owner_user_id = auth.uid()) OR (inventory_locations.organization_id IN ( SELECT user_profiles.organization_id
           FROM user_profiles
          WHERE (user_profiles.id = auth.uid())))))));

DROP POLICY IF EXISTS "Users can view their service org's customer links" ON public.organization_customers;
CREATE POLICY "Users can view their service org's customer links"
  ON public.organization_customers
  FOR SELECT
  TO public
  USING ((service_organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS "Users can delete their org's customer links" ON public.organization_customers;
CREATE POLICY "Users can delete their org's customer links"
  ON public.organization_customers
  FOR DELETE
  TO public
  USING ((service_organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS organization_manuals_member_select ON public.organization_manuals;
CREATE POLICY organization_manuals_member_select
  ON public.organization_manuals
  FOR SELECT
  TO authenticated
  USING ((organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS organization_manuals_member_insert ON public.organization_manuals;
CREATE POLICY organization_manuals_member_insert
  ON public.organization_manuals
  FOR INSERT
  TO authenticated
  WITH CHECK ((organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS organization_manuals_member_delete ON public.organization_manuals;
CREATE POLICY organization_manuals_member_delete
  ON public.organization_manuals
  FOR DELETE
  TO authenticated
  USING ((organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS service_reports_select ON public.service_reports;
CREATE POLICY service_reports_select
  ON public.service_reports
  FOR SELECT
  TO authenticated
  USING ((((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1)) OR (created_by = auth.uid())));

DROP POLICY IF EXISTS service_reports_insert ON public.service_reports;
CREATE POLICY service_reports_insert
  ON public.service_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (((created_by = auth.uid()) AND ((organization_id IS NULL) OR ((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1)))));

DROP POLICY IF EXISTS service_reports_update ON public.service_reports;
CREATE POLICY service_reports_update
  ON public.service_reports
  FOR UPDATE
  TO authenticated
  USING (((created_by = auth.uid()) OR ((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1))))
  WITH CHECK (((created_by = auth.uid()) OR ((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1))));

DROP POLICY IF EXISTS subscriptions_org_member_select ON public.subscriptions;
CREATE POLICY subscriptions_org_member_select
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS test_equipment_select ON public.test_equipment;
CREATE POLICY test_equipment_select
  ON public.test_equipment
  FOR SELECT
  TO authenticated
  USING (((user_id = auth.uid()) OR (owned_by = auth.uid()) OR (assigned_to_fse = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS test_equipment_insert ON public.test_equipment;
CREATE POLICY test_equipment_insert
  ON public.test_equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = auth.uid()) OR (owned_by = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS test_equipment_update ON public.test_equipment;
CREATE POLICY test_equipment_update
  ON public.test_equipment
  FOR UPDATE
  TO authenticated
  USING (((user_id = auth.uid()) OR (owned_by = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))))
  WITH CHECK (((user_id = auth.uid()) OR (owned_by = auth.uid()) OR (assigned_to_fse = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS test_equipment_delete ON public.test_equipment;
CREATE POLICY test_equipment_delete
  ON public.test_equipment
  FOR DELETE
  TO authenticated
  USING (((user_id = auth.uid()) OR (owned_by = auth.uid()) OR (organization_id IN ( SELECT user_profiles.organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())))));

DROP POLICY IF EXISTS engineer_invitations_select ON public.engineer_invitations;
CREATE POLICY engineer_invitations_select
  ON public.engineer_invitations
  FOR SELECT
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM organization_memberships m
  WHERE ((m.user_id = auth.uid()) AND (m.organization_id = engineer_invitations.organization_id) AND (lower(m.role) = ANY (ARRAY['company_admin'::text, 'owner'::text, 'service_manager'::text]))))) OR (EXISTS ( SELECT 1
   FROM user_profiles p
  WHERE ((p.id = auth.uid()) AND (p.organization_id = engineer_invitations.organization_id) AND (lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'owner'::text, 'service_manager'::text])))))));

DROP POLICY IF EXISTS "Sellers read own marketplace orders" ON public.marketplace_orders;
CREATE POLICY "Sellers read own marketplace orders"
  ON public.marketplace_orders
  FOR SELECT
  TO authenticated
  USING (((seller_organization_id IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM organization_memberships m
  WHERE ((m.user_id = ( SELECT auth.uid() AS uid)) AND (m.organization_id = marketplace_orders.seller_organization_id) AND (lower(btrim(m.role)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'billing_manager'::text]))))) OR (EXISTS ( SELECT 1
   FROM user_profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.organization_id = marketplace_orders.seller_organization_id) AND (lower(btrim(p.role)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'billing_manager'::text]))))))));

-- Exact pg_get_functiondef bodies from 2026-10-09, before 000906.

CREATE OR REPLACE FUNCTION public.get_my_org_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (
      SELECT p.active_organization_id
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.active_organization_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.organization_memberships m
          WHERE m.user_id = auth.uid()
            AND m.organization_id = p.active_organization_id
        )
      LIMIT 1
    ),
    (
      SELECT m.organization_id
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
      ORDER BY m.is_home DESC NULLS LAST, m.created_at ASC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT p.organization_id
      FROM public.user_profiles p
      JOIN public.organizations o ON o.id = p.organization_id
      WHERE p.id = auth.uid()
        AND o.created_by IS DISTINCT FROM auth.uid()
        AND lower(coalesce(o.type, '')) IN (
          'customer', 'laser_clinic', 'laser_rental', 'laser_reseller'
        )
      LIMIT 1
    )
  );
$function$;

COMMENT ON FUNCTION public.get_my_org_id() IS
  'Active shop: membership-validated active_organization_id, else a membership (home first), else a claimed clinic the caller did not create. Not an unchecked user_profiles.organization_id.';

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    org_id IS NOT NULL
    AND (
      org_id = public.get_my_org_id()
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND o.created_by = auth.uid()
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.caller_in_org(target bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT target IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      target = public.get_my_org_id()
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = target
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = p_customer
        AND o.type IN ('customer', 'laser_clinic', 'laser_rental', 'laser_reseller')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_customers existing
      WHERE existing.customer_organization_id = p_customer
        AND existing.service_organization_id IS DISTINCT FROM p_service
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = p_customer
          AND o.type = 'customer'
          AND o.created_by IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = o.created_by
              AND m.organization_id = p_service
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.engineer_invitations i
        JOIN public.organization_memberships m
          ON m.user_id = i.invited_by
         AND m.organization_id = p_service
         AND lower(m.role) IN ('company_admin', 'owner', 'service_manager', 'crm')
        WHERE i.organization_id = p_customer
          AND i.accepted IS TRUE
          AND lower(coalesce(i.role, '')) = 'owner'
      )
    );
$function$;

DROP FUNCTION IF EXISTS public.is_active_org_member(bigint);
