-- 000958: one job key for a ticket, its service report, and its paid invoice.
--
-- 000957 folded a report or invoice onto a ticket only through ticket_id.
-- On production service_reports.ticket_id is uuid and is unset (numeric
-- ticket ids are not stored there; the report keeps ticket_number text).
-- service_invoices has no ticket_id column. The shared links are:
--   service_reports.ticket_number = service_tickets.ticket_number
--   service_invoices.estimate_id  = service_tickets.estimate_id
-- Both matches also require the same service org and customer org.
-- A uuid in service_reports.ticket_id is ignored. An invoice with no
-- estimate_id stays its own job. Ambiguous ticket numbers are not folded.
--
-- Replaces public.service_org_review_resolve only. The reviews table is
-- not altered. Live has no review rows. CREATE OR REPLACE is re-runnable.
--
-- Repo only. Do not apply this file to production from the pull request.
-- Never use orgs 4, 153, 154, 1005, 2616, 5509, or 5515.
--
-- Rollback: 20261116_000958_service_org_review_job_link_rollback.sql

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_report_ticket_id oid;
BEGIN
  IF to_regprocedure('public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint)') IS NULL THEN
    RAISE EXCEPTION '000958 drift: apply 000957 before 000958';
  END IF;
  IF to_regclass('public.service_tickets') IS NULL
     OR to_regclass('public.service_reports') IS NULL
     OR to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000958 drift: tickets, reports, or invoices are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_tickets'::regclass
      AND attname = 'ticket_number' AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_tickets'::regclass
      AND attname = 'estimate_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000958 drift: service_tickets.ticket_number or estimate_id is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_reports'::regclass
      AND attname = 'ticket_number' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000958 drift: service_reports.ticket_number is missing';
  END IF;
  SELECT a.atttypid INTO v_report_ticket_id
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.service_reports'::regclass
    AND a.attname = 'ticket_id' AND NOT a.attisdropped;
  IF v_report_ticket_id IS NOT NULL AND v_report_ticket_id IS DISTINCT FROM 'uuid'::regtype THEN
    RAISE EXCEPTION '000958 drift: service_reports.ticket_id is not uuid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'estimate_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000958 drift: service_invoices.estimate_id is missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.service_org_review_resolve(
  p_customer bigint,
  p_service bigint,
  p_ticket bigint,
  p_report uuid,
  p_invoice bigint
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eligible boolean := false;
  v_ticket bigint := NULL;
  v_status text;
  v_org bigint;
  v_customer bigint;
  v_finalized timestamptz;
  v_number text;
  v_estimate bigint;
  v_matches integer;
  v_found bigint;
BEGIN
  IF p_customer IS NULL OR p_service IS NULL OR p_customer = p_service THEN
    RETURN NULL;
  END IF;
  IF p_ticket IS NULL AND p_report IS NULL AND p_invoice IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_ticket IS NOT NULL THEN
    SELECT t.organization_id, t.customer_organization_id, t.status
      INTO v_org, v_customer, v_status
    FROM public.service_tickets t
    WHERE t.id = p_ticket;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    v_ticket := p_ticket;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) IN ('completed', 'closed') THEN
      v_eligible := true;
    END IF;
  END IF;

  IF p_report IS NOT NULL THEN
    -- ticket_id on the report is uuid and is not the service_tickets.id.
    SELECT r.organization_id, r.customer_organization_id, r.status, r.finalized_at,
           pg_catalog.btrim(coalesce(r.ticket_number, ''))
      INTO v_org, v_customer, v_status, v_finalized, v_number
    FROM public.service_reports r
    WHERE r.id = p_report;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) IN ('complete', 'completed', 'finalized')
       OR v_finalized IS NOT NULL THEN
      v_eligible := true;
    END IF;
    IF v_number <> '' THEN
      SELECT count(*)::integer, min(t.id)
        INTO v_matches, v_found
      FROM public.service_tickets t
      WHERE t.organization_id = p_service
        AND t.customer_organization_id = p_customer
        AND pg_catalog.btrim(coalesce(t.ticket_number, '')) = v_number;
      IF v_matches = 1 THEN
        IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM v_found THEN
          RETURN NULL;
        END IF;
        v_ticket := v_found;
      ELSIF v_matches > 1 AND v_ticket IS NOT NULL THEN
        PERFORM 1
        FROM public.service_tickets t
        WHERE t.id = v_ticket
          AND pg_catalog.btrim(coalesce(t.ticket_number, '')) = v_number;
        IF NOT FOUND THEN
          RETURN NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_invoice IS NOT NULL THEN
    SELECT i.organization_id, i.customer_organization_id, i.status, i.estimate_id
      INTO v_org, v_customer, v_status, v_estimate
    FROM public.service_invoices i
    WHERE i.id = p_invoice;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) = 'paid' THEN
      v_eligible := true;
    END IF;
    IF v_estimate IS NOT NULL THEN
      SELECT count(*)::integer, min(t.id)
        INTO v_matches, v_found
      FROM public.service_tickets t
      WHERE t.organization_id = p_service
        AND t.customer_organization_id = p_customer
        AND t.estimate_id = v_estimate;
      IF v_matches = 1 THEN
        IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM v_found THEN
          RETURN NULL;
        END IF;
        v_ticket := v_found;
      ELSIF v_matches > 1 AND v_ticket IS NOT NULL THEN
        PERFORM 1
        FROM public.service_tickets t
        WHERE t.id = v_ticket AND t.estimate_id = v_estimate;
        IF NOT FOUND THEN
          RETURN NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_eligible THEN
    RETURN NULL;
  END IF;
  IF v_ticket IS NOT NULL THEN
    RETURN 'ticket:' || v_ticket::text;
  END IF;
  IF p_report IS NOT NULL THEN
    RETURN 'report:' || p_report::text;
  END IF;
  RETURN 'invoice:' || p_invoice::text;
END;
$$;

COMMENT ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) IS
  '000958: one job key. A report joins its ticket by ticket_number. A paid invoice joins by estimate_id. service_reports.ticket_id (uuid) is not a ticket id. Does not read prices or notes.';

REVOKE ALL ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_org_review_resolve(bigint, bigint, bigint, uuid, bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
