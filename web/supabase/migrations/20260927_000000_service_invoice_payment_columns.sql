-- Payment columns the invoice form already writes.
-- Live service_invoices is missing these, so saves 400 and retry without
-- invoice_number, amount_paid, paid_at, and payment_method.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI). This repo does not auto-apply SQL.
-- Safe to re-run.

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text;

NOTIFY pgrst, 'reload schema';
