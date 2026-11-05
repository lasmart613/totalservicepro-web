-- Drop the finalized-invoice status guard. Does not rewrite invoice rows.

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS service_invoices_keep_finalized_status ON public.service_invoices;
DROP FUNCTION IF EXISTS public.service_invoices_keep_finalized_status();

NOTIFY pgrst, 'reload schema';
