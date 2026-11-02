-- 000949: Service Report "Work Performed" and "Pending Issues / Watch Items
-- to be Addressed on Next Visit". NOT APPLIED — needs Larry's OK.
-- Two nullable text columns. No rows are changed. RLS is row-level on
-- service_reports and grants are table-level, so existing policies cover the
-- new columns. No views or RPCs select service_reports columns by name.
ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS work_performed text,
  ADD COLUMN IF NOT EXISTS pending_issues text;

COMMENT ON COLUMN public.service_reports.work_performed IS 'Free text: work performed on this visit.';
COMMENT ON COLUMN public.service_reports.pending_issues IS 'Free text: pending issues / watch items for the next visit. Carried forward to the next ticket for the same equipment (same org).';

-- Carry-forward lookup by serial within an org (equipment_id is already indexed).
CREATE INDEX IF NOT EXISTS idx_service_reports_org_serial
  ON public.service_reports (organization_id, serial_number);

NOTIFY pgrst, 'reload schema';
