-- H2 STOPGAP (one-off, NOT a numbered migration). Do not apply without Larry's yes.
--
-- Cross-tenant report read by serial number: any signed-in user could create an
-- org, add equipment carrying a victim's serial (serials are only unique per org),
-- and read every shop's reports for that serial through the "transfer case"
-- branch of can_view_service_report_for_history.
--
-- This stopgap removes that branch entirely. Every other branch is unchanged.
-- Real transfers keep their history: ensureEquipment moves the SAME equipment row
-- to the new owner, and the "owns the linked equipment row" branch still covers it.
-- Impact measured read-only on prod (2026-10-17): 0 users lose access today
-- (11 serial-only views, all on 7 Luxor customer orgs with 0 members). See
-- /workspace/h2/IMPACT.md.
--
-- Rollback: 20261017_h2_stopgap_drop_transfer_branch_rollback.sql (restores the
-- exact prod body, md5 of pg_get_functiondef 90b5e7fe571ea1b49ea7dec72121782a).
-- Followed by migration 000920 (owner-consent service history grants), which
-- re-asserts this same body.

BEGIN;
SET LOCAL lock_timeout = '5s';

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

COMMIT;
