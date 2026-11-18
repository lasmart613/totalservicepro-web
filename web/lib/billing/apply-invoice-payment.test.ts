import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alreadyAppliedSession,
  buildInvoicePaymentPatch,
  checkoutBelongsToInvoice,
  checkoutLooksLikeInvoicePay,
  invoiceFullyPaid,
  invoiceSessionClaimFilter,
  invoiceSessionCreditFilter,
  paymentStatusFromAmounts,
} from './apply-invoice-payment.ts';

test('full payment marks paid; short payment is partially_paid', () => {
  assert.equal(paymentStatusFromAmounts(100, 100), 'paid');
  assert.equal(paymentStatusFromAmounts(100, 100.004), 'paid');
  assert.equal(paymentStatusFromAmounts(100, 40), 'partially_paid');
  assert.equal(paymentStatusFromAmounts(100, 0), 'sent');
});

test('Stripe invoice checkout is detected from metadata, not subscription mode', () => {
  assert.equal(
    checkoutLooksLikeInvoicePay({ mode: 'payment', metadata: { invoice_id: '12', kind: 'invoice_pay' } }),
    true
  );
  assert.equal(checkoutLooksLikeInvoicePay({ mode: 'subscription', metadata: { invoice_id: '12' } }), false);
  assert.equal(checkoutLooksLikeInvoicePay({ mode: 'payment', metadata: {} }), false);
});

test('an open pay-link session id is not proof of payment', () => {
  const inv = {
    id: 9,
    total: 250,
    invoice_data: { deposit: 50, stripe_checkout_session_id: 'cs_live_old' },
  };
  assert.equal(alreadyAppliedSession(inv, 'cs_live_old'), false);
  assert.equal(alreadyAppliedSession({ ...inv, stripe_session_id: 'cs_live_old' }, 'cs_live_old'), true);
  assert.equal(alreadyAppliedSession({ ...inv, stripe_session_id: 'cs_live_old' }, 'cs_live_new'), false);
  assert.equal(invoiceFullyPaid({ id: 9, total: 250, status: 'paid', amount_paid: 0 }), true);
  assert.equal(invoiceFullyPaid({ id: 9, total: 250, status: 'sent', amount_paid: 250 }), true);
  assert.equal(invoiceFullyPaid({ id: 9, total: 250, status: 'partially_paid', amount_paid: 50 }), false);
  assert.equal(
    invoiceSessionClaimFilter('cs_test_race1'),
    'stripe_session_id.is.null,stripe_session_id.eq.cs_test_race1'
  );
  assert.equal(invoiceSessionCreditFilter('cs_test_race1'), 'stripe_session_id.is.null');
  assert.deepEqual(checkoutBelongsToInvoice({ metadata: { invoice_id: '9' }, client_reference_id: '9' }), {
    ok: true,
    invoiceId: '9',
  });
  assert.equal(
    checkoutBelongsToInvoice({ metadata: { invoice_id: '9' }, client_reference_id: '8' }).ok,
    false
  );
  const patch = buildInvoicePaymentPatch({
    invoice: inv,
    addAmount: 200,
    method: 'Stripe',
    sessionId: 'cs_live_new',
    now: new Date('2026-08-25T12:00:00Z'),
  });
  assert.equal(patch.status, 'paid');
  assert.equal(patch.amount_paid, 250);
  assert.equal(patch.invoice_data.balanceDue, 0);
  assert.deepEqual(patch.invoice_data.stripe_checkout_session_ids, ['cs_live_old', 'cs_live_new']);
});

test('a manual payment leaves Checkout session keys untouched', () => {
  const invoice_data = {
    payment_url: 'https://checkout.stripe.com/c/pay/cs_test_open',
    stripe_checkout_session_id: 'cs_test_open',
    stripe_checkout_session_ids: ['cs_test_open'],
    stripe_checkout_expired_ids: ['cs_test_old'],
    line_items: [{ description: 'Service' }],
  };
  const patch = buildInvoicePaymentPatch({
    invoice: { id: 9, total: 80, amount_paid: 0, invoice_data },
    addAmount: 20,
    method: 'Check',
  });
  assert.equal(patch.amount_paid, 20);
  assert.equal(patch.status, 'partially_paid');
  assert.equal(patch.invoice_data.payment_url, invoice_data.payment_url);
  assert.equal(patch.invoice_data.stripe_checkout_session_id, 'cs_test_open');
  assert.deepEqual(patch.invoice_data.stripe_checkout_session_ids, ['cs_test_open']);
  assert.deepEqual(patch.invoice_data.stripe_checkout_expired_ids, ['cs_test_old']);
  assert.deepEqual(patch.invoice_data.line_items, invoice_data.line_items);
});

test('cash partial leaves remaining balance', () => {
  const patch = buildInvoicePaymentPatch({
    invoice: { id: 1, total: 80, invoice_data: {} },
    addAmount: 20,
    method: 'Check',
  });
  assert.equal(patch.status, 'partially_paid');
  assert.equal(patch.amount_paid, 20);
  assert.equal(patch.invoice_data.balanceDue, 60);
  assert.equal(patch.payment_method, 'Check');
});
