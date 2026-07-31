-- Link service history to lasers across owner transfers and FSE hand-offs.
-- Mirror of PhotometryTools v1.2 migration.

ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS equipment_id bigint REFERENCES public.equipment(id) ON DELETE SET NULL;

ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS customer_organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_reports_equipment_id
  ON public.service_reports (equipment_id)
  WHERE equipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_reports_serial_number_lower
  ON public.service_reports (lower(trim(serial_number)))
  WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';

CREATE INDEX IF NOT EXISTS idx_equipment_serial_lower
  ON public.equipment (lower(trim(serial_number)))
  WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';

CREATE OR REPLACE FUNCTION public.can_view_service_report_for_history(r public.service_reports)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (r.organization_id IS NOT NULL AND r.organization_id = public.get_my_org_id())
    OR (r.created_by IS NOT NULL AND r.created_by = auth.uid())
    OR (
      r.customer_organization_id IS NOT NULL
      AND public.user_owns_or_created_org(r.customer_organization_id)
    )
    OR (
      r.equipment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.equipment e
        WHERE e.id = r.equipment_id
          AND public.user_owns_or_created_org(e.customer_organization_id)
      )
    )
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
    OR (
      r.customer_organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_customers oc
        WHERE oc.customer_organization_id = r.customer_organization_id
          AND oc.service_organization_id = public.get_my_org_id()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_view_service_report_for_history(public.service_reports) TO authenticated;

DROP POLICY IF EXISTS service_reports_equipment_history_select ON public.service_reports;

CREATE POLICY service_reports_equipment_history_select
  ON public.service_reports
  FOR SELECT
  TO authenticated
  USING (public.can_view_service_report_for_history(service_reports));

SELECT 'ok' AS service_report_equipment_history;
