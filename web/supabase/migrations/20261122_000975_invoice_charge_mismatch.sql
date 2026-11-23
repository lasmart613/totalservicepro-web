-- 000975: record a charge that does not match the stored amount or currency.
--
-- service_invoice_stripe_payments.outcome is a check constraint. 000971
-- stored that mismatch as possibly_already_credited, which is the review
-- outcome for a session that may already have been credited. charge_mismatch
-- is a separate outcome. The claim function writes it for a legacy session
-- whose currency does not match the organization, and a replay of that row
-- is not treated as a successful credit.
--
-- Does not change column types. Does not edit 000963 or 000971.
-- Repo only. Do not apply this file to production from the pull request.
-- Rollback: 20261122_000975_invoice_charge_mismatch_rollback.sql
-- restores the 000971 function body and the previous outcome check.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.service_invoice_stripe_payments') IS NULL THEN
    RAISE EXCEPTION '000975 drift: public.service_invoice_stripe_payments is missing (apply 000963 first)';
  END IF;
END $$;

ALTER TABLE public.service_invoice_stripe_payments
  DROP CONSTRAINT IF EXISTS service_invoice_stripe_payments_outcome_check;

ALTER TABLE public.service_invoice_stripe_payments
  ADD CONSTRAINT service_invoice_stripe_payments_outcome_check
  CHECK (outcome IN (
    'credited',
    'overpaid_not_credited',
    'possibly_already_credited',
    'charge_mismatch'
  ));

COMMENT ON COLUMN public.service_invoice_stripe_payments.outcome IS
  'credited: amount_paid increased. overpaid_not_credited: a new session larger than the balance was not applied. possibly_already_credited: the session id was already stored from a credit made before this table existed, so a replay is not a new overpayment. charge_mismatch: the paid amount or currency did not match the stored charge, so it was not applied.';

CREATE OR REPLACE FUNCTION public.apply_service_invoice_stripe_payment(
  p_invoice_id bigint,
  p_session_id text,
  p_amount numeric,
  p_currency text DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.service_invoices%ROWTYPE;
  v_data jsonb;
  v_extra jsonb;
  v_ids jsonb;
  v_paid numeric;
  v_total numeric;
  v_remaining numeric;
  v_new_paid numeric;
  v_status text;
  v_owner bigint;
  v_outcome text;
  v_session text;
  v_reason text;
  v_entry jsonb;
  v_list jsonb;
  v_known boolean;
  v_notify boolean;
  v_attempts jsonb;
  v_currency text;
  v_scale integer;
  v_amount numeric;
  v_eps numeric;
  v_over numeric;
  v_org_currency text;
BEGIN
  v_session := btrim(COALESCE(p_session_id, ''));
  IF v_session = '' OR v_session !~ '^[A-Za-z0-9_]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_session_id');
  END IF;
  v_currency := lower(btrim(COALESCE(p_currency, 'usd')));
  v_scale := CASE
    WHEN v_currency IN (
      'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
      'vnd', 'vuv', 'xaf', 'xof', 'xpf', 'isk', 'ugx'
    ) THEN 0
    WHEN v_currency IN ('bhd', 'jod', 'kwd', 'omr', 'tnd') THEN 3
    ELSE 2
  END;
  v_amount := ROUND(p_amount, v_scale);
  v_eps := CASE v_scale WHEN 0 THEN 0.4 WHEN 3 THEN 0.0004 ELSE 0.004 END;
  v_over := CASE v_scale WHEN 0 THEN 0.5 WHEN 3 THEN 0.001 ELSE 0.01 END;

  SELECT * INTO v_row
  FROM public.service_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice_not_found');
  END IF;

  SELECT invoice_id, outcome INTO v_owner, v_outcome
  FROM public.service_invoice_stripe_payments
  WHERE session_id = v_session;
  IF FOUND THEN
    IF v_owner IS DISTINCT FROM p_invoice_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invoice_mismatch');
    END IF;
    IF v_outcome = 'charge_mismatch' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'charge_mismatch',
        'notify', false,
        'invoice_id', p_invoice_id,
        'status', COALESCE(v_row.status, 'sent'),
        'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), v_scale)
      );
    END IF;
    IF v_outcome IN ('overpaid_not_credited', 'possibly_already_credited') THEN
      RETURN jsonb_build_object(
        'ok', true,
        'claimed', false,
        'overpaid', v_outcome = 'overpaid_not_credited',
        'notify', false,
        'already_applied', true,
        'reason', CASE
          WHEN v_outcome = 'possibly_already_credited' THEN 'possibly_already_credited'
          ELSE 'overpaid_not_credited'
        END,
        'invoice_id', p_invoice_id,
        'status', COALESCE(v_row.status, 'sent'),
        'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), v_scale)
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'claimed', false,
      'already_applied', true,
      'invoice_id', p_invoice_id,
      'status', COALESCE(v_row.status, 'paid'),
      'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), v_scale)
    );
  END IF;

  IF p_amount IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;

  v_data := CASE
    WHEN v_row.invoice_data IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(v_row.invoice_data::jsonb) = 'object' THEN v_row.invoice_data::jsonb
    ELSE '{}'::jsonb
  END;

  -- Legacy rows have no stored charge. Match the organization currency.
  -- A stored payment_currency belongs to the Checkout session metadata path
  -- and is not compared here.
  IF btrim(COALESCE(v_data->>'payment_currency', '')) = ''
     AND btrim(COALESCE(v_data->>'payment_amount_minor', '')) = '' THEN
    v_org_currency := NULL;
    BEGIN
      SELECT lower(btrim(currency_code::text)) INTO v_org_currency
      FROM public.organizations
      WHERE id = v_row.organization_id;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        v_org_currency := 'usd';
    END;
    IF v_org_currency IS NULL OR v_org_currency = '' THEN
      v_org_currency := 'usd';
    END IF;
    IF lower(btrim(COALESCE(p_currency, 'usd'))) IS DISTINCT FROM v_org_currency THEN
      INSERT INTO public.service_invoice_stripe_payments (invoice_id, session_id, amount, outcome)
      VALUES (p_invoice_id, v_session, v_amount, 'charge_mismatch');
      v_entry := jsonb_build_object(
        'reason', 'currency_mismatch',
        'sessionId', v_session,
        'sessionCurrency', lower(btrim(COALESCE(p_currency, 'usd'))),
        'expectedCurrency', v_org_currency,
        'at', to_jsonb(pg_catalog.now())
      );
      v_list := v_data->'stripe_checkout_session_conflict';
      IF jsonb_typeof(v_list) = 'array' THEN
        NULL;
      ELSIF jsonb_typeof(v_list) = 'object' THEN
        v_list := jsonb_build_array(v_list);
      ELSE
        v_list := '[]'::jsonb;
      END IF;
      v_list := v_list || jsonb_build_array(v_entry);
      UPDATE public.service_invoices
      SET invoice_data = v_data || jsonb_build_object('stripe_checkout_session_conflict', v_list),
          updated_at = pg_catalog.now()
      WHERE id = p_invoice_id;
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'currency_mismatch',
        'notify', true,
        'session_amount', v_amount,
        'invoice_id', p_invoice_id
      );
    END IF;
  END IF;

  IF lower(btrim(COALESCE(v_row.status, ''))) IN ('void', 'voided') THEN
    v_attempts := COALESCE(v_data->'void_payment_attempts', '[]'::jsonb);
    IF jsonb_typeof(v_attempts) IS DISTINCT FROM 'array' THEN
      v_attempts := '[]'::jsonb;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_attempts) AS attempt
      WHERE attempt->>'sessionId' = v_session
    ) THEN
      v_attempts := v_attempts || jsonb_build_array(jsonb_build_object(
        'sessionId', v_session,
        'amount', v_amount,
        'at', to_jsonb(pg_catalog.now())
      ));
    END IF;
    UPDATE public.service_invoices
    SET invoice_data = (
          v_data || jsonb_build_object(
            'void_payment_attempts', v_attempts,
            'void_payment_ignored', true
          )
        ),
        updated_at = pg_catalog.now()
    WHERE id = p_invoice_id;
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice_void');
  END IF;

  v_total := ROUND(COALESCE(v_row.total, 0), v_scale);
  v_paid := ROUND(COALESCE(v_row.amount_paid, 0), v_scale);
  IF v_paid <= 0
     AND jsonb_typeof(v_data->'deposit') = 'number'
     AND (v_data->>'deposit')::numeric > 0 THEN
    v_paid := ROUND((v_data->>'deposit')::numeric, v_scale);
  END IF;
  v_remaining := ROUND(GREATEST(v_total - v_paid, 0), v_scale);

  IF lower(btrim(COALESCE(v_row.status, ''))) = 'paid'
     OR (v_total > 0 AND v_paid + v_eps >= v_total) THEN
    v_entry := jsonb_build_object(
      'reason', 'different_paid_session',
      'sessionId', v_session,
      'creditedSessionId', NULLIF(btrim(COALESCE(v_row.stripe_session_id, '')), ''),
      'at', to_jsonb(pg_catalog.now())
    );
    v_list := v_data->'stripe_checkout_session_conflict';
    IF jsonb_typeof(v_list) = 'array' THEN
      NULL;
    ELSIF jsonb_typeof(v_list) = 'object' THEN
      v_list := jsonb_build_array(v_list);
    ELSE
      v_list := '[]'::jsonb;
    END IF;
    v_notify := false;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list) AS prior
      WHERE prior->>'sessionId' = v_session AND prior->>'reason' = 'different_paid_session'
    ) THEN
      v_list := v_list || jsonb_build_array(v_entry);
      UPDATE public.service_invoices
      SET invoice_data = v_data || jsonb_build_object('stripe_checkout_session_conflict', v_list),
          updated_at = pg_catalog.now()
      WHERE id = p_invoice_id;
      v_notify := true;
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'different_paid_session',
      'notify', v_notify,
      'session_amount', v_amount,
      'invoice_id', p_invoice_id
    );
  END IF;

  IF v_amount > v_remaining + v_over THEN
    -- stripe_checkout_session_id alone is the open pay link, written before
    -- anyone pays. A session already in stripe_checkout_session_ids, or equal
    -- to stripe_session_id, was stored when a payment was applied.
    v_known := btrim(COALESCE(v_row.stripe_session_id, '')) = v_session;
    IF NOT v_known AND jsonb_typeof(v_data->'stripe_checkout_session_ids') = 'array' THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_data->'stripe_checkout_session_ids') AS prior(id)
        WHERE btrim(prior.id) = v_session
      ) INTO v_known;
    END IF;
    IF v_known THEN
      v_outcome := 'possibly_already_credited';
      v_reason := 'verify';
    ELSE
      v_outcome := 'overpaid_not_credited';
      v_reason := 'overpaid';
    END IF;
    BEGIN
      INSERT INTO public.service_invoice_stripe_payments (invoice_id, session_id, amount, outcome)
      VALUES (p_invoice_id, v_session, v_amount, v_outcome);
    EXCEPTION
      WHEN unique_violation THEN
        SELECT invoice_id, outcome INTO v_owner, v_outcome
        FROM public.service_invoice_stripe_payments
        WHERE session_id = v_session;
        IF v_owner IS DISTINCT FROM p_invoice_id THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invoice_mismatch');
        END IF;
        IF v_outcome = 'charge_mismatch' THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'charge_mismatch',
            'notify', false,
            'invoice_id', p_invoice_id,
            'status', COALESCE(v_row.status, 'sent'),
            'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), v_scale)
          );
        END IF;
        RETURN jsonb_build_object(
          'ok', true,
          'claimed', false,
          'overpaid', v_outcome = 'overpaid_not_credited',
          'notify', false,
          'already_applied', true,
          'reason', CASE
            WHEN v_outcome = 'possibly_already_credited' THEN 'possibly_already_credited'
            WHEN v_outcome = 'overpaid_not_credited' THEN 'overpaid_not_credited'
            ELSE 'already_applied'
          END,
          'invoice_id', p_invoice_id,
          'status', COALESCE(v_row.status, 'sent'),
          'amount_paid', v_paid
        );
    END;
    v_entry := jsonb_build_object(
      'reason', v_reason,
      'sessionId', v_session,
      'amount', v_amount,
      'balanceDue', v_remaining,
      'at', to_jsonb(pg_catalog.now())
    );
    v_list := v_data->'stripe_checkout_session_conflict';
    IF jsonb_typeof(v_list) = 'array' THEN
      NULL;
    ELSIF jsonb_typeof(v_list) = 'object' THEN
      v_list := jsonb_build_array(v_list);
    ELSE
      v_list := '[]'::jsonb;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list) AS prior
      WHERE prior->>'sessionId' = v_session AND prior->>'reason' = v_reason
    ) THEN
      v_list := v_list || jsonb_build_array(v_entry);
    END IF;
    UPDATE public.service_invoices
    SET invoice_data = v_data || jsonb_build_object('stripe_checkout_session_conflict', v_list),
        updated_at = pg_catalog.now()
    WHERE id = p_invoice_id;
    RETURN jsonb_build_object(
      'ok', true,
      'claimed', false,
      'overpaid', v_outcome = 'overpaid_not_credited',
      'notify', true,
      'reason', CASE
        WHEN v_outcome = 'possibly_already_credited' THEN 'possibly_already_credited'
        ELSE 'overpaid_not_credited'
      END,
      'invoice_id', p_invoice_id,
      'status', COALESCE(v_row.status, 'sent'),
      'amount_paid', v_paid,
      'session_amount', v_amount,
      'balance_due', v_remaining
    );
  END IF;

  BEGIN
    INSERT INTO public.service_invoice_stripe_payments (invoice_id, session_id, amount, outcome)
    VALUES (p_invoice_id, v_session, v_amount, 'credited');
  EXCEPTION
    WHEN unique_violation THEN
      SELECT invoice_id, outcome INTO v_owner, v_outcome
      FROM public.service_invoice_stripe_payments
      WHERE session_id = v_session;
      IF v_owner IS DISTINCT FROM p_invoice_id THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invoice_mismatch');
      END IF;
      IF v_outcome = 'charge_mismatch' THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'charge_mismatch',
          'notify', false,
          'invoice_id', p_invoice_id,
          'status', COALESCE(v_row.status, 'sent'),
          'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), v_scale)
        );
      END IF;
      IF v_outcome IN ('overpaid_not_credited', 'possibly_already_credited') THEN
        RETURN jsonb_build_object(
          'ok', true,
          'claimed', false,
          'overpaid', v_outcome = 'overpaid_not_credited',
          'notify', false,
          'already_applied', true,
          'reason', v_outcome,
          'invoice_id', p_invoice_id,
          'status', COALESCE(v_row.status, 'sent'),
          'amount_paid', v_paid
        );
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'claimed', false,
        'already_applied', true,
        'invoice_id', p_invoice_id,
        'status', COALESCE(v_row.status, 'paid'),
        'amount_paid', v_paid
      );
  END;

  v_new_paid := ROUND(v_paid + v_amount, v_scale);
  IF v_total > 0 AND v_new_paid + v_eps >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  v_ids := COALESCE(v_data->'stripe_checkout_session_ids', '[]'::jsonb);
  IF jsonb_typeof(v_ids) IS DISTINCT FROM 'array' THEN
    v_ids := '[]'::jsonb;
  END IF;
  -- Only the session that was just paid. The stored open-link id may still
  -- be unpaid. Copying it here makes a later payment of that link look like
  -- a replay and hides a real overpayment.
  IF NOT v_ids @> to_jsonb(v_session) THEN
    v_ids := v_ids || to_jsonb(v_session);
  END IF;

  v_extra := '{}'::jsonb;
  IF p_extra IS NOT NULL AND jsonb_typeof(p_extra) = 'object' THEN
    IF p_extra ? 'stripe_destination_account'
       AND jsonb_typeof(p_extra->'stripe_destination_account') IS DISTINCT FROM 'null' THEN
      v_extra := v_extra || jsonb_build_object(
        'stripe_destination_account', p_extra->'stripe_destination_account'
      );
    END IF;
    IF p_extra ? 'payout_status'
       AND jsonb_typeof(p_extra->'payout_status') IS DISTINCT FROM 'null' THEN
      v_extra := v_extra || jsonb_build_object('payout_status', p_extra->'payout_status');
    END IF;
  END IF;

  UPDATE public.service_invoices
  SET amount_paid = v_new_paid,
      status = v_status,
      paid_at = CASE WHEN v_status = 'paid' THEN pg_catalog.now() ELSE NULL END,
      payment_method = 'Stripe',
      stripe_session_id = v_session,
      updated_at = pg_catalog.now(),
      invoice_data = (
        v_data
        || v_extra
        || jsonb_build_object(
          'deposit', v_new_paid,
          'balanceDue', ROUND(GREATEST(v_total - v_new_paid, 0), v_scale),
          'depositMethod', 'Stripe',
          'depositDate', to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
          'last_payment_method', 'Stripe',
          'last_payment_at', to_jsonb(pg_catalog.now()),
          'stripe_checkout_session_id', v_session,
          'stripe_checkout_session_ids', v_ids
        )
      )
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', true,
    'already_applied', false,
    'invoice_id', p_invoice_id,
    'status', v_status,
    'amount_paid', v_new_paid
  );
END;
$$;

COMMENT ON FUNCTION public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb) IS
  'Credits a paid Checkout session once. Amounts use the session currency precision (0, 2, or 3). A replay returns the earlier outcome before the amount is checked again.';

REVOKE ALL ON FUNCTION public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.apply_service_invoice_stripe_payment(bigint, text, numeric, text, jsonb) TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
