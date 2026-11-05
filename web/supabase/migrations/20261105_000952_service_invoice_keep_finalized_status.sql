-- Save Draft must not demote a finalized invoice.
--
-- The invoice form writes service_invoices from the signed-in client.
-- Finalize & Send sets status to sent. Save Draft then wrote status = 'draft',
-- and the invoice list pill flipped to Draft. sent_at and any delivery or
-- email-sent value have to stay with the row.
--
-- BEFORE UPDATE, when OLD.status is anything other than draft or blank and
-- the update asks for draft, blank, or null:
--   * keep OLD.status (the other columns in the update still save)
--   * put back sent_at and the other delivery / email-sent columns if this
--     update cleared or changed them
--   * put those same keys back inside invoice_data when that column is jsonb
--   * for paid, partially_paid, partial, void, voided, cancelled, and
--     canceled, also put back paid_at, amount_paid, payment_method,
--     voided_at, and void_reason
-- paid_at is put back for every non-draft status, because the draft payload
-- sends paid_at = null.
--
-- draft → draft and draft → sent are unchanged: the function returns NEW.
-- sent → paid, partial payment, and void are unchanged because they do not
-- ask for draft.
--
-- This file does not UPDATE existing rows. It does not read or write any
-- organization. Ship the SQL only. Do not apply it from the app.
-- Safe to re-run. The migration runner applies this file as one transaction.

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.service_invoices_keep_finalized_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_status text := lower(btrim(coalesce(OLD.status, '')));
  new_status text := lower(btrim(coalesce(NEW.status, '')));
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  restored jsonb := '{}'::jsonb;
  key text;
  data_changed boolean := false;
  delivery_keys text[] := ARRAY[
    'sent_at',
    'emailed_at',
    'email_sent',
    'email_sent_at',
    'delivered_at',
    'delivery_status',
    'delivery',
    'last_emailed_at',
    'resend_email_id',
    'email_id'
  ];
  payment_keys text[] := ARRAY[
    'paid_at',
    'amount_paid',
    'payment_method',
    'voided_at',
    'void_reason'
  ];
  old_data jsonb;
  new_data jsonb;
BEGIN
  IF TG_OP IS DISTINCT FROM 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- A draft (or a row with no status yet) may stay a draft or become sent.
  IF old_status = '' OR old_status = 'draft' THEN
    RETURN NEW;
  END IF;
  -- paid, void, sent → paid, and any other non-draft request are kept.
  IF new_status <> '' AND new_status <> 'draft' THEN
    RETURN NEW;
  END IF;

  NEW.status := OLD.status;

  FOREACH key IN ARRAY delivery_keys LOOP
    IF old_row ? key AND (old_row -> key) IS DISTINCT FROM (new_row -> key) THEN
      restored := restored || jsonb_build_object(key, old_row -> key);
    END IF;
  END LOOP;

  IF old_row ? 'paid_at' AND (old_row -> 'paid_at') IS DISTINCT FROM (new_row -> 'paid_at') THEN
    restored := restored || jsonb_build_object('paid_at', old_row -> 'paid_at');
  END IF;

  IF old_status IN (
    'paid',
    'partially_paid',
    'partial',
    'void',
    'voided',
    'cancelled',
    'canceled'
  ) THEN
    FOREACH key IN ARRAY payment_keys LOOP
      IF key = 'paid_at' THEN
        CONTINUE;
      END IF;
      IF old_row ? key AND (old_row -> key) IS DISTINCT FROM (new_row -> key) THEN
        restored := restored || jsonb_build_object(key, old_row -> key);
      END IF;
    END LOOP;
  END IF;

  IF restored <> '{}'::jsonb THEN
    NEW := jsonb_populate_record(NEW, restored);
  END IF;

  IF old_row ? 'invoice_data'
     AND new_row ? 'invoice_data'
     AND jsonb_typeof(old_row -> 'invoice_data') = 'object'
     AND jsonb_typeof(new_row -> 'invoice_data') = 'object' THEN
    old_data := old_row -> 'invoice_data';
    new_data := new_row -> 'invoice_data';
    FOREACH key IN ARRAY delivery_keys LOOP
      IF old_data ? key
         AND (old_data -> key) IS DISTINCT FROM (new_data -> key)
         AND old_data -> key IS NOT NULL
         AND old_data -> key <> 'null'::jsonb
         AND old_data -> key <> '""'::jsonb THEN
        new_data := jsonb_set(new_data, ARRAY[key], old_data -> key, true);
        data_changed := true;
      END IF;
    END LOOP;
    IF data_changed THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('invoice_data', new_data));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.service_invoices_keep_finalized_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.service_invoices_keep_finalized_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_invoices_keep_finalized_status ON public.service_invoices;
CREATE TRIGGER service_invoices_keep_finalized_status
  BEFORE UPDATE ON public.service_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.service_invoices_keep_finalized_status();

NOTIFY pgrst, 'reload schema';
