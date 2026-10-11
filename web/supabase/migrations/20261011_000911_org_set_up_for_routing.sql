-- Routing signal: an organization is already set up when it has a name and
-- at least one customer, ticket, or service report.
--
-- organization_customers.service_organization_id is the customer link
-- (idx_org_customers_service_org and organization_customers_unique already
-- cover it). Tickets and jobs are service_tickets.organization_id. Reports
-- are service_reports.organization_id. Those two organization_id columns
-- had no index, so the EXISTS checks below add one each.
--
-- organization_is_set_up_for_routing is read-only. It does not write
-- profile rows or any other row. SECURITY INVOKER so
-- RLS still hides orgs, customers, tickets, and reports the caller cannot
-- read. A hidden org comes back false. The web client treats an RPC error
-- as "unknown" and keeps the current onboarding path.
--
-- APPLY ON LIVE SUPABASE after review. This repo does not auto-apply SQL.
-- Do not apply the rollback in the same run. The migration runner applies
-- this file as one transaction. Safe to re-run. Do not apply from the app
-- deploy.

SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS service_tickets_organization_id_idx
  ON public.service_tickets (organization_id);

CREATE INDEX IF NOT EXISTS idx_service_reports_organization_id
  ON public.service_reports (organization_id);

CREATE OR REPLACE FUNCTION public.organization_is_set_up_for_routing(p_organization_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = p_organization_id
      AND o.name IS NOT NULL
      AND pg_catalog.btrim(o.name) <> ''
      AND (
        EXISTS (
          SELECT 1
          FROM public.organization_customers c
          WHERE c.service_organization_id = o.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.service_tickets t
          WHERE t.organization_id = o.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.service_reports r
          WHERE r.organization_id = o.id
        )
      )
  );
$$;

COMMENT ON FUNCTION public.organization_is_set_up_for_routing(bigint) IS
  'True when the org has a non-blank name and at least one organization_customers, service_tickets, or service_reports row. Read-only routing signal. Does not write profile rows.';

REVOKE ALL ON FUNCTION public.organization_is_set_up_for_routing(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organization_is_set_up_for_routing(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
