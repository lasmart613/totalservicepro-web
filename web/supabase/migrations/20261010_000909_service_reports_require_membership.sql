-- A former author kept service_reports access through created_by = auth.uid()
-- after they left the report's organization.
--
-- 000906 ANDed public.is_active_org_member onto the profile-organization
-- branch and left the created_by branch as an OR. Live policies on
-- yljztfajyvjzqikxdddf (read from pg_policies on 2026-10-11) are still that
-- shape. The helper is public.is_active_org_member(p_org bigint) from
-- 000906. This file does not replace it.
--
-- UPDATE (USING and WITH CHECK) now requires that helper on the created_by
-- branch as well as on the profile branch. A former member cannot edit the
-- old shop's report. An author who still has an organization_memberships
-- row for the report's organization can, including when user_profiles
-- .organization_id points somewhere else.
--
-- SELECT gets the same predicate. That does not take away a current
-- member's read: the profile branch is unchanged, and an author who is
-- still a member still matches created_by. It also does not take away
-- equipment-history reads that are not "I wrote this for a shop I have
-- left." service_reports_equipment_history_select is a second permissive
-- SELECT policy and calls public.can_view_service_report_for_history.
-- That function's created_by arm was the same hole, so leaving it in place
-- would keep former authors able to read. The other arms stay: the caller's
-- active org (get_my_org_id, which already requires a membership), the
-- customer facility (user_owns_or_created_org), the facility that owns the
-- linked equipment or the same serial, and a service org linked through
-- organization_customers. service_report_items SELECT uses the same
-- function, so line items follow the report.
--
-- is_active_org_member(NULL) is false. A report with no organization_id
-- is not visible or editable through created_by. Live count of those rows
-- on 2026-10-11 was 0. INSERT is unchanged and still allows
-- organization_id IS NULL; this file does not recreate that policy.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Do not apply the rollback in the same run. The migration runner applies
-- this file as one transaction. Safe to re-run.

SET LOCAL lock_timeout = '5s';

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
    OR (
      created_by = auth.uid()
      AND public.is_active_org_member(organization_id)
    )
  );

DROP POLICY IF EXISTS service_reports_update ON public.service_reports;
CREATE POLICY service_reports_update
  ON public.service_reports
  FOR UPDATE
  TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND public.is_active_org_member(organization_id)
    )
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
    (
      created_by = auth.uid()
      AND public.is_active_org_member(organization_id)
    )
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

-- Same created_by gate as the policies above. Other history arms are copied
-- from the live function (pg_get_functiondef on 2026-10-11).
CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r public.service_reports)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
