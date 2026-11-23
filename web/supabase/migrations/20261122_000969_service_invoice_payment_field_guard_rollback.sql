-- Rollback 000969. Restores service_invoices_guard_stripe_session to the
-- 000962 body exactly, including auth.uid() IS NULL and the locked-key
-- exceptions. Does not restore 000803.
-- Repo only. Do not run against production from the pull request.

SET LOCAL lock_timeout = '5s';

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
