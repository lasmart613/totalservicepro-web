SET LOCAL lock_timeout = '5s';

-- Rollback for 000920 (service history owner consent).
-- Drops the grant table and its RPCs, and restores the live STOPGAPPED body of
-- can_view_service_report_for_history (H2 stopgap one-off, applied 2026-10-17;
-- pg_get_functiondef md5 4abb0da8e35302a52783eb49416f6b5a). It does NOT restore
-- the pre-stopgap serial-only branch: that would reopen H2. For that, use
-- web/supabase/oneoff/20261017_h2_stopgap_drop_transfer_branch_rollback.sql.
-- Dropping the table deletes every owner-consent grant.

DROP FUNCTION IF EXISTS public.get_shared_service_history(bigint, bigint);
DROP FUNCTION IF EXISTS public.revoke_service_history(bigint);
DROP FUNCTION IF EXISTS public.grant_service_history(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.service_history_owner_admin(bigint);
DROP TABLE IF EXISTS public.service_history_grants;

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r public.service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
