-- Local proof for 20261117_000962_service_invoice_payment_url_guard.sql
-- and its rollback.
-- Empty Postgres only (never production). Refuses to run when
-- public.service_invoices already exists. One transaction, ends in ROLLBACK.
--
--   createdb invoice_pay_url_guard_proof
--   psql "postgresql:///invoice_pay_url_guard_proof" -v ON_ERROR_STOP=1 \
--     -f path/to/web/supabase/tests/20261117_service_invoice_payment_url_guard.sql
--
-- The service-role path is auth.uid() IS NULL, which is what 000803 already
-- uses. getSupabaseAdmin() sends the service-role JWT, and that JWT has no
-- sub. The test sets role service_role and clears the sub.
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
    'stripe_checkout_session_ids', json_build_array('cs_live_1'),
    'stripe_checkout_expired_ids', json_build_array('cs_old'),
    'note', 'keep me',
    'line_items', json_build_array(json_build_object('description', 'labor'))
  ),
  'sent'
);

-- Apply twice: CREATE OR REPLACE is re-runnable.
\ir ../migrations/20261117_000962_service_invoice_payment_url_guard.sql
\ir ../migrations/20261117_000962_service_invoice_payment_url_guard.sql

CREATE TEMP TABLE proof (n serial, label text, ok boolean);

-- attempt(role, uid, sql) returns 'ok' or the error message. A failed
-- statement is undone. A successful statement is kept. The jwt sub is
-- cleared before return so the next statement is not still a client.
CREATE FUNCTION pg_temp.attempt(role_name text, uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  result text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
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

-- Each check is its own statement. One INSERT would not promise that a
-- later row sees an earlier row's UPDATE.
INSERT INTO proof (label, ok)
SELECT 'function is security definer with pinned search_path',
  prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
FROM pg_proc
WHERE oid = 'public.service_invoices_guard_stripe_session()'::regprocedure;

INSERT INTO proof (label, ok) VALUES
  ('authenticated cannot execute the guard', NOT has_function_privilege('authenticated', 'public.service_invoices_guard_stripe_session()', 'EXECUTE'));

INSERT INTO proof (label, ok)
SELECT 'client can edit a non-locked invoice_data key',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET status = 'sent',
        invoice_data = (invoice_data::jsonb || jsonb_build_object('note', 'edited', 'po', 'PO-1'))::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'that edit kept payment_url and the session ids',
  invoice_data::jsonb ->> 'note' = 'edited'
  AND invoice_data::jsonb ->> 'po' = 'PO-1'
  AND invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_1'
  AND invoice_data::jsonb ->> 'stripe_checkout_session_id' = 'cs_live_1'
  AND invoice_data::jsonb -> 'stripe_checkout_session_ids' = '["cs_live_1"]'::jsonb
  AND invoice_data::jsonb -> 'stripe_checkout_expired_ids' = '["cs_old"]'::jsonb
FROM public.service_invoices WHERE id = 1;

INSERT INTO proof (label, ok)
SELECT 'client payment_url change is blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://evil.example/phish"')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'payment_url unchanged after the blocked write',
  invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_1'
FROM public.service_invoices WHERE id = 1;

INSERT INTO proof (label, ok)
SELECT 'client cannot drop payment_url',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = (invoice_data::jsonb - 'payment_url')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'client stripe_checkout_session_id change is blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{stripe_checkout_session_id}', '"cs_evil"')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'client stripe_checkout_session_ids change is blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{stripe_checkout_session_ids}', '["cs_live_1","cs_evil"]')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'client stripe_checkout_expired_ids change is blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{stripe_checkout_expired_ids}', '["cs_evil"]')::json
    WHERE id = 1
  $q$) = 'invoice payment fields cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'client stripe_session_id change is still blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices SET stripe_session_id = 'cs_evil' WHERE id = 1
  $q$) = 'stripe_session_id cannot be changed by the client';

INSERT INTO proof (label, ok)
SELECT 'client insert of payment_url is blocked',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    INSERT INTO public.service_invoices (id, invoice_data, status)
    VALUES (2, '{"payment_url":"https://evil.example"}'::json, 'draft')
  $q$) = 'invoice payment fields cannot be set by the client';

INSERT INTO proof (label, ok)
SELECT 'client insert without payment fields is allowed',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    INSERT INTO public.service_invoices (id, invoice_data, status)
    VALUES (3, '{"note":"draft"}'::json, 'draft')
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'service_role can change payment_url and session ids',
  pg_temp.attempt('service_role', '', $q$
    UPDATE public.service_invoices
    SET stripe_session_id = 'cs_live_2',
        invoice_data = jsonb_set(
          jsonb_set(
            jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://checkout.stripe.com/c/pay/cs_live_2"'),
            '{stripe_checkout_session_id}', '"cs_live_2"'
          ),
          '{stripe_checkout_session_ids}', '["cs_live_1","cs_live_2"]'
        )::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'service_role write landed',
  stripe_session_id = 'cs_live_2'
  AND invoice_data::jsonb ->> 'payment_url' = 'https://checkout.stripe.com/c/pay/cs_live_2'
  AND invoice_data::jsonb ->> 'stripe_checkout_session_id' = 'cs_live_2'
  AND invoice_data::jsonb -> 'stripe_checkout_session_ids' = '["cs_live_1","cs_live_2"]'::jsonb
  AND invoice_data::jsonb ->> 'note' = 'edited'
FROM public.service_invoices WHERE id = 1;

-- Rollback restores client edits of payment_url and keeps the column lock.
\ir ../migrations/20261117_000962_service_invoice_payment_url_guard_rollback.sql

INSERT INTO proof (label, ok)
SELECT 'rollback lets a client change payment_url',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices
    SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://evil.example/after-rollback"')::json
    WHERE id = 1
  $q$) = 'ok';

INSERT INTO proof (label, ok)
SELECT 'rollback still blocks stripe_session_id',
  pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
    UPDATE public.service_invoices SET stripe_session_id = 'cs_evil' WHERE id = 1
  $q$) = 'stripe_session_id cannot be changed by the client';

\ir ../migrations/20261117_000962_service_invoice_payment_url_guard.sql

INSERT INTO proof (label, ok) VALUES
  ('re-apply blocks a client payment_url change again',
    pg_temp.attempt('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', $q$
      UPDATE public.service_invoices
      SET invoice_data = jsonb_set(invoice_data::jsonb, '{payment_url}', '"https://evil.example/reapply"')::json
      WHERE id = 1
    $q$) = 'invoice payment fields cannot be changed by the client');

SELECT n, label, ok FROM proof ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE ok IS NOT TRUE) AS fail FROM proof;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM proof WHERE ok IS NOT TRUE) THEN RAISE EXCEPTION 'proof failed'; END IF; END $$;
ROLLBACK;
