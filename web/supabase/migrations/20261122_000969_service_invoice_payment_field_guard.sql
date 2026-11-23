-- 000969: build on 000962's invoice pay-link guard.
--
-- Replaces service_invoices_guard_stripe_session after
-- 20261117_000962_service_invoice_payment_url_guard.sql. 000962 is not edited.
-- The combined function keeps 000962's checks. A signed-in edit of the keys
-- 000962 already rejects still raises:
--   * payment_url
--   * any key whose name starts with stripe_checkout_session
--   * stripe_checkout_expired_ids
-- Keys 000962 did not raise on are stripped back to the stored value, and the
-- rest of the write is kept:
--   * any other key whose name contains checkout_session
--     (replaced_checkout_session_ids)
--   * any key whose name contains payment_intent
--   * stripe_checkout_expired_at, stripe_session_id
--   * payment_amount, payment_amount_minor, payment_currency
-- The raise uses the incoming row, before any restore, so it can fire.
--
-- A signed-in INSERT or UPDATE whose invoice_data is a string, array, or
-- other non-object is rejected. A non-object already stored cannot be changed.
-- That matches 000962: parseInvoiceData would otherwise read a planted
-- payment_url out of a JSON string.
--
-- SECURITY INVOKER. The guard runs when current_user is authenticated or anon,
-- and also when auth.uid() is set. A postgres-owned SECURITY DEFINER function
-- called by a member has current_user = postgres and a non-null auth.uid(), so
-- it cannot write payment_url. The bypass is only a non-client role with no
-- JWT subject, which is how the service-role connection writes pay links.
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.service_invoices_guard_stripe_session()'::regprocedure
      AND pg_get_functiondef(oid) LIKE '%invoice payment fields cannot be changed by the client%'
  ) THEN
    RAISE EXCEPTION '000969 drift: 000962 guard is not installed (000803 alone is not enough)';
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
  -- Client roles always run the guard. A signed-in JWT also runs it when
  -- current_user is the owner of a SECURITY DEFINER caller.
  IF current_user NOT IN ('authenticated', 'anon') AND auth.uid() IS NULL THEN
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

  -- 000962's locked keys. Compare the incoming row before any restore so a
  -- change still raises instead of being stripped.
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

  -- Silent strip only for keys 000962 did not raise on, plus the stored charge.
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    INTO stripped
  FROM jsonb_each(new_data) AS e(key, value)
  WHERE NOT (
    (
      position('checkout_session' IN lower(e.key)) > 0
      AND position('stripe_checkout_session' IN lower(e.key)) <> 1
    )
    OR position('payment_intent' IN lower(e.key)) > 0
    OR lower(e.key) IN (
      'stripe_checkout_expired_at',
      'stripe_session_id',
      'payment_amount',
      'payment_amount_minor',
      'payment_currency'
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
      (
        position('checkout_session' IN lower(e.key)) > 0
        AND position('stripe_checkout_session' IN lower(e.key)) <> 1
      )
      OR position('payment_intent' IN lower(e.key)) > 0
      OR lower(e.key) IN (
        'stripe_checkout_expired_at',
        'stripe_session_id',
        'payment_amount',
        'payment_amount_minor',
        'payment_currency'
      )
    )
    AND jsonb_typeof(e.value) IS DISTINCT FROM 'null';
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object('invoice_data', stripped));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.service_invoices_guard_stripe_session() IS
  'SECURITY INVOKER. Runs for authenticated/anon and for any write with auth.uid() set. Raises on 000962 locked keys. Strips payment_intent, replaced session ids, and the stored charge.';

-- The trigger fires for the table writer without EXECUTE on this function.
-- authenticated does not need a grant.
REVOKE ALL ON FUNCTION public.service_invoices_guard_stripe_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_invoices_guard_stripe_session() TO service_role;

DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public.service_invoices;
CREATE TRIGGER service_invoices_guard_stripe_session
  BEFORE INSERT OR UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_guard_stripe_session();

NOTIFY pgrst, 'reload schema';
