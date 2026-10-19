-- Rollback for 000930. Drops the leads table (and any lead rows in it) and
-- organizations.lead_source. Back up rows first if any real leads exist:
--   INSERT INTO public.migration_backup (label, source_table, row_pk, row_data)
--   SELECT 'clinic-leads-rollback', 'clinic_service_leads', id::text, to_jsonb(l)
--   FROM public.clinic_service_leads l;
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS public.clinic_service_leads;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS lead_source;
NOTIFY pgrst, 'reload schema';
COMMIT;
