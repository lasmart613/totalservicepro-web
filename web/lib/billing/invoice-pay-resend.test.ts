import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVOICE_ALREADY_PAID,
  INVOICE_CHECKOUT_ALREADY_PAID,
  INVOICE_PAY_LINK_BUSY,
  invoiceAlreadyPaid,
  openPayLink,
  planInvoicePayLink,
} from './invoice-pay-resend.ts';

const openData = {
  payment_url: 'https://checkout.stripe.com/c/pay/cs_test_open',
  stripe_checkout_session_id: 'cs_test_open',
  payment_amount: 80,
};

test('a stored pay-link session is not treated as paid', () => {
  const inv = { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData };
  assert.equal(invoiceAlreadyPaid(inv), false);
  assert.equal(openPayLink(inv.invoice_data)?.sessionId, 'cs_test_open');
  assert.equal(invoiceAlreadyPaid({ ...inv, status: 'paid' }), true);
  assert.equal(invoiceAlreadyPaid({ ...inv, amount_paid: 80 }), true);
});

test('an open Checkout session is reused and a paid one is refused', async () => {
  let loads = 0;
  let expires = 0;
  const open = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => {
      loads += 1;
      return { status: 'open', payment_status: 'unpaid', amount_total: 8000, url: openData.payment_url };
    },
    expireCheckout: async () => {
      expires += 1;
      return 'expired';
    },
  });
  assert.deepEqual(open, { action: 'reuse', sessionId: 'cs_test_open', url: openData.payment_url });
  assert.equal(loads, 1);
  assert.equal(expires, 0);

  const paid = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => ({ status: 'complete', payment_status: 'paid', amount_total: 8000, url: null }),
    expireCheckout: async () => {
      throw new Error('must not expire a paid session');
    },
  });
  assert.deepEqual(paid, { action: 'skip', reason: INVOICE_CHECKOUT_ALREADY_PAID });
});

test('a paid invoice does not touch Stripe', async () => {
  let calls = 0;
  const plan = await planInvoicePayLink({
    invoice: { id: 3, status: 'paid', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => {
      calls += 1;
      return null;
    },
    expireCheckout: async () => {
      calls += 1;
      return 'failed';
    },
  });
  assert.deepEqual(plan, { action: 'skip', reason: INVOICE_ALREADY_PAID });
  assert.equal(calls, 0);
});

test('a credited deposit session can be replaced with a balance session', async () => {
  let expired = 0;
  const plan = await planInvoicePayLink({
    invoice: {
      id: 3,
      status: 'partially_paid',
      total: 1000,
      amount_paid: 300,
      stripe_session_id: 'cs_test_deposit',
      invoice_data: {
        ...openData,
        stripe_checkout_session_id: 'cs_test_deposit',
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_deposit',
        payment_amount: 300,
        deferredReleased: true,
      },
    },
    payAmount: 700,
    loadCheckout: async () => ({ status: 'complete', payment_status: 'paid', amount_total: 30000, url: null }),
    expireCheckout: async () => {
      expired += 1;
      return 'completed';
    },
  });
  assert.deepEqual(plan, { action: 'create' });
  assert.equal(expired, 0);
});

test('a replacement expires the open session before another can be created', async () => {
  const expired: string[] = [];
  const plan = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => ({ status: 'open', payment_status: 'unpaid', amount_total: 5000, url: openData.payment_url }),
    expireCheckout: async (sessionId) => {
      expired.push(sessionId);
      return 'expired';
    },
  });
  assert.deepEqual(plan, { action: 'create' });
  assert.deepEqual(expired, ['cs_test_open']);

  const stuck = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => null,
    expireCheckout: async () => 'failed',
  });
  assert.deepEqual(stuck, { action: 'skip', reason: INVOICE_PAY_LINK_BUSY });
});
