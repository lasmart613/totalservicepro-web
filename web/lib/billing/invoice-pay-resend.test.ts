import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVOICE_ALREADY_PAID,
  INVOICE_CHECKOUT_ALREADY_PAID,
  INVOICE_PAY_LINK_BUSY,
  checkoutSessionWasCredited,
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

test('resend expires the open Checkout session and does not expire a paid one', async () => {
  const expired: string[] = [];
  const open = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => ({ status: 'open', payment_status: 'unpaid', amount_total: 8000, url: openData.payment_url }),
    expireCheckout: async (sessionId) => {
      expired.push(sessionId);
      return 'expired';
    },
  });
  assert.deepEqual(open, { action: 'create' });
  assert.deepEqual(expired, ['cs_test_open']);

  const already = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => ({ status: 'open', payment_status: 'unpaid', amount_total: 8000, url: openData.payment_url }),
    expireCheckout: async () => 'already_expired',
  });
  assert.deepEqual(already, { action: 'create' });

  const complete = await planInvoicePayLink({
    invoice: { id: 3, status: 'sent', total: 80, amount_paid: 0, invoice_data: openData },
    payAmount: 80,
    loadCheckout: async () => ({ status: 'open', payment_status: 'unpaid', amount_total: 8000, url: openData.payment_url }),
    expireCheckout: async () => 'completed',
  });
  assert.deepEqual(complete, { action: 'skip', reason: INVOICE_CHECKOUT_ALREADY_PAID });

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

test('a stored session is used when the payments table says it was credited', async () => {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.push(`${table}.${column}=${value}`);
              return {
                maybeSingle: async () => ({
                  data: value === 'cs_test_old' ? { outcome: 'credited' } : { outcome: 'overpaid_not_credited' },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const invoice = {
    id: 3,
    status: 'partially_paid',
    total: 1000,
    amount_paid: 300,
    stripe_session_id: 'cs_test_latest',
    invoice_data: openData,
  };
  assert.equal(await checkoutSessionWasCredited(client as never, invoice, 'cs_test_old'), true);
  assert.equal(await checkoutSessionWasCredited(client as never, invoice, 'cs_test_over'), true);
  assert.deepEqual(calls, [
    'service_invoice_stripe_payments.session_id=cs_test_old',
    'service_invoice_stripe_payments.session_id=cs_test_over',
  ]);
  const plan = await planInvoicePayLink({
    invoice: {
      ...invoice,
      invoice_data: {
        ...openData,
        stripe_checkout_session_id: 'cs_test_old',
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_old',
      },
    },
    payAmount: 700,
    loadCheckout: async () => ({ status: 'complete', payment_status: 'paid', amount_total: 30000, url: null }),
    expireCheckout: async () => {
      throw new Error('credited session is not expired');
    },
    isSessionCredited: (sessionId) => checkoutSessionWasCredited(client as never, invoice, sessionId),
  });
  assert.deepEqual(plan, { action: 'create' });
  const overPlan = await planInvoicePayLink({
    invoice: {
      ...invoice,
      invoice_data: {
        ...openData,
        stripe_checkout_session_id: 'cs_test_over',
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_over',
      },
    },
    payAmount: 700,
    loadCheckout: async () => ({ status: 'complete', payment_status: 'paid', amount_total: 58500, url: null }),
    expireCheckout: async () => {
      throw new Error('overpaid session is not expired');
    },
    isSessionCredited: (sessionId) => checkoutSessionWasCredited(client as never, invoice, sessionId),
  });
  assert.deepEqual(overPlan, { action: 'create' });
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
