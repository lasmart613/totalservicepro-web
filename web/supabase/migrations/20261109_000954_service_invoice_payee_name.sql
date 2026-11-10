-- Who an invoice is payable to.
--
-- organization (default) keeps today's behavior: the document uses
-- organizations.name. personal means the invoice was issued under the
-- signed-in user's profile name. payee_name is that name at save time,
-- so a reprint does not follow a later rename or a different signed-in user.
--
-- Existing rows receive payee_kind = organization via the column default.
-- payee_name stays null, and the app still prints the organization name.
-- This file does not UPDATE invoice rows and does not read or write any
-- organization. Do not apply it from the app. Safe to re-run.
--
-- Apply this on the database before the payee columns are required.
-- Until then, the invoice form also stores the same keys in invoice_data.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS payee_kind text NOT NULL DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS payee_name text;

ALTER TABLE public.service_invoices
  DROP CONSTRAINT IF EXISTS service_invoices_payee_kind_check;

ALTER TABLE public.service_invoices
  ADD CONSTRAINT service_invoices_payee_kind_check
  CHECK (payee_kind IN ('organization', 'personal'));

COMMENT ON COLUMN public.service_invoices.payee_kind IS
  'organization (default) or personal. Who the customer should write the check to.';
COMMENT ON COLUMN public.service_invoices.payee_name IS
  'Snapshot of the payee name printed on the invoice. Null uses the organization name.';

NOTIFY pgrst, 'reload schema';
