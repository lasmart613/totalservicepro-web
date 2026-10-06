-- Claim column so two overlapping invoice Checkout webhooks cannot both
-- credit the same Stripe session. The webhook update matches only when
-- stripe_session_id is null or a different session, and credits only when
-- that update returns a row.
--
-- APPLY ON LIVE SUPABASE (SQL Editor or CLI) after review.
-- This repo does not auto-apply SQL. Safe to re-run.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.service_invoices
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

COMMENT ON COLUMN public.service_invoices.stripe_session_id IS
  'Latest Stripe Checkout session credited on this invoice. A webhook claims the row only when this is null or a different session.';

-- Authenticated holds table-level UPDATE on service_invoices, so REVOKE UPDATE
-- on this column alone is a no-op while that grant exists. A client could set
-- stripe_session_id to an in-flight Checkout session and block the claim.
-- This trigger is separate from guard_tenant_owner_cols, the other trigger
-- on service_invoices. Do not edit that shared function.
-- auth.uid() is null for the service role, so the webhook claim still writes
-- the column. A signed-in insert cannot set it. A signed-in update cannot
-- change it. An update that leaves the value alone still returns NEW.

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

REVOKE EXECUTE ON FUNCTION public.service_invoices_guard_stripe_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE INSERT OR UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_guard_stripe_session();

NOTIFY pgrst, 'reload schema';
