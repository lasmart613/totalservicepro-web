-- 000963: one row per credited Checkout session, so a replay of an older
-- session cannot add its amount again after a later session was stored in
-- service_invoices.stripe_session_id.
--
-- The insert is the claim. ON CONFLICT (session_id) DO NOTHING. The amount,
-- status, stripe_session_id, and invoice_data payment keys are updated in
-- the same function, so a crash cannot leave a claim without its credit.
-- A retry of a session that is already in the table returns already applied
-- and does not change amount_paid.
--
-- auth.uid() is not read here. Draft #390's 000962 trigger
-- (service_invoices_guard_stripe_session) returns NEW when auth.uid() is
-- null. Confirm and the Stripe webhook call this function with the service
-- role, whose JWT has no sub, so that trigger still allows the update.
-- Execute is revoked from PUBLIC, anon, and authenticated.
--
-- RLS is on and there are no policies. anon and authenticated have no
-- grants. service_role is granted DML and bypasses RLS.
--
-- There is no backfill. stripe_session_id on existing invoices is only the
-- latest id, and copying amount_paid onto it would pretend that one session
-- collected the whole balance. invoice_data.stripe_checkout_session_ids
-- lists sessions that were created, not sessions that were proven paid.
-- A replay that is larger than the balance and whose id is already in that
-- list, or equals stripe_session_id, is recorded as possibly_already_credited
-- and is not applied and does not notify. stripe_checkout_session_id by
-- itself is the open pay link written before payment, so it still records a
-- real overpayment.
--
-- Repo only. Do not apply this file to production from the pull request.
-- Rollback: 20261118_000963_service_invoice_stripe_payments_rollback.sql

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.service_invoices') IS NULL THEN
    RAISE EXCEPTION '000963 drift: public.service_invoices is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'stripe_session_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000963 drift: service_invoices.stripe_session_id is missing (apply 000803 first)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.service_invoices'::regclass
      AND attname = 'invoice_data' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '000963 drift: service_invoices.invoice_data is missing';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.service_invoice_stripe_payments (
  invoice_id bigint NOT NULL REFERENCES public.service_invoices (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  outcome text NOT NULL DEFAULT 'credited'
    CONSTRAINT service_invoice_stripe_payments_outcome_check
    CHECK (outcome IN ('credited', 'overpaid_not_credited', 'possibly_already_credited')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT service_invoice_stripe_payments_session_id_key PRIMARY KEY (session_id)
);

COMMENT ON TABLE public.service_invoice_stripe_payments IS
  'Append-only Checkout sessions already credited on a service invoice. session_id is unique. Service role only.';

COMMENT ON COLUMN public.service_invoice_stripe_payments.session_id IS
  'Stripe Checkout session id (cs_...). One session is recorded once, whether or not it was credited.';

COMMENT ON COLUMN public.service_invoice_stripe_payments.outcome IS
  'credited: amount_paid increased. overpaid_not_credited: a new session larger than the balance was not applied. possibly_already_credited: the session id was already stored from a credit made before this table existed, so a replay is not a new overpayment.';

CREATE INDEX IF NOT EXISTS service_invoice_stripe_payments_invoice_id_idx
  ON public.service_invoice_stripe_payments (invoice_id);

ALTER TABLE public.service_invoice_stripe_payments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.service_invoice_stripe_payments FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.service_invoice_stripe_payments FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.service_invoice_stripe_payments FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_invoice_stripe_payments TO service_role';
  END IF;
END $$;

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
  v_attempts jsonb;
BEGIN
  v_session := btrim(COALESCE(p_session_id, ''));
  IF v_session = '' OR v_session !~ '^[A-Za-z0-9_]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_session_id');
  END IF;
  IF p_amount IS NULL OR p_amount < 0.50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_amount');
  END IF;
  IF p_currency IS NOT NULL AND lower(btrim(p_currency)) <> 'usd' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'currency_mismatch');
  END IF;

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
        'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), 2)
      );
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'claimed', false,
      'already_applied', true,
      'invoice_id', p_invoice_id,
      'status', COALESCE(v_row.status, 'paid'),
      'amount_paid', ROUND(COALESCE(v_row.amount_paid, 0), 2)
    );
  END IF;

  v_data := CASE
    WHEN v_row.invoice_data IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(v_row.invoice_data::jsonb) = 'object' THEN v_row.invoice_data::jsonb
    ELSE '{}'::jsonb
  END;

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
        'amount', ROUND(p_amount, 2),
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

  v_total := ROUND(COALESCE(v_row.total, 0), 2);
  v_paid := ROUND(COALESCE(v_row.amount_paid, 0), 2);
  IF v_paid <= 0
     AND jsonb_typeof(v_data->'deposit') = 'number'
     AND (v_data->>'deposit')::numeric > 0 THEN
    v_paid := ROUND((v_data->>'deposit')::numeric, 2);
  END IF;
  v_remaining := ROUND(GREATEST(v_total - v_paid, 0), 2);

  IF lower(btrim(COALESCE(v_row.status, ''))) = 'paid'
     OR (v_total > 0 AND v_paid + 0.004 >= v_total) THEN
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
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list) AS prior
      WHERE prior->>'sessionId' = v_session AND prior->>'reason' = 'different_paid_session'
    ) THEN
      v_list := v_list || jsonb_build_array(v_entry);
      UPDATE public.service_invoices
      SET invoice_data = v_data || jsonb_build_object('stripe_checkout_session_conflict', v_list),
          updated_at = pg_catalog.now()
      WHERE id = p_invoice_id;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'different_paid_session');
  END IF;

  IF ROUND(p_amount, 2) > v_remaining + 0.01 THEN
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
      VALUES (p_invoice_id, v_session, ROUND(p_amount, 2), v_outcome);
    EXCEPTION
      WHEN unique_violation THEN
        SELECT invoice_id, outcome INTO v_owner, v_outcome
        FROM public.service_invoice_stripe_payments
        WHERE session_id = v_session;
        IF v_owner IS DISTINCT FROM p_invoice_id THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invoice_mismatch');
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
      'amount', ROUND(p_amount, 2),
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
      'notify', v_outcome = 'overpaid_not_credited',
      'reason', CASE
        WHEN v_outcome = 'possibly_already_credited' THEN 'possibly_already_credited'
        ELSE 'overpaid_not_credited'
      END,
      'invoice_id', p_invoice_id,
      'status', COALESCE(v_row.status, 'sent'),
      'amount_paid', v_paid,
      'session_amount', ROUND(p_amount, 2),
      'balance_due', v_remaining
    );
  END IF;

  BEGIN
    INSERT INTO public.service_invoice_stripe_payments (invoice_id, session_id, amount, outcome)
    VALUES (p_invoice_id, v_session, ROUND(p_amount, 2), 'credited');
  EXCEPTION
    WHEN unique_violation THEN
      SELECT invoice_id, outcome INTO v_owner, v_outcome
      FROM public.service_invoice_stripe_payments
      WHERE session_id = v_session;
      IF v_owner IS DISTINCT FROM p_invoice_id THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invoice_mismatch');
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

  v_new_paid := ROUND(v_paid + p_amount, 2);
  IF v_total > 0 AND v_new_paid + 0.004 >= v_total THEN
    v_status := 'paid';
  ELSE
    v_status := 'partially_paid';
  END IF;

  v_ids := COALESCE(v_data->'stripe_checkout_session_ids', '[]'::jsonb);
  IF jsonb_typeof(v_ids) IS DISTINCT FROM 'array' THEN
    v_ids := '[]'::jsonb;
  END IF;
  IF NOT v_ids @> to_jsonb(v_session) THEN
    v_ids := v_ids || to_jsonb(v_session);
  END IF;
  IF NULLIF(btrim(COALESCE(v_data->>'stripe_checkout_session_id', '')), '') IS NOT NULL
     AND NOT v_ids @> to_jsonb(btrim(v_data->>'stripe_checkout_session_id')) THEN
    v_ids := v_ids || to_jsonb(btrim(v_data->>'stripe_checkout_session_id'));
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
          'balanceDue', ROUND(GREATEST(v_total - v_new_paid, 0), 2),
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
  'Credits a paid Checkout session once. The session_id insert is the claim; amount_paid is updated in the same transaction.';

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
