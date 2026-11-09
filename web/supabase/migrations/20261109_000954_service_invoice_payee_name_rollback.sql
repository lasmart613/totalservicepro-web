-- Remove the invoice payee columns. Does not rewrite other invoice fields.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_invoices
  DROP CONSTRAINT IF EXISTS service_invoices_payee_kind_check;

ALTER TABLE public.service_invoices
  DROP COLUMN IF EXISTS payee_name,
  DROP COLUMN IF EXISTS payee_kind;

NOTIFY pgrst, 'reload schema';
