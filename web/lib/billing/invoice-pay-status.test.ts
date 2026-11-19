import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVOICE_PAY_LINK_REPLACED,
  INVOICE_PAY_STATUS_NOT_FOUND,
  invoicePayStatusDecision,
} from './invoice-pay-status.ts';

const row = {
  status: 'sent',
  invoice_data: {
    payment_url: 'https://checkout.stripe.com/c/pay/cs_test_new',
    stripe_checkout_session_id: 'cs_test_new',
    replaced_checkout_session_ids: ['cs_test_old'],
    stripe_checkout_session_ids: ['cs_test_webhook'],
    line_items: [{ description: 'Service' }],
  },
};

test('a replaced emailed link is not a 404 and does not reveal the new URL', () => {
  const replaced = invoicePayStatusDecision(row, 'cs_test_old');
  assert.equal(replaced.httpStatus, 200);
  assert.equal(replaced.body.payable, false);
  assert.equal(replaced.body.message, INVOICE_PAY_LINK_REPLACED);
  assert.equal('paymentUrl' in replaced.body, false);

  const current = invoicePayStatusDecision(row, 'cs_test_new');
  assert.equal(current.httpStatus, 200);
  assert.equal(current.body.payable, true);
  assert.equal(current.body.paymentUrl, 'https://checkout.stripe.com/c/pay/cs_test_new');
});

test('unknown and voided sessions stay the same not-found body', () => {
  const missing = invoicePayStatusDecision(null, 'cs_test_stranger');
  const stranger = invoicePayStatusDecision(row, 'cs_test_stranger');
  assert.equal(missing.httpStatus, 404);
  assert.equal(stranger.httpStatus, 404);
  assert.deepEqual(missing.body, INVOICE_PAY_STATUS_NOT_FOUND);
  assert.deepEqual(stranger.body, missing.body);

  const voidedStranger = invoicePayStatusDecision(
    { status: 'void', invoice_data: row.invoice_data },
    'cs_test_stranger'
  );
  assert.equal(voidedStranger.httpStatus, 404);
  assert.deepEqual(voidedStranger.body, missing.body);

  const voidedCustomer = invoicePayStatusDecision({ status: 'void', invoice_data: row.invoice_data }, 'cs_test_new');
  assert.equal(voidedCustomer.httpStatus, 200);
  assert.equal(voidedCustomer.body.voided, true);
  assert.equal(voidedCustomer.body.message, 'This invoice was voided');
});
