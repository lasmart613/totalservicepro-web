-- 000962: stop a signed-in client from planting a pay link or a Checkout
-- session id on service_invoices.
--
-- Extends public.service_invoices_guard_stripe_session from
-- 20261006_000803_service_invoice_stripe_session_claim.sql. CREATE OR REPLACE
-- keeps that function's stripe_session_id rules:
--   * auth.uid() IS NULL returns NEW immediately (service role, and any
--     session with no user id, including the postgres owner)
--   * a signed-in INSERT cannot set stripe_session_id
--   * a signed-in UPDATE cannot change stripe_session_id
--   * an update that leaves stripe_session_id alone still returns NEW
--
-- The same gate now covers invoice_data keys a client could use to redirect
-- the public pay page or to satisfy its session check:
--   * payment_url
--   * any top-level key whose name starts with stripe_checkout_session
--     (stripe_checkout_session_id, stripe_checkout_session_ids, and the same
--     names in any letter case)
--   * stripe_checkout_expired_ids
-- JSON null and a missing key are the same value. Other invoice_data keys
-- still save. A signed-in write that keeps these values is allowed.
--
-- invoice_data must be a JSON object for a signed-in write. A string,
-- array, number, or other non-object is rejected even when the row had no
-- locked keys yet. parseInvoiceData accepts a JSON string, so a string
-- such as '{"payment_url":"...","stripe_checkout_session_id":"cs_X"}'
-- would otherwise pass this trigger and then satisfy the public pay page.
--
-- A non-object OLD value is fully locked for client writes. It is not
-- unwrapped. #>> '{}' would honor keys only when the text is one valid
-- object, and a parse miss (or a second encoding) would let the client
-- replace the value and plant a pay link. The client cannot change that
-- value, including by rewriting it as an object. Because NEW is the whole
-- row, a client update of any column on a non-object row is rejected too:
-- NEW.invoice_data is still that non-object. The service role can rewrite
-- it to an object. SQL NULL is not a JSON value and is not locked.
--
-- Who writes them today, and which role that uses:
--   * send-invoice persists payment_url and stripe_checkout_session_id with
--     getSupabaseAdmin() when SUPABASE_SERVICE_ROLE_KEY is set
--     (app/api/billing/send-invoice/route.ts, writer = admin ?? supabase).
--     The service-role JWT has no sub, so auth.uid() is null and this
--     trigger returns NEW. The user-JWT fallback runs only when that key
--     is absent; a signed-in client must not set these keys.
--   * invoices/void clears payment_url and sets stripe_checkout_expired_ids
--     with the same admin client (app/api/billing/invoices/void/route.ts).
--   * the Stripe webhook and invoices/confirm call applyInvoiceCheckoutSession
--     with getSupabaseAdmin() only, and both refuse to run without the
--     service role. That path sets stripe_checkout_session_id,
--     stripe_checkout_session_ids, and the stripe_session_id column.
--
-- Repo only. Do not apply this file to production from the pull request.
-- Safe to re-run. The migration runner applies this file as one transaction.
--
-- Rollback: 20261117_000962_service_invoice_payment_url_guard_rollback.sql

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000962 drift: public.service_invoices is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'invoice_data' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000962 drift: service_invoices.invoice_data is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'stripe_session_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000962 drift: service_invoices.stripe_session_id is missing (apply 000803 first)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  old_locked jsonb;
  new_locked jsonb;
BEGIN
  -- auth.uid() is null for the service role, so webhook, confirm, send, and
  -- void writes that use the service-role key still return NEW, including
  -- a string invoice_data the service role itself stored.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_data IS NOT NULL
     AND jsonb_typeof(NEW.invoice_data::jsonb) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice_data must be a JSON object';
  END IF;

  new_data := CASE
    WHEN NEW.invoice_data IS NULL THEN '{}'::jsonb
    ELSE NEW.invoice_data::jsonb
  END;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO new_locked
  FROM jsonb_each(new_data) AS e(key, value)
  WHERE (
    lower(e.key) = 'payment_url'
    OR position('stripe_checkout_session' IN lower(e.key)) = 1
    OR lower(e.key) = 'stripe_checkout_expired_ids'
  )
  AND jsonb_typeof(e.value) IS DISTINCT FROM 'null';

  IF TG_OP = 'INSERT' THEN
    IF NEW.stripe_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'stripe_session_id cannot be set by the client';
    END IF;
    IF new_locked <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invoice payment fields cannot be set by the client';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id THEN
    RAISE EXCEPTION 'stripe_session_id cannot be changed by the client';
  END IF;

  -- Fail closed. A string, array, or other non-object is locked as a whole.
  -- Replacing it with an object would drop whatever keys a string unwrap missed.
  IF OLD.invoice_data IS NOT NULL
     AND jsonb_typeof(OLD.invoice_data::jsonb) IS DISTINCT FROM 'object' THEN
    IF NEW.invoice_data IS NULL
       OR NEW.invoice_data::jsonb IS DISTINCT FROM OLD.invoice_data::jsonb THEN
      RAISE EXCEPTION 'invoice_data cannot be changed by the client';
    END IF;
    RETURN NEW;
  END IF;

  old_data := CASE
    WHEN OLD.invoice_data IS NULL THEN '{}'::jsonb
    ELSE OLD.invoice_data::jsonb
  END;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO old_locked
  FROM jsonb_each(old_data) AS e(key, value)
  WHERE (
    lower(e.key) = 'payment_url'
    OR position('stripe_checkout_session' IN lower(e.key)) = 1
    OR lower(e.key) = 'stripe_checkout_expired_ids'
  )
  AND jsonb_typeof(e.value) IS DISTINCT FROM 'null';

  IF new_locked IS DISTINCT FROM old_locked THEN
    RAISE EXCEPTION 'invoice payment fields cannot be changed by the client';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_invoices_guard_stripe_session() IS
  'Blocks signed-in writes of stripe_session_id and of invoice_data payment_url / checkout session id keys. auth.uid() IS NULL (service role) still writes them.';

REVOKE EXECUTE ON FUNCTION public.service_invoices_guard_stripe_session() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE INSERT OR UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_guard_stripe_session();

NOTIFY pgrst, 'reload schema';
