import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEstimateActionCtasHtml,
  buildInvoiceHtml,
  ensureEstimateActionCtas,
} from './doc-html.ts';

const TOKEN_URL = 'https://repairplanet.net/e/abc-token-123';

test('estimate email CTAs are Approve / Reject / Modify on tokenized links', () => {
  const html = buildEstimateActionCtasHtml(TOKEN_URL);
  assert.match(html, /tsp-est-cta/);
  assert.match(html, /Respond to this estimate/);
  assert.match(html, />Approve</);
  assert.match(html, />Reject</);
  assert.match(html, />Modify</);
  assert.match(html, /\?action=approve/);
  assert.match(html, /\?action=reject/);
  assert.match(html, /\?action=modify/);
  assert.doesNotMatch(html, /Sign in with your clinic account/);
  assert.doesNotMatch(html, /Request Changes/);
});

test('ensureEstimateActionCtas puts three CTAs at the top and bottom', () => {
  const stub =
    `<div>Estimate body</div>` +
    `<table class="tsp-est-cta"><tr><td>Approve Estimate</td></tr></table>` +
    `Thank you for choosing Acme`;
  const html = ensureEstimateActionCtas(stub, TOKEN_URL);
  assert.match(html, />Approve</);
  assert.match(html, />Reject</);
  assert.match(html, />Modify</);
  assert.ok((html.match(/tsp-est-cta/g) || []).length >= 2);
  assert.match(html, /tsp-est-cta-top/);
  assert.match(html, /tsp-est-cta-bottom/);
  assert.match(html, /Thank you for choosing Acme/);
  assert.ok(html.indexOf('Respond to this estimate') < html.indexOf('Estimate body'));
});

test('ensureEstimateActionCtas injects CTAs when the client HTML has none', () => {
  const html = ensureEstimateActionCtas(
    '<div>Quote</div>Thank you for choosing Acme!',
    TOKEN_URL
  );
  assert.match(html, /tsp-est-cta-top/);
  assert.match(html, /\?action=approve/);
});

const invoiceBase = {
  company: { company_name: 'Lux Service' },
  customer: { name: 'Clinic' },
  invNumber: 'LUX-INV-20260917-01',
  invoiceDate: '2026-09-17',
  lines: [
    { description: 'Parts', qty: 1, unit_price: 650, ext: 650 },
    { description: 'Labor', qty: 1, unit_price: 905, ext: 905 },
  ],
  subtotal: 1555,
  tax: 0,
  total: 1555,
};

test('invoice HTML shows due-now deposit vs deferred remainder; pay button is deposit only', () => {
  const html = buildInvoiceHtml({
    ...invoiceBase,
    dueNow: 650,
    deferred: 905,
    deposit: 0,
    collectableAmount: 650,
    paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_deposit',
  });
  assert.match(html, /Invoice Total: \$1555\.00/);
  assert.match(html, /Due now \(parts\/travel deposit\)/);
  assert.match(html, /Remaining \(due on completion\)/);
  assert.match(html, /Pay deposit \$650\.00 securely with Stripe/);
  assert.doesNotMatch(html, /Pay \$1,555\.00 securely with Stripe/);
  assert.doesNotMatch(html, /Pay \$905\.00 securely with Stripe/);
});

test('invoice HTML after deposit paid has no Stripe button until remainder is released', () => {
  const html = buildInvoiceHtml({
    ...invoiceBase,
    dueNow: 650,
    deferred: 905,
    deposit: 650,
    depositMethod: 'Stripe',
    balanceDue: 905,
    collectableAmount: 0,
    paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_stale',
  });
  assert.match(html, /Deposit received: <strong>\$650\.00<\/strong>/);
  assert.match(html, /upon completion of the service call/);
  assert.doesNotMatch(html, /Pay .* securely with Stripe/);
});
