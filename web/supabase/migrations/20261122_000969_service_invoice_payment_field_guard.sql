-- 000969: build on 000962's invoice pay-link guard.
--
-- Replaces service_invoices_guard_stripe_session after
-- 20261117_000962_service_invoice_payment_url_guard.sql. 000962 is not edited.
-- The combined function keeps 000962's checks and also strips payment keys a
-- signed-in client must not plant:
--   * payment_url
--   * any key whose name contains checkout_session
--     (stripe_checkout_session_id, stripe_checkout_session_ids,
--     replaced_checkout_session_ids, any letter case)
--   * any key whose name contains payment_intent
--   * stripe_checkout_expired_ids, stripe_checkout_expired_at, stripe_session_id
-- Stripping restores the previous values (or removes them on insert). 000962's
-- locked-key comparison still runs after that, so a key it already rejected
-- cannot land.
--
-- A signed-in INSERT or UPDATE whose invoice_data is a string, array, or
-- other non-object is rejected. A non-object already stored cannot be changed.
-- That matches 000962: parseInvoiceData would otherwise read a planted
-- payment_url out of a JSON string.
--
-- The bypass matches public.guard_tenant_owner_cols: SECURITY INVOKER, and
-- current_user outside authenticated/anon returns NEW. auth.uid() IS NULL is
-- not the bypass. The service-role connection (current_user service_role)
-- still writes payment links. A signed-in JWT cannot.
--
-- stripe_session_id rules from 000803/000962 are unchanged for client roles.
--
-- Repo only. Do not apply this file to production from the pull request.
-- Safe to re-run.
-- Rollback: 20261122_000969_service_invoice_payment_field_guard_rollback.sql
-- restores the 000962 function body.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000969 drift: public.service_invoices is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'invoice_data' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000969 drift: service_invoices.invoice_data is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'stripe_session_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000969 drift: service_invoices.stripe_session_id is missing (apply 000803 first)';
  END IF;
  IF to_regprocedure('public.service_invoices_guard_stripe_session()') IS NULL THEN
    RAISE EXCEPTION '000969 drift: service_invoices_guard_stripe_session() is missing (apply 000962 first)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_data jsonb;
  new_data jsonb;
  old_locked jsonb;
  new_locked jsonb;
  stripped jsonb;
BEGIN
  -- Same bypass as guard_tenant_owner_cols. Inside SECURITY INVOKER,
  -- current_user is the role that issued the write.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.invoice_data IS NOT NULL
     AND jsonb_typeof(NEW.invoice_data::jsonb) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invoice_data must be a JSON object';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.stripe_session_id IS NOT NULL THEN
      RAISE EXCEPTION 'stripe_session_id cannot be set by the client';
    END IF;
  ELSIF NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id THEN
    RAISE EXCEPTION 'stripe_session_id cannot be changed by the client';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.invoice_data IS NOT NULL
     AND jsonb_typeof(OLD.invoice_data::jsonb) IS DISTINCT FROM 'object' THEN
    IF NEW.invoice_data IS NULL
       OR NEW.invoice_data::jsonb IS DISTINCT FROM OLD.invoice_data::jsonb THEN
      RAISE EXCEPTION 'invoice_data cannot be changed by the client';
    END IF;
    RETURN NEW;
  END IF;

  new_data := CASE
    WHEN NEW.invoice_data IS NULL THEN '{}'::jsonb
    ELSE NEW.invoice_data::jsonb
  END;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO stripped
  FROM jsonb_each(new_data) AS e(key, value)
  WHERE NOT (
    lower(e.key) = 'payment_url'
    OR position('checkout_session' IN lower(e.key)) > 0
    OR position('payment_intent' IN lower(e.key)) > 0
    OR lower(e.key) IN (
      'stripe_checkout_expired_ids',
      'stripe_checkout_expired_at',
      'stripe_session_id'
    )
  );

  IF TG_OP = 'UPDATE' THEN
    old_data := CASE
      WHEN OLD.invoice_data IS NULL THEN '{}'::jsonb
      ELSE OLD.invoice_data::jsonb
    END;
    SELECT stripped || COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      INTO stripped
    FROM jsonb_each(old_data) AS e(key, value)
    WHERE (
      lower(e.key) = 'payment_url'
      OR position('checkout_session' IN lower(e.key)) > 0
      OR position('payment_intent' IN lower(e.key)) > 0
      OR lower(e.key) IN (
        'stripe_checkout_expired_ids',
        'stripe_checkout_expired_at',
        'stripe_session_id'
      )
    )
    AND jsonb_typeof(e.value) IS DISTINCT FROM 'null';
  END IF;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO new_locked
  FROM jsonb_each(stripped) AS e(key, value)
  WHERE (
    lower(e.key) = 'payment_url'
    OR position('stripe_checkout_session' IN lower(e.key)) = 1
    OR lower(e.key) = 'stripe_checkout_expired_ids'
  )
  AND jsonb_typeof(e.value) IS DISTINCT FROM 'null';

  IF TG_OP = 'INSERT' THEN
    IF new_locked <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invoice payment fields cannot be set by the client';
    END IF;
  ELSE
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
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object('invoice_data', stripped));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_invoices_guard_stripe_session() IS
  'SECURITY INVOKER. current_user outside authenticated/anon still writes payment links. Signed-in writes cannot set a non-object invoice_data or change payment_url, checkout session, or payment_intent keys.';

REVOKE ALL ON FUNCTION public.service_invoices_guard_stripe_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_invoices_guard_stripe_session() TO authenticated, service_role;

DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE INSERT OR UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_guard_stripe_session();

NOTIFY pgrst, 'reload schema';
