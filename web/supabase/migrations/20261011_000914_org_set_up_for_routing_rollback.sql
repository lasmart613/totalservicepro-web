-- Rollback for 20261011_000914_org_set_up_for_routing.sql.
-- Drops the routing function and the two organization_id indexes.
-- The app then treats the lookup as unknown and keeps the previous
-- onboarding path. Does not write profile rows.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Do not apply this in the same run as 000914. Safe to re-run.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.organization_is_set_up_for_routing(bigint);
DROP INDEX IF EXISTS public.service_tickets_organization_id_idx;
DROP INDEX IF EXISTS public.idx_service_reports_organization_id;

NOTIFY pgrst, 'reload schema';
