-- Rollback 000949.
DROP INDEX IF EXISTS public.idx_service_reports_org_serial;
ALTER TABLE public.service_reports
  DROP COLUMN IF EXISTS work_performed,
  DROP COLUMN IF EXISTS pending_issues;
NOTIFY pgrst, 'reload schema';
