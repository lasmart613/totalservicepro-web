-- Rollback 000958. Restores the 000957 job resolver.
-- That resolver folded a report or invoice onto a ticket only when ticket_id
-- was a numeric id. It does not drop service_org_reviews.
-- Repo only. Do not run against production from the pull request.

BEGIN;
SET LOCAL lock_timeout = '5s';

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
  v_link text;
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
    SELECT r.organization_id, r.customer_organization_id, r.status, r.finalized_at, r.ticket_id::text
      INTO v_org, v_customer, v_status, v_finalized, v_link
    FROM public.service_reports r
    WHERE r.id = p_report;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) IN ('complete', 'completed', 'finalized')
       OR v_finalized IS NOT NULL THEN
      v_eligible := true;
    END IF;
    IF public.service_org_review_parse_ticket(v_link) IS NOT NULL THEN
      IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM public.service_org_review_parse_ticket(v_link) THEN
        RETURN NULL;
      END IF;
      PERFORM 1
      FROM public.service_tickets t
      WHERE t.id = public.service_org_review_parse_ticket(v_link)
        AND t.organization_id = p_service
        AND t.customer_organization_id = p_customer;
      IF FOUND THEN
        v_ticket := public.service_org_review_parse_ticket(v_link);
      END IF;
    END IF;
  END IF;

  IF p_invoice IS NOT NULL THEN
    SELECT i.organization_id, i.customer_organization_id, i.status,
           pg_catalog.to_jsonb(i) ->> 'ticket_id'
      INTO v_org, v_customer, v_status, v_link
    FROM public.service_invoices i
    WHERE i.id = p_invoice;
    IF NOT FOUND OR v_org IS DISTINCT FROM p_service OR v_customer IS DISTINCT FROM p_customer THEN
      RETURN NULL;
    END IF;
    IF lower(pg_catalog.btrim(coalesce(v_status, ''))) = 'paid' THEN
      v_eligible := true;
    END IF;
    IF public.service_org_review_parse_ticket(v_link) IS NOT NULL THEN
      IF v_ticket IS NOT NULL AND v_ticket IS DISTINCT FROM public.service_org_review_parse_ticket(v_link) THEN
        RETURN NULL;
      END IF;
      PERFORM 1
      FROM public.service_tickets t
      WHERE t.id = public.service_org_review_parse_ticket(v_link)
        AND t.organization_id = p_service
        AND t.customer_organization_id = p_customer;
      IF FOUND THEN
        v_ticket := public.service_org_review_parse_ticket(v_link);
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
  '000957: canonical job key when a completed ticket, completed report, or paid invoice ties the two orgs. NULL otherwise. Does not read prices or notes.';

NOTIFY pgrst, 'reload schema';
COMMIT;
