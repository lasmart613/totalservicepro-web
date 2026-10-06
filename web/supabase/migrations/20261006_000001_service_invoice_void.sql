-- Void status for shop invoices.
-- The app writes status = 'void' plus these columns when they exist.
-- It also stores void_reason inside invoice_data so a void still saves
-- before this file is applied.
--
-- Do not apply this file to production from the app. Ship the SQL only.
-- Review service_invoices.status values before applying the check: a row
-- whose status is not in the list will fail the constraint.

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
      'unpaid'
    )
  );
