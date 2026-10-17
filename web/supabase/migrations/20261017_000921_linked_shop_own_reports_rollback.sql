SET LOCAL lock_timeout = '5s';

-- Rollback for 000921. Restores the exact prior state:
--   - can_view_service_report_for_history: the 000920 / live stopgapped body
--     (md5 4abb0da8e35302a52783eb49416f6b5a), which has the linked-shop branch.
--   - customer_org_link_allowed: the exact live body captured read-only on
--     2026-10-17 (md5 b29880941434873db018651aaa71c5ac, search_path public, pg_temp).
--   - service_history_owner_admin EXECUTE back to authenticated (000920).
--   - service_history_grants_select policy as in 000920 (owner OR grantee).
--   - get_shared_service_history(bigint, bigint) as in 000920.
-- Drops the owner link RPCs, list_my_service_history_grants and the block table
-- (owner removals are forgotten; removed links are NOT re-created).

CREATE OR REPLACE FUNCTION public.customer_org_link_allowed(p_service bigint, p_customer bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.customer_org_link_allowed(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_org_link_allowed(bigint, bigint) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.allow_linked_service_shop(bigint, bigint);
DROP FUNCTION IF EXISTS public.remove_linked_service_shop(bigint, bigint, boolean);
DROP FUNCTION IF EXISTS public.list_linked_service_shops(bigint);
DROP TABLE IF EXISTS public.organization_customer_link_blocks;

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r public.service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT
    -- Own service company reports
    (r.organization_id IS NOT NULL AND r.organization_id = public.get_my_org_id())
    OR (
      r.created_by IS NOT NULL
      AND r.created_by = auth.uid()
      AND public.is_active_org_member(r.organization_id)
    )
    -- Facility that is the report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND public.user_owns_or_created_org(r.customer_organization_id)
    )
    -- Facility that currently owns the linked equipment row (real transfers
    -- move this row, so history follows them)
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    )
    -- Service org linked via organization_customers to report customer
    OR (
      r.customer_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = r.customer_organization_id
          AND oc.service_organization_id = public.get_my_org_id()
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.can_view_service_report_for_history(public.service_reports) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_service_report_for_history(public.service_reports) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.service_history_owner_admin(bigint) TO authenticated;

DROP FUNCTION IF EXISTS public.list_my_service_history_grants();

DROP POLICY IF EXISTS service_history_grants_select ON public.service_history_grants;
CREATE POLICY service_history_grants_select ON public.service_history_grants
  FOR SELECT TO authenticated
  USING (
    public.is_active_org_member(owner_org_id)
    OR public.is_active_org_member(grantee_shop_org_id)
  );

DROP FUNCTION IF EXISTS public.get_shared_service_history(bigint, bigint, integer, integer);

CREATE OR REPLACE FUNCTION public.get_shared_service_history(
  p_owner_org bigint,
  p_equipment_id bigint DEFAULT NULL
)
 RETURNS TABLE (
   id uuid,
   report_number text,
   status text,
   service_type text,
   model_type text,
   equipment_name text,
   equipment_type text,
   serial_number text,
   equipment_id bigint,
   date_out date,
   next_pm_due date,
   created_at timestamptz,
   finalized_at timestamptz,
   service_company_name text,
   service_organization_id bigint,
   customer_organization_id bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
  WITH me AS (
    SELECT public.get_my_org_id() AS shop
  )
  SELECT r.id, r.report_number, r.status, r.service_type, r.model_type,
         r.equipment_name, r.equipment_type, r.serial_number, r.equipment_id,
         r.date_out, r.next_pm_due, r.created_at, r.finalized_at,
         r.tech_company_name, r.organization_id, r.customer_organization_id
  FROM me
  JOIN public.service_reports r
    ON r.customer_organization_id = p_owner_org
  WHERE p_owner_org IS NOT NULL
    AND me.shop IS NOT NULL
    AND public.is_active_org_member(me.shop)
    AND EXISTS (
      SELECT 1
      FROM public.service_history_grants g
      LEFT JOIN public.equipment ge ON ge.id = g.equipment_id
      WHERE g.owner_org_id = p_owner_org
        AND g.grantee_shop_org_id = me.shop
        AND g.revoked_at IS NULL
        AND (
          g.equipment_id IS NULL
          OR g.equipment_id = r.equipment_id
          OR (
            r.equipment_id IS NULL
            AND ge.serial_number IS NOT NULL
            AND btrim(ge.serial_number) <> ''
            AND lower(btrim(ge.serial_number)) = lower(btrim(r.serial_number))
          )
        )
    )
    AND (
      p_equipment_id IS NULL
      OR r.equipment_id = p_equipment_id
      OR (
        r.equipment_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.equipment pe
          WHERE pe.id = p_equipment_id
            AND pe.customer_organization_id = p_owner_org
            AND btrim(COALESCE(pe.serial_number, '')) <> ''
            AND lower(btrim(pe.serial_number)) = lower(btrim(r.serial_number))
        )
      )
    )
  ORDER BY COALESCE(r.date_out::timestamptz, r.created_at) DESC NULLS LAST
  LIMIT 500;
$function$;

REVOKE ALL ON FUNCTION public.get_shared_service_history(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_service_history(bigint, bigint) TO authenticated;
