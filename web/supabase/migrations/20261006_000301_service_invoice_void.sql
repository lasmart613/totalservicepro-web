-- Void status for shop invoices.
-- The app writes status = 'void' plus these columns when they exist.
-- It also stores void_reason inside invoice_data so a void still saves
-- before this file is applied.
--
-- Do not apply this file to production from the app. Ship the SQL only.
--
-- Live service_invoices.status (read-only check): draft 16, sent 15, paid 2.
-- The table has no existing CHECK constraints. Those three values are in
-- the list below, so VALIDATE CONSTRAINT is safe for the rows that exist.
--
-- Allowed values are every status this repo assigns or classifies on
-- service_invoices:
--   written: draft, sent, paid, partially_paid, void
--   classified: voided, cancelled, canceled, partial, overdue, unpaid, invoiced
-- refunded is not assigned or classified anywhere, so it is not allowed.

alter table public.service_invoices
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

comment on column public.service_invoices.voided_at is
  'When an admin voided the invoice. status is void. Payments after this are ignored.';

comment on column public.service_invoices.void_reason is
  'Optional note entered when the invoice was voided.';

alter table public.service_invoices
  drop constraint if exists service_invoices_status_check;

alter table public.service_invoices
  add constraint service_invoices_status_check
  check (
    status is null
    or status in (
      'draft',
      'sent',
      'paid',
      'partially_paid',
      'partial',
      'void',
      'voided',
      'cancelled',
      'canceled',
      'overdue',
      'unpaid',
      'invoiced'
    )
  )
  not valid;

alter table public.service_invoices
  validate constraint service_invoices_status_check;
