import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(here, '../../supabase/migrations/20261118_000963_service_invoice_stripe_payments.sql'),
  'utf8'
);
const rollback = readFileSync(
  join(here, '../../supabase/migrations/20261118_000963_service_invoice_stripe_payments_rollback.sql'),
  'utf8'
);

test('000963 claims a Checkout session in one function and locks the table to the service role', () => {
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.service_invoice_stripe_payments/);
  assert.match(sql, /PRIMARY KEY \(session_id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.service_invoice_stripe_payments FROM PUBLIC/);
  assert.match(sql, /ON CONFLICT \(session_id\) DO NOTHING/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /INSERT INTO public\.service_invoice_stripe_payments/);
  assert.match(sql, /stripe_session_id = v_session/);
  assert.match(sql, /invoice_data = \(/);
  assert.match(sql, /WHEN unique_violation THEN/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.apply_service_invoice_stripe_payment/);
  assert.match(rollback, /DROP TABLE IF EXISTS public\.service_invoice_stripe_payments/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.apply_service_invoice_stripe_payment/);
  assert.doesNotMatch(rollback, /DROP COLUMN[\s\S]*stripe_session_id/);
});
