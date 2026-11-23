-- Rollback 000963. Drops the credited-session table and its function.
-- Does not change service_invoices.stripe_session_id, amount_paid, or
-- invoice_data. Sessions credited only in the dropped table are no longer
-- recorded there; the invoice columns are left as they are.
--
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb);

DROP TABLE IF EXISTS public.service_invoice_stripe_payments;

NOTIFY pgrst, 'reload schema';
