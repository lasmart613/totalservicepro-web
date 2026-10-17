-- Rollback for 20261017_h2_stopgap_drop_transfer_branch.sql.
-- Restores the exact prod body captured read-only on 2026-10-17 with
-- pg_get_functiondef (md5 90b5e7fe571ea1b49ea7dec72121782a). This REOPENS H2.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
    -- Facility that currently owns the linked equipment row
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    )
    -- Facility that currently owns a laser with the same serial (transfer case)
    OR (
      r.serial_number IS NOT NULL
      AND trim(r.serial_number) <> ''
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.serial_number IS NOT NULL
          AND lower(trim(e.serial_number)) = lower(trim(r.serial_number))
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

COMMIT;
