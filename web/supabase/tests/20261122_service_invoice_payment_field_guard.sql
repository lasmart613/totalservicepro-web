-- Local proof: apply 000962, then 000969, refuse string/array invoice_data,
-- roll back to the 000962 function body, and reapply 000969.
-- Empty Postgres only (never production). One transaction, ends in ROLLBACK.
--
--   createdb invoice_pay_field_guard_proof
--   psql "postgresql:///invoice_pay_field_guard_proof" -v ON_ERROR_STOP=1 \
--     -f web/supabase/tests/20261122_service_invoice_payment_field_guard.sql
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.service_invoices') IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to run: public.service_invoices already exists';
  END IF;
END $$;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;

CREATE TABLE public.service_invoices (
  id bigint PRIMARY KEY,
  stripe_session_id text,
  invoice_data json,
  status text
);
GRANT SELECT, INSERT, UPDATE ON public.service_invoices TO authenticated, service_role;

INSERT INTO public.service_invoices (id, stripe_session_id, invoice_data, status)
VALUES (
  1,
  'cs_live_claimed',
  json_build_object(
    'payment_url', 'https://checkout.stripe.com/c/pay/cs_live_1',
    'stripe_checkout_session_id', 'cs_live_1',
    'replaced_checkout_session_ids', json_build_array('cs_old'),
    'stripe_payment_intent_id', 'pi_live_1',
    'note', 'keep me'
  ),
  'sent'
);

\ir ../migrations/20261117_000962_service_invoice_payment_url_guard.sql
\ir ../migrations/20261122_000969_service_invoice_payment_field_guard.sql

CREATE TEMP TABLE proof (n serial, label text, ok boolean);
CREATE TEMP TABLE fn_after_969 (body text);
INSERT INTO fn_after_969
SELECT pg_get_functiondef('public.service_invoices_guard_stripe_session()'::regprocedure);

CREATE FUNCTION pg_temp.attempt(role_name text, stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  result text;
BEGIN
  -- 000962 still bypasses when auth.uid() is null. A client attempt needs a sub
  -- so the rollback check is actually running as a signed-in user.
  PERFORM set_config(
    'request.jwt.claim.sub',
    CASE WHEN role_name IN ('authenticated', 'anon')
      THEN 'aaaaaaaa-0000-0000-0000-000000000001'
      ELSE ''
    END,
    true
  );
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    EXECUTE stmt;
    result := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS result = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN result;
END $$;

INSERT INTO proof (label, ok)
SELECT '000969 is security invoker', NOT prosecdef
FROM pg_proc
WHERE oid = 'public.service_invoices_guard_stripe_session()'::regprocedure;

INSERT INTO proof (label, ok)
SELECT 'client can edit a non-payment key',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = (invoice_data::jsonb || jsonb_build_object('note', 'edited'))::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'that edit kept the pay link',
  invoice_data::jsonb ->> 'note' = 'edited'
  AND invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_1'
FROM public.service_invoices WHERE id = 1;

INSERT INTO proof (label, ok)
SELECT 'client payment_url is stripped back',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://evil.example/phish"')::json
    WHERE id = 1
  $q$) = 'ok'
  AND (SELECT invoice_data::jsonb ->> 'payment_url' FROM public.service_invoices WHERE id = 1)
      = 'https://checkout.stripe.com/c/pay/cs_live_1';

INSERT INTO proof (label, ok)
SELECT 'client payment key overlay is accepted',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = (
      invoice_data::jsonb
      || jsonb_build_object(
        'stripe_payment_intent_id', 'pi_evil',
        'replaced_checkout_session_ids', jsonb_build_array('cs_evil'),
        'note', 'still here'
      )
    )::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'payment_intent and replaced session ids stayed stored and the note saved: note='
  || COALESCE(invoice_data::jsonb ->> 'note', 'null')
  || ' pi=' || COALESCE(invoice_data::jsonb ->> 'stripe_payment_intent_id', 'null')
  || ' replaced=' || COALESCE(invoice_data::jsonb ->> 'replaced_checkout_session_ids', 'null'),
  invoice_data::jsonb ->> 'stripe_payment_intent_id' = 'pi_live_1'
  AND invoice_data::jsonb -> 'replaced_checkout_session_ids' = jsonb_build_array('cs_old')
  AND invoice_data::jsonb ->> 'note' = 'still here'
FROM public.service_invoices WHERE id = 1;

INSERT INTO proof (label, ok)
SELECT 'client cannot replace invoice_data with a string',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = to_json('{"payment_url":"https://evil.example/phish"}'::text)
    WHERE id = 1
  $q$) = 'invoice_data must be a JSON object';

INSERT INTO proof (label, ok)
SELECT 'client cannot replace invoice_data with an array',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = '[{"payment_url":"https://evil.example/phish"}]'::json
    WHERE id = 1
  $q$) = 'invoice_data must be a JSON object';

INSERT INTO proof (label, ok)
SELECT 'string and array writes left the object in place',
  jsonb_typeof(invoice_data::jsonb) = 'object'
  AND invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_1'
FROM public.service_invoices WHERE id = 1;

INSERT INTO proof (label, ok)
SELECT 'client cannot insert a string invoice_data',
  pg_temp.attempt('authenticated', $q$
    INSERT INTO public.service_invoices (id, invoice_data)
    VALUES (2, to_json('{"payment_url":"https://evil.example"}'::text))
  $q$) = 'invoice_data must be a JSON object';

INSERT INTO proof (label, ok)
SELECT 'service_role payment_url write is accepted',
  pg_temp.attempt('service_role', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://checkout.stripe.com/c/pay/cs_live_2"')::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'service_role payment_url was stored: ' || COALESCE(invoice_data::jsonb ->> 'payment_url', 'null'),
  invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_2'
FROM public.service_invoices WHERE id = 1;

-- Put the original link back before rollback checks.
UPDATE public.service_invoices
SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://checkout.stripe.com/c/pay/cs_live_1"')::json
WHERE id = 1;

\ir ../migrations/20261122_000969_service_invoice_payment_field_guard_rollback.sql

INSERT INTO proof (label, ok)
SELECT 'rollback restored the 000962 function body',
  pg_get_functiondef('public.service_invoices_guard_stripe_session()'::regprocedure)
    LIKE '%auth.uid() IS NULL%'
  AND pg_get_functiondef('public.service_invoices_guard_stripe_session()'::regprocedure)
    NOT LIKE '%current_user NOT IN%';

INSERT INTO proof (label, ok)
SELECT 'after rollback a client payment_url change is rejected again',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://evil.example/after-rollback"')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

\ir ../migrations/20261122_000969_service_invoice_payment_field_guard.sql
\ir ../migrations/20261122_000969_service_invoice_payment_field_guard.sql

INSERT INTO proof (label, ok)
SELECT 'reapplying 000969 is idempotent',
  pg_get_functiondef('public.service_invoices_guard_stripe_session()'::regprocedure)
    = (SELECT body FROM fn_after_969);

INSERT INTO proof (label, ok)
SELECT 'after reapply a string invoice_data is still refused',
  pg_temp.attempt('authenticated', $q$
    UPDATE public.service_invoices
    SET invoice_data = to_json('{"payment_url":"https://evil.example/reapply"}'::text)
    WHERE id = 1
  $q$) = 'invoice_data must be a JSON object';

DO $$
DECLARE
  failed text;
BEGIN
  SELECT string_agg(label, '; ' ORDER BY n) INTO failed FROM proof WHERE NOT ok;
  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'invoice payment field guard proof failed: %', failed;
  END IF;
  RAISE NOTICE 'invoice payment field guard proof passed (% checks)', (SELECT count(*) FROM proof);
END $$;

ROLLBACK;
