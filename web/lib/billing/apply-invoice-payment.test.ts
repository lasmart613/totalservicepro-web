import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alreadyAppliedSession,
  buildInvoicePaymentPatch,
  checkoutLooksLikeInvoicePay,
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

test('applying a Stripe session is idempotent and adds to prior deposit', () => {
  const inv = {
    id: 9,
    total: 250,
    invoice_data: { deposit: 50, stripe_checkout_session_id: 'cs_live_old' },
  };
  assert.equal(alreadyAppliedSession(inv, 'cs_live_old'), true);
  assert.equal(alreadyAppliedSession(inv, 'cs_live_new'), false);
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
