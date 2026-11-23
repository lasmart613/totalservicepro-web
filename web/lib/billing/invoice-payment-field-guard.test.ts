import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeFormInvoiceData } from './invoice-form-data.ts';
import { sealClientInvoicePaymentKeys } from './invoice-payment-fields.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('a client form cannot replace payment_url, session ids, or payment_intent', () => {
  const stored = {
    line_items: [{ description: 'old' }],
    payment_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
    stripe_checkout_session_id: 'cs_test_abc',
    replaced_checkout_session_ids: ['cs_old'],
    stripe_payment_intent_id: 'pi_test_abc',
    payment_amount: 100,
    payment_amount_minor: 10000,
    payment_currency: 'usd',
    deposit: 10,
  };
  const merged = mergeFormInvoiceData(stored, {
    line_items: [{ description: 'Flashlamp' }],
    payment_url: 'https://evil.example/phish',
    replaced_checkout_session_ids: ['cs_evil'],
    stripe_payment_intent_id: 'pi_evil',
    payment_amount: 50,
    payment_amount_minor: 5000,
    payment_currency: 'eur',
    deposit: 0,
  });
  assert.equal(merged.payment_url, stored.payment_url);
  assert.equal(merged.stripe_checkout_session_id, 'cs_test_abc');
  assert.deepEqual(merged.replaced_checkout_session_ids, ['cs_old']);
  assert.equal(merged.stripe_payment_intent_id, 'pi_test_abc');
  assert.equal(merged.payment_amount, 100);
  assert.equal(merged.payment_amount_minor, 10000);
  assert.equal(merged.payment_currency, 'usd');
  assert.equal(merged.deposit, 0);
  const created = sealClientInvoicePaymentKeys(undefined, {
    note: 'new',
    payment_url: 'https://evil.example/phish',
    Payment_Intent: 'pi_evil',
  });
  assert.equal(created.note, 'new');
  assert.equal('payment_url' in created, false);
  assert.equal('Payment_Intent' in created, false);
});

test('000969 builds on 000962 and its rollback is that function', () => {
  const guard = readFileSync(
    join(here, '../../supabase/migrations/20261122_000969_service_invoice_payment_field_guard.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../../supabase/migrations/20261122_000969_service_invoice_payment_field_guard_rollback.sql'),
    'utf8'
  );
  const prior = readFileSync(
    join(here, '../../supabase/migrations/20261117_000962_service_invoice_payment_url_guard.sql'),
    'utf8'
  );
  assert.match(guard, /current_user NOT IN \('authenticated', 'anon'\) AND auth\.uid\(\) IS NULL/);
  assert.match(guard, /SECURITY INVOKER/);
  assert.match(guard, /invoice payment fields cannot be changed by the client/);
  assert.match(guard, /000962 guard is not installed/);
  assert.match(guard, /payment_amount_minor/);
  assert.doesNotMatch(guard, /GRANT EXECUTE ON FUNCTION public\.service_invoices_guard_stripe_session\(\) TO authenticated/);
  assert.match(guard, /invoice_data must be a JSON object/);
  assert.match(guard, /position\('checkout_session' IN lower\(e\.key\)\)/);
  assert.match(guard, /position\('payment_intent' IN lower\(e\.key\)\)/);
  const priorFn = prior.slice(prior.indexOf('CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()')).trim();
  const rollbackFn = rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION public.service_invoices_guard_stripe_session()')).trim();
  assert.equal(rollbackFn, priorFn);
});
