import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoicePaymentPatch } from './apply-invoice-payment.ts';
import {
  buildInvoiceCheckoutLineItems,
  checkoutLineItemsSumCents,
  collectableInvoiceDataFields,
  estimatePartsDeposit,
  invoiceCheckoutDescription,
  releaseDeferredBalance,
  resolveInvoiceCollectable,
  splitFromEstimate,
} from './invoice-collectable.ts';

const LUX = {
  total: 1555,
  deposit: 650,
  remainder: 905,
  estimateData: {
    deposit: 650,
    travelDeposit: 650,
    deposit_required: true,
    balanceDue: 905,
  },
};

test('estimate parts deposit reads deposit / travelDeposit / parts_deposit', () => {
  assert.equal(estimatePartsDeposit({ deposit: 650, deposit_required: true }, 1555), 650);
  assert.equal(estimatePartsDeposit({ travelDeposit: 650 }, 1555), 650);
  assert.equal(estimatePartsDeposit({ parts_deposit: 650 }, 1555), 650);
  assert.equal(estimatePartsDeposit({ deposit: 650, deposit_required: false }, 1555), 0);
  assert.equal(estimatePartsDeposit({}, 1555), 0);
});

test('deposit present → Stripe amount = deposit; deferred excluded from line_items sum', () => {
  const split = splitFromEstimate({
    total: LUX.total,
    estimateData: LUX.estimateData,
  });
  assert.equal(split.hasDeferredSplit, true);
  assert.equal(split.partsDeposit, 650);
  assert.equal(split.dueNowOriginal, 650);
  assert.equal(split.deferredOriginal, 905);
  assert.equal(split.stripeAmount, 650);
  assert.equal(split.paymentKind, 'deposit');

  const lineItems = buildInvoiceCheckoutLineItems(split, {
    invoiceNumber: 'LUX-INV-20260917-01',
  });
  const sum = checkoutLineItemsSumCents(lineItems);
  assert.equal(lineItems.length, 1);
  assert.equal(lineItems[0].unit_amount, 65000);
  assert.equal(sum, 65000);
  assert.notEqual(sum, 155500);
  assert.notEqual(sum, 90500);
  assert.match(invoiceCheckoutDescription(split, 'LUX-INV-20260917-01'), /parts\/travel deposit/);
});

test('no deposit → Stripe amount = full invoice total', () => {
  const split = splitFromEstimate({
    total: LUX.total,
    estimateData: { deposit_required: false, labor: 1555 },
  });
  assert.equal(split.hasDeferredSplit, false);
  assert.equal(split.partsDeposit, 0);
  assert.equal(split.stripeAmount, 1555);
  assert.equal(split.paymentKind, 'full');

  const lineItems = buildInvoiceCheckoutLineItems(split, { invoiceNumber: 'INV-1' });
  assert.equal(checkoutLineItemsSumCents(lineItems), 155500);
});

test('deferred remainder is not included in Checkout Session amount', () => {
  const split = resolveInvoiceCollectable({
    total: 1555,
    amountPaid: 0,
    invoice_data: collectableInvoiceDataFields(
      splitFromEstimate({ total: 1555, estimateData: LUX.estimateData })
    ),
  });
  const items = buildInvoiceCheckoutLineItems(split);
  const amount = split.stripeAmount;
  const lineSum = checkoutLineItemsSumCents(items) / 100;
  assert.equal(amount, 650);
  assert.equal(lineSum, 650);
  assert.equal(split.deferredUnpaid, 905);
  assert.ok(lineSum + split.deferredUnpaid === split.total);
});

test('after deposit is paid, Stripe amount is 0 until remainder is released', () => {
  const fields = collectableInvoiceDataFields(
    splitFromEstimate({ total: 1555, estimateData: LUX.estimateData })
  );
  const afterPay = resolveInvoiceCollectable({
    total: 1555,
    amountPaid: 650,
    invoice_data: { ...fields, deposit: 650, depositMethod: 'Stripe' },
  });
  assert.equal(afterPay.stripeAmount, 0);
  assert.equal(afterPay.remainingOwed, 905);
  assert.equal(afterPay.deferredUnpaid, 905);
  assert.equal(buildInvoiceCheckoutLineItems(afterPay).length, 0);

  const released = resolveInvoiceCollectable({
    total: 1555,
    amountPaid: 650,
    invoice_data: releaseDeferredBalance({ ...fields, deposit: 650 }),
  });
  assert.equal(released.deferredReleased, true);
  assert.equal(released.stripeAmount, 905);
  assert.equal(released.paymentKind, 'balance');
  assert.equal(checkoutLineItemsSumCents(buildInvoiceCheckoutLineItems(released)), 90500);
});

test('webhook-style payment patch keeps deferred fields and stays partially_paid', () => {
  const fields = collectableInvoiceDataFields(
    splitFromEstimate({ total: 1555, estimateData: LUX.estimateData })
  );
  const patch = buildInvoicePaymentPatch({
    invoice: {
      id: 1,
      total: 1555,
      amount_paid: 0,
      invoice_data: { ...fields, deposit: 0 },
    },
    addAmount: 650,
    method: 'Stripe',
    sessionId: 'cs_test_deposit',
    now: new Date('2026-09-19T12:00:00Z'),
  });
  assert.equal(patch.status, 'partially_paid');
  assert.equal(patch.amount_paid, 650);
  assert.equal(patch.invoice_data.dueNow, 650);
  assert.equal(patch.invoice_data.deferred, 905);
  assert.equal(patch.invoice_data.deferredReleased, false);
  assert.equal(patch.invoice_data.balanceDue, 905);

  const after = resolveInvoiceCollectable({
    total: 1555,
    amountPaid: patch.amount_paid,
    invoice_data: patch.invoice_data,
  });
  assert.equal(after.stripeAmount, 0);
});

test('charge-full convert option disables the split', () => {
  const split = splitFromEstimate({
    total: 1555,
    estimateData: LUX.estimateData,
    chargeDepositOnly: false,
  });
  assert.equal(split.hasDeferredSplit, false);
  assert.equal(split.stripeAmount, 1555);
});
