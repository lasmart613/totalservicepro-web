-- Rollback 000962. Restores the 000803 guard: a signed-in client still
-- cannot set or change stripe_session_id, and can change invoice_data
-- payment_url and checkout session id keys again.
-- Does not drop stripe_session_id. Does not rewrite invoice rows.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.stripe_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'stripe_session_id cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id THEN
    RAISE EXCEPTION 'stripe_session_id cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_invoices_guard_stripe_session() IS
  'Latest Stripe Checkout session credited on this invoice is not client-writable. auth.uid() IS NULL (service role) still writes stripe_session_id.';

REVOKE EXECUTE ON FUNCTION public.service_invoices_guard_stripe_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE INSERT OR UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_guard_stripe_session();

NOTIFY pgrst, 'reload schema';
