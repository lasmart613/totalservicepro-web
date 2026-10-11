-- Rollback for 20261010_000909_service_reports_require_membership.sql.
-- Restores service_reports_select and service_reports_update from
-- pg_policies on yljztfajyvjzqikxdddf, read on 2026-10-11, and restores
-- public.can_view_service_report_for_history from pg_get_functiondef on
-- that same read. Those are the live definitions from 000906 (profile
-- branch already calls is_active_org_member; created_by does not) and from
-- the equipment-history function. Does not drop is_active_org_member.
-- Does not rewrite service_reports rows.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Do not apply this in the same run as the forward migration. The migration
-- runner applies this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS service_reports_select ON public.service_reports;
CREATE POLICY service_reports_select
  ON public.service_reports
  FOR SELECT
  TO authenticated
  USING (((((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1)) AND is_active_org_member(organization_id)) OR (created_by = auth.uid())));

DROP POLICY IF EXISTS service_reports_update ON public.service_reports;
CREATE POLICY service_reports_update
  ON public.service_reports
  FOR UPDATE
  TO authenticated
  USING (((created_by = auth.uid()) OR (((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1)) AND is_active_org_member(organization_id))))
  WITH CHECK (((created_by = auth.uid()) OR (((organization_id)::text = ( SELECT (user_profiles.organization_id)::text AS organization_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid())
 LIMIT 1)) AND is_active_org_member(organization_id))));

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r service_reports)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- Own service company reports
    (r.organization_id IS NOT NULL AND r.organization_id = public.get_my_org_id())
    OR (r.created_by IS NOT NULL AND r.created_by = auth.uid())
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
