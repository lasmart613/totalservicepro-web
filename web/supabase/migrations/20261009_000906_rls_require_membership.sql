-- Profile organization_id is not a membership.
--
-- About twenty live policies allowed a row when
-- organization_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
-- with no organization_memberships row. A user whose profile still points at
-- an org they have left kept access. The same hole was inside helpers:
-- get_my_org_id() could return a claimed clinic from user_profiles.organization_id
-- with no membership, and user_owns_or_created_org / caller_in_org /
-- customer_org_link_allowed trusted that value.
--
-- This file ANDs that profile-org match with public.is_active_org_member.
-- created_by, seller_id, owner_user_id, user_id, owned_by, and assigned_to_fse
-- branches stay as they are. service_reports keeps the organization_id::text
-- comparison.
--
-- get_my_org_id() no longer has the clinic fallback. A read-only pre-check on
-- 2026-10-09 found zero user_profiles rows whose organization_id or
-- active_organization_id lacked a membership (see
-- web/supabase/oneoff/20261009_rls_membership_precheck.sql).
--
-- Helpers reviewed and left as they are, because they do not trust a profile
-- org on their own:
--   user_org_id()                         delegates to get_my_org_id()
--   caller_ticket_in_org(bigint)          delegates to caller_in_org()
--   can_view_service_report_for_history   uses get_my_org_id / user_owns_or_created_org
--   auth_member_of_org                    already requires a membership
--   my_membership_org_ids                 already reads organization_memberships
--   profile_org_change_allowed            created_by, membership, or an open invite
--   tsp_resolve_entitlements              billing tier, not an RLS policy
--   is_admin                              user_profiles.role, not an org id
--
-- Policies that only call the helpers above are not rewritten. Hardening the
-- helpers closes them. organization_memberships policies are not rewritten:
-- they must not call is_active_org_member (the helper is SECURITY DEFINER and
-- reads that table).
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Do not apply the rollback in the same run. The migration runner applies
-- this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = p_org
  );
$$;

COMMENT ON FUNCTION public.is_active_org_member(bigint) IS
  'True when auth.uid() has an organization_memberships row for p_org. SECURITY DEFINER so RLS on organization_memberships is not re-entered. Those policies must not call this function.';

REVOKE ALL ON FUNCTION public.is_active_org_member(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_org_member(bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(bigint) TO authenticated;
-- organization_customers SELECT/DELETE policies are FOR public, which includes
-- anon. Anon must be able to execute the helper or those policies error
-- instead of denying. auth.uid() is null for anon, so the helper returns false.
GRANT EXECUTE ON FUNCTION public.is_active_org_member(bigint) TO anon;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.is_active_org_member(bigint) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers. Signatures stay. The profile-org branch requires a membership.
-- created_by on user_owns_or_created_org stays an OR.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    )
  );
$$;

COMMENT ON FUNCTION public.get_my_org_id() IS
  'Active shop: membership-validated active_organization_id, else a membership (home first). Does not return user_profiles.organization_id when that org has no membership.';

CREATE OR REPLACE FUNCTION public.user_owns_or_created_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    org_id IS NOT NULL
    AND (
      (
        org_id = public.get_my_org_id()
        AND public.is_active_org_member(org_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizations o
        WHERE o.id = org_id
          AND o.created_by = auth.uid()
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.caller_in_org(target bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT target IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      (
        target = public.get_my_org_id()
        AND public.is_active_org_member(target)
      )
      OR EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = target
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_service IS NOT NULL
    AND p_customer IS NOT NULL
    AND p_service = public.get_my_org_id()
    AND public.is_active_org_member(p_service)
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
$$;

-- ---------------------------------------------------------------------------
-- Policies. Same name, command, and role. Profile-org match requires
-- is_active_org_member. Other OR branches are unchanged.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Listing sellers update bid status" ON public.bids;
CREATE POLICY "Listing sellers update bid status"
  ON public.bids
  FOR UPDATE
  TO authenticated
  USING (
    listing_id IS NOT NULL
    AND listing_id IN (
      SELECT ml.id
      FROM public.marketplace_listings ml
      WHERE ml.seller_id = auth.uid()
        OR ml.created_by = auth.uid()
        OR (
          ml.organization_id IS NOT NULL
          AND ml.organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.organization_id IS NOT NULL
          )
          AND public.is_active_org_member(ml.organization_id)
        )
    )
  )
  WITH CHECK (
    listing_id IS NOT NULL
    AND listing_id IN (
      SELECT ml.id
      FROM public.marketplace_listings ml
      WHERE ml.seller_id = auth.uid()
        OR ml.created_by = auth.uid()
        OR (
          ml.organization_id IS NOT NULL
          AND ml.organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.organization_id IS NOT NULL
          )
          AND public.is_active_org_member(ml.organization_id)
        )
    )
  );

DROP POLICY IF EXISTS "Listing sellers view bids" ON public.bids;
CREATE POLICY "Listing sellers view bids"
  ON public.bids
  FOR SELECT
  TO authenticated
  USING (
    listing_id IS NOT NULL
    AND listing_id IN (
      SELECT ml.id
      FROM public.marketplace_listings ml
      WHERE ml.seller_id = auth.uid()
        OR ml.created_by = auth.uid()
        OR (
          ml.organization_id IS NOT NULL
          AND ml.organization_id IN (
            SELECT up.organization_id
            FROM public.user_profiles up
            WHERE up.id = auth.uid()
              AND up.organization_id IS NOT NULL
          )
          AND public.is_active_org_member(ml.organization_id)
        )
    )
  );

DROP POLICY IF EXISTS equipment_service_org_manage ON public.equipment;
CREATE POLICY equipment_service_org_manage
  ON public.equipment
  FOR ALL
  TO authenticated
  USING (
    public.user_owns_or_created_org(customer_organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.organization_customers oc
      JOIN public.user_profiles up
        ON up.organization_id = oc.service_organization_id
      WHERE up.id = auth.uid()
        AND oc.customer_organization_id = equipment.customer_organization_id
        AND public.is_active_org_member(oc.service_organization_id)
    )
  )
  WITH CHECK (
    public.user_owns_or_created_org(customer_organization_id)
    OR EXISTS (
      SELECT 1
      FROM public.organization_customers oc
      JOIN public.user_profiles up
        ON up.organization_id = oc.service_organization_id
      WHERE up.id = auth.uid()
        AND oc.customer_organization_id = equipment.customer_organization_id
        AND public.is_active_org_member(oc.service_organization_id)
    )
  );

DROP POLICY IF EXISTS locations_read ON public.inventory_locations;
CREATE POLICY locations_read
  ON public.inventory_locations
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS stock_read ON public.inventory_stock;
CREATE POLICY stock_read
  ON public.inventory_stock
  FOR SELECT
  TO authenticated
  USING (
    location_id IN (
      SELECT inventory_locations.id
      FROM public.inventory_locations
      WHERE inventory_locations.owner_user_id = auth.uid()
        OR (
          inventory_locations.organization_id IN (
            SELECT user_profiles.organization_id
            FROM public.user_profiles
            WHERE user_profiles.id = auth.uid()
          )
          AND public.is_active_org_member(inventory_locations.organization_id)
        )
    )
  );

-- Live polroles is empty, which is PUBLIC (anon and authenticated).
DROP POLICY IF EXISTS "Users can view their service org's customer links" ON public.organization_customers;
CREATE POLICY "Users can view their service org's customer links"
  ON public.organization_customers
  FOR SELECT
  TO public
  USING (
    service_organization_id IN (
      SELECT user_profiles.organization_id
      FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND public.is_active_org_member(service_organization_id)
  );

DROP POLICY IF EXISTS "Users can delete their org's customer links" ON public.organization_customers;
CREATE POLICY "Users can delete their org's customer links"
  ON public.organization_customers
  FOR DELETE
  TO public
  USING (
    service_organization_id IN (
      SELECT user_profiles.organization_id
      FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND public.is_active_org_member(service_organization_id)
  );

DROP POLICY IF EXISTS organization_manuals_member_select ON public.organization_manuals;
CREATE POLICY organization_manuals_member_select
  ON public.organization_manuals
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT user_profiles.organization_id
      FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND public.is_active_org_member(organization_id)
  );

DROP POLICY IF EXISTS organization_manuals_member_insert ON public.organization_manuals;
CREATE POLICY organization_manuals_member_insert
  ON public.organization_manuals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IN (
      SELECT user_profiles.organization_id
      FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND public.is_active_org_member(organization_id)
  );

DROP POLICY IF EXISTS organization_manuals_member_delete ON public.organization_manuals;
CREATE POLICY organization_manuals_member_delete
  ON public.organization_manuals
  FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT user_profiles.organization_id
      FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
    )
    AND public.is_active_org_member(organization_id)
  );

DROP POLICY IF EXISTS service_reports_select ON public.service_reports;
CREATE POLICY service_reports_select
  ON public.service_reports
  FOR SELECT
  TO authenticated
  USING (
    (
      (organization_id)::text = (
        SELECT (user_profiles.organization_id)::text
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
        LIMIT 1
      )
      AND public.is_active_org_member(organization_id)
    )
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS service_reports_insert ON public.service_reports;
CREATE POLICY service_reports_insert
  ON public.service_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      organization_id IS NULL
      OR (
        (organization_id)::text = (
          SELECT (user_profiles.organization_id)::text
          FROM public.user_profiles
          WHERE user_profiles.id = auth.uid()
          LIMIT 1
        )
        AND public.is_active_org_member(organization_id)
      )
    )
  );

DROP POLICY IF EXISTS service_reports_update ON public.service_reports;
CREATE POLICY service_reports_update
  ON public.service_reports
  FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      (organization_id)::text = (
        SELECT (user_profiles.organization_id)::text
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
        LIMIT 1
      )
      AND public.is_active_org_member(organization_id)
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (
      (organization_id)::text = (
        SELECT (user_profiles.organization_id)::text
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
        LIMIT 1
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS subscriptions_org_member_select ON public.subscriptions;
CREATE POLICY subscriptions_org_member_select
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS test_equipment_select ON public.test_equipment;
CREATE POLICY test_equipment_select
  ON public.test_equipment
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR assigned_to_fse = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS test_equipment_insert ON public.test_equipment;
CREATE POLICY test_equipment_insert
  ON public.test_equipment
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS test_equipment_update ON public.test_equipment;
CREATE POLICY test_equipment_update
  ON public.test_equipment
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR assigned_to_fse = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS test_equipment_delete ON public.test_equipment;
CREATE POLICY test_equipment_delete
  ON public.test_equipment
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR owned_by = auth.uid()
    OR (
      organization_id IN (
        SELECT user_profiles.organization_id
        FROM public.user_profiles
        WHERE user_profiles.id = auth.uid()
      )
      AND public.is_active_org_member(organization_id)
    )
  );

-- Extra policies. The text scan skipped these because a membership check is
-- already one OR branch. The profile-org branch still granted access alone.
DROP POLICY IF EXISTS engineer_invitations_select ON public.engineer_invitations;
CREATE POLICY engineer_invitations_select
  ON public.engineer_invitations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = engineer_invitations.organization_id
        AND lower(m.role) = ANY (ARRAY['company_admin'::text, 'owner'::text, 'service_manager'::text])
    )
    OR (
      EXISTS (
        SELECT 1
        FROM public.user_profiles p
        WHERE p.id = auth.uid()
          AND p.organization_id = engineer_invitations.organization_id
          AND lower(COALESCE(p.role, ''::text)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'owner'::text, 'service_manager'::text])
      )
      AND public.is_active_org_member(engineer_invitations.organization_id)
    )
  );

DROP POLICY IF EXISTS "Sellers read own marketplace orders" ON public.marketplace_orders;
CREATE POLICY "Sellers read own marketplace orders"
  ON public.marketplace_orders
  FOR SELECT
  TO authenticated
  USING (
    seller_organization_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.organization_memberships m
        WHERE m.user_id = (SELECT auth.uid() AS uid)
          AND m.organization_id = marketplace_orders.seller_organization_id
          AND lower(btrim(m.role)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'billing_manager'::text])
      )
      OR (
        EXISTS (
          SELECT 1
          FROM public.user_profiles p
          WHERE p.id = (SELECT auth.uid() AS uid)
            AND p.organization_id = marketplace_orders.seller_organization_id
            AND lower(btrim(p.role)) = ANY (ARRAY['admin'::text, 'company_admin'::text, 'billing_manager'::text])
        )
        AND public.is_active_org_member(marketplace_orders.seller_organization_id)
      )
    )
  );

-- organization_memberships policies must not call the helper. SECURITY DEFINER
-- already skips their RLS; this fails the migration if a policy was added that
-- would recurse once the helper is no longer definer-owned by a bypass role.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organization_memberships'
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%is_active_org_member%'
        OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%is_active_org_member%'
      )
  ) THEN
    RAISE EXCEPTION 'organization_memberships policies must not call is_active_org_member';
  END IF;
END $$;
