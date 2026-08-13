-- Unique document numbers per org (estimates / invoices).
-- If this fails on existing duplicates, re-number colliding rows first.

CREATE UNIQUE INDEX IF NOT EXISTS service_estimates_org_number_uidx
  ON public.service_estimates (organization_id, estimate_number)
  WHERE estimate_number IS NOT NULL AND btrim(estimate_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_org_number_uidx
  ON public.service_invoices (organization_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND btrim(invoice_number) <> '';
