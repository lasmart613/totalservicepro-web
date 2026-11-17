import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVOICE_PAYMENT_LINK_UNAVAILABLE,
  INVOICE_PAYMENT_URL_HOSTS,
  allowedInvoicePaymentUrl,
  invoicePayPageAction,
} from './invoice-payment-url.ts';

const here = dirname(fileURLToPath(import.meta.url));
const CHECKOUT = 'https://checkout.stripe.com/c/pay/cs_test_abc#fidkdWxOYHwn';

test('allowlist is the Checkout host this app stores on payment_url', () => {
  assert.deepEqual(INVOICE_PAYMENT_URL_HOSTS, ['checkout.stripe.com']);
});

test('accepts a Stripe Checkout URL and returns the canonical href', () => {
  assert.equal(allowedInvoicePaymentUrl(CHECKOUT), CHECKOUT);
  assert.equal(
    allowedInvoicePaymentUrl('https://checkout.stripe.com/c/pay/cs_live_1?foo=1'),
    'https://checkout.stripe.com/c/pay/cs_live_1?foo=1'
  );
  assert.equal(
    allowedInvoicePaymentUrl('  https://CHECKOUT.STRIPE.COM/c/pay/cs_live_2  '),
    'https://checkout.stripe.com/c/pay/cs_live_2'
  );
  assert.equal(
    allowedInvoicePaymentUrl('HTTPS://checkout.stripe.com/c/pay/cs_live_3'),
    'https://checkout.stripe.com/c/pay/cs_live_3'
  );
  assert.equal(
    allowedInvoicePaymentUrl('https://checkout.stripe.com:443/c/pay/cs_live_4'),
    'https://checkout.stripe.com/c/pay/cs_live_4'
  );
  assert.equal(
    allowedInvoicePaymentUrl('https://checkout%2estripe%2ecom/c/pay/cs_live_5'),
    'https://checkout.stripe.com/c/pay/cs_live_5'
  );
});

test('rejects lookalikes, other schemes, userinfo, ports, and encoded hosts', () => {
  const rejected = [
    '',
    '   ',
    'checkout.stripe.com/c/pay/cs',
    '//checkout.stripe.com/c/pay/cs',
    '///checkout.stripe.com/c/pay/cs',
    'http://checkout.stripe.com/c/pay/cs',
    'http://checkout.stripe.com:443/c/pay/cs',
    'javascript:alert(1)',
    'javascript:https://checkout.stripe.com/c/pay/cs',
    'data:text/html,hi',
    'https://user:pass@checkout.stripe.com/c/pay/cs',
    'https://user@checkout.stripe.com/c/pay/cs',
    'https://@checkout.stripe.com/c/pay/cs',
    'https://evil.com%00@checkout.stripe.com/',
    'https://checkout.stripe.com%2e%2e@evil.com/',
    'https://checkout.stripe.com%2F@evil.com/',
    'https://checkout.stripe.com:444/c/pay/cs',
    'https://checkout.stripe.com:80/c/pay/cs',
    'https://checkout.stripe.com:8443/c/pay/cs',
    'https://checkout.stripe.com.evil.com/c/pay/cs',
    'https://evil.checkout.stripe.com/c/pay/cs',
    'https://pay.checkout.stripe.com/c/pay/cs',
    'https://notcheckout.stripe.com/c/pay/cs',
    'https://checkout.stripe.co/c/pay/cs',
    'https://checkout.stripe.com./c/pay/cs',
    'https://checkout.stripe.com%2e/',
    'https://checkout.stripe.com%2e.evil.com/c/pay/cs',
    'https://checkout.stripe.com%00.evil.com/',
    'https://checkout.stripe.com%09.evil.com/',
    'https://checkout.stripe.com%252e.evil.com/',
    'https://checkout.stripe.com%40evil.com/',
    'https://checkout.stripe.com%5c.evil.com/',
    'https://checkout.stripe.com\\@evil.com/',
    'https://evil.com\\@checkout.stripe.com/',
    'https://checkout.stripe.com\\evil.com',
    'https://checkout.stripe.com\t.evil.com/',
    'https://checkout.stripe.com .evil.com/',
    'https://invoice.stripe.com/i/acct_real',
    'https://buy.stripe.com/test_abc',
    'https://pay.stripe.com/receipts/in_1',
    'https://api.stripe.com/v1/checkout/sessions',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://check\u043eut.stripe.com/c/pay/cs',
    'https:checkout.stripe.com/c/pay/cs',
    null,
    undefined,
    1,
    { href: CHECKOUT },
  ];
  for (const value of rejected) {
    assert.equal(allowedInvoicePaymentUrl(value), null, `accepted ${String(value)}`);
  }
});

test('pay page redirects only to an allowed URL and otherwise shows the unavailable state', () => {
  assert.deepEqual(invoicePayPageAction({ payable: true, paymentUrl: CHECKOUT }), {
    type: 'redirect',
    url: CHECKOUT,
  });
  assert.deepEqual(
    invoicePayPageAction({
      payable: true,
      paymentUrl: 'https://evil.example/phish',
    }),
    { type: 'unavailable', message: INVOICE_PAYMENT_LINK_UNAVAILABLE }
  );
  assert.deepEqual(
    invoicePayPageAction({
      payable: true,
      paymentUrl: 'javascript:alert(1)',
    }),
    { type: 'unavailable', message: INVOICE_PAYMENT_LINK_UNAVAILABLE }
  );
  assert.deepEqual(
    invoicePayPageAction({
      payable: true,
      paymentUrl: 'https://user@checkout.stripe.com/c/pay/cs',
    }),
    { type: 'unavailable', message: INVOICE_PAYMENT_LINK_UNAVAILABLE }
  );
  assert.deepEqual(invoicePayPageAction({ voided: false, payable: false, message: INVOICE_PAYMENT_LINK_UNAVAILABLE }), {
    type: 'unavailable',
    message: INVOICE_PAYMENT_LINK_UNAVAILABLE,
  });
  assert.deepEqual(invoicePayPageAction({ voided: true, message: 'This invoice was voided', paymentUrl: 'https://evil.example' }), {
    type: 'voided',
    message: 'This invoice was voided',
  });
  assert.equal(invoicePayPageAction({}).type, 'message');
});

test('000962 replaces the 000803 guard and the rollback restores the column lock only', () => {
  const forward = readFileSync(
    join(here, '../../supabase/migrations/20261117_000962_service_invoice_payment_url_guard.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../../supabase/migrations/20261117_000962_service_invoice_payment_url_guard_rollback.sql'),
    'utf8'
  );
  assert.match(forward, /CREATE OR REPLACE FUNCTION public\.service_invoices_guard_stripe_session\(\)/);
  assert.match(forward, /IF auth\.uid\(\) IS NULL THEN/);
  assert.match(forward, /stripe_session_id cannot be set by the client/);
  assert.match(forward, /stripe_session_id cannot be changed by the client/);
  assert.match(forward, /lower\(e\.key\) = 'payment_url'/);
  assert.match(forward, /position\('stripe_checkout_session' IN lower\(e\.key\)\) = 1/);
  assert.match(forward, /stripe_checkout_expired_ids/);
  assert.match(forward, /invoice payment fields cannot be changed by the client/);
  assert.doesNotMatch(rollback, /invoice payment fields cannot be changed by the client/);
  assert.match(rollback, /stripe_session_id cannot be changed by the client/);
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.service_invoices_guard_stripe_session\(\)/);
});

test('the pay page assigns the checked URL and not the raw paymentUrl', () => {
  const page = readFileSync(join(here, '../../app/pay/invoice/[id]/page.tsx'), 'utf8');
  assert.match(page, /invoicePayPageAction\(json\)/);
  assert.match(page, /window\.location\.assign\(action\.url\)/);
  assert.doesNotMatch(page, /assign\(\s*json\.paymentUrl\s*\)/);
});
