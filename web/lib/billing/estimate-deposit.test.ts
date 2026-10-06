import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEstimateHtml } from './doc-html.ts';
import {
  estimateDepositSaveFields,
  isEstimateDepositEnabled,
  printableEstimateDeposit,
  storedEstimateDepositAmount,
} from './estimate-deposit.ts';
import {
  buildInvoiceCheckoutLineItems,
  checkoutLineItemsSumCents,
  estimatePartsDeposit,
  splitFromEstimate,
} from './invoice-collectable.ts';
import { buildOwnedEstimateMessage } from './owned-doc-mail.ts';

const company = { company_name: 'Lux Service' };
const customer = { name: 'Clinic' };

/** QA case: $10 part, deposit box off, amount still sitting on the row. */
const phantom = {
  partsTotal: 10,
  deposit: 10,
  travelDeposit: 10,
  deposit_required: false,
  balanceDue: 100,
  subtotal: 100,
  tax: 0,
  total: 110,
};

const optedIn = {
  ...phantom,
  deposit_required: true,
  balanceDue: 100,
};

function estimateHtml(data: Record<string, unknown>, total = 110) {
  return buildOwnedEstimateMessage({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-10',
      total,
      services: ['Repair'],
      issues: 'Tip',
      estimate_data: data,
    },
    company,
    theme: null,
  });
}

test('deposit off: save drops the parts-subtotal amount', () => {
  const saved = estimateDepositSaveFields({ enabled: false, amount: 10, total: 110 });
  assert.equal(saved.deposit_required, false);
  assert.equal(saved.deposit, 0);
  assert.equal(saved.travelDeposit, 0);
  assert.equal(saved.balanceDue, 110);
  assert.equal(isEstimateDepositEnabled(saved), false);
  assert.equal(printableEstimateDeposit({ ...saved, partsTotal: 10 }), 0);
});

test('deposit on: save keeps the amount', () => {
  const saved = estimateDepositSaveFields({ enabled: true, amount: 10, total: 110 });
  assert.equal(saved.deposit_required, true);
  assert.equal(saved.deposit, 10);
  assert.equal(saved.travelDeposit, 10);
  assert.equal(saved.balanceDue, 100);
  assert.equal(printableEstimateDeposit(saved), 10);
});

test('parts subtotal alone is not a deposit when the flag is missing', () => {
  const data = { partsTotal: 10, subtotal: 100, total: 110 };
  assert.equal(storedEstimateDepositAmount(data), 0);
  assert.equal(isEstimateDepositEnabled(data), false);
  assert.equal(estimatePartsDeposit(data, 110), 0);
});

test('missing flag derives on from a stored deposit column', () => {
  assert.equal(isEstimateDepositEnabled({ travelDeposit: 10, partsTotal: 10 }), true);
  assert.equal(estimatePartsDeposit({ deposit: 10 }, 110), 10);
});

test('email and PDF omit the deposit line when the flag is off', () => {
  const html = estimateHtml(phantom);
  const pdf = buildEstimateHtml({
    company,
    customer,
    estNumber: 'EST-10',
    dateStr: '10/6/2026',
    services: ['Repair'],
    partsTotal: 10,
    subtotal: 100,
    tax: 0,
    total: 110,
    deposit: 10,
    depositRequired: false,
    balanceDue: 100,
  });
  for (const doc of [html, pdf]) {
    assert.match(doc, /Parts Subtotal/);
    assert.doesNotMatch(doc, /Parts \/ Travel Deposit/);
    assert.doesNotMatch(doc, /must be paid before the service call/);
    assert.doesNotMatch(doc, /Scheduling is contingent on receipt of the parts\/travel deposit/);
  }
});

test('email and PDF keep the deposit line when the flag is on', () => {
  const html = estimateHtml(optedIn);
  const pdf = buildEstimateHtml({
    company,
    customer,
    estNumber: 'EST-10',
    dateStr: '10/6/2026',
    services: ['Repair'],
    partsTotal: 10,
    subtotal: 100,
    tax: 0,
    total: 110,
    deposit: 10,
    depositRequired: true,
    balanceDue: 100,
  });
  for (const doc of [html, pdf]) {
    assert.match(doc, /Parts \/ Travel Deposit/);
    assert.match(doc, /\$10\.00/);
    assert.match(doc, /must be paid before the service call/);
  }
});

test('convert and Stripe charge the full balance when the deposit flag is off', () => {
  assert.equal(estimatePartsDeposit(phantom, 110), 0);
  const split = splitFromEstimate({ total: 110, estimateData: phantom });
  assert.equal(split.hasDeferredSplit, false);
  assert.equal(split.partsDeposit, 0);
  assert.equal(split.dueNowOriginal, 110);
  assert.equal(split.deferredOriginal, 0);
  assert.equal(split.stripeAmount, 110);
  assert.equal(split.paymentKind, 'full');
  const items = buildInvoiceCheckoutLineItems(split, { invoiceNumber: 'INV-10' });
  assert.equal(checkoutLineItemsSumCents(items), 11000);
  assert.notEqual(checkoutLineItemsSumCents(items), 1000);
});

test('convert and Stripe charge only the deposit when the flag is on', () => {
  assert.equal(estimatePartsDeposit(optedIn, 110), 10);
  const split = splitFromEstimate({ total: 110, estimateData: optedIn });
  assert.equal(split.hasDeferredSplit, true);
  assert.equal(split.partsDeposit, 10);
  assert.equal(split.dueNowOriginal, 10);
  assert.equal(split.deferredOriginal, 100);
  assert.equal(split.stripeAmount, 10);
  assert.equal(split.paymentKind, 'deposit');
  const items = buildInvoiceCheckoutLineItems(split, { invoiceNumber: 'INV-10' });
  assert.equal(checkoutLineItemsSumCents(items), 1000);
  assert.equal(items.length, 1);
});
