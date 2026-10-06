import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleFinancialReport, invoiceColumnFlags } from '../financial-reporting.ts';
import {
  buildVoidInvoicePatch,
  canVoidInvoice,
  classifyCheckoutExpire,
  flagVoidInvoicePayment,
  invoiceAcceptsPayment,
  isVoidInvoiceStatus,
  VOIDED_INVOICE_MESSAGE,
} from './void-invoice.ts';
import { buildInvoicePaymentPatch } from './apply-invoice-payment.ts';

const columns = invoiceColumnFlags(
  'id, invoice_number, status, customer_name, total, tax, amount_paid, paid_at, payment_method, invoice_date, due_date, invoice_data'
);

test('only an admin can void a draft or sent invoice that has no payment', () => {
  assert.deepEqual(canVoidInvoice({ status: 'sent', amount_paid: 0, role: 'company_admin' }), { ok: true });
  assert.deepEqual(canVoidInvoice({ status: 'draft', amount_paid: 0, role: 'owner' }), { ok: true });
  assert.equal(canVoidInvoice({ status: 'sent', amount_paid: 0, role: 'fse' }).ok, false);
  assert.equal(canVoidInvoice({ status: 'paid', amount_paid: 0, role: 'admin' }).ok, false);
  assert.equal(canVoidInvoice({ status: 'partially_paid', amount_paid: 10, role: 'admin' }).ok, false);
  assert.equal(
    canVoidInvoice({ status: 'sent', amount_paid: 0, invoice_data: { deposit: 25 }, role: 'admin' }).ok,
    false
  );
  assert.equal(canVoidInvoice({ status: 'cancelled', amount_paid: 0, role: 'admin' }).ok, false);
});

test('void patch clears the pay link and keeps an optional reason', () => {
  const patch = buildVoidInvoicePatch({
    invoice: { invoice_data: { stripe_checkout_session_id: 'cs_live_1', payment_url: 'https://checkout.stripe.com/c/pay/cs_live_1' } },
    reason: '  Customer cancelled  ',
    now: new Date('2026-10-05T17:00:00Z'),
    expiredSessionIds: ['cs_live_1'],
  });
  assert.equal(patch.status, 'void');
  assert.equal(patch.void_reason, 'Customer cancelled');
  assert.equal(patch.voided_at, '2026-10-05T17:00:00.000Z');
  assert.equal(patch.invoice_data.payment_url, null);
  assert.equal(patch.invoice_data.stripe_checkout_session_id, 'cs_live_1');
  assert.deepEqual(patch.invoice_data.stripe_checkout_expired_ids, ['cs_live_1']);
});

test('a void invoice rejects payment and a late checkout is flagged without changing the amount', () => {
  assert.equal(invoiceAcceptsPayment('void'), false);
  assert.equal(isVoidInvoiceStatus('Voided'), true);
  assert.equal(VOIDED_INVOICE_MESSAGE, 'This invoice was voided');
  const flagged = flagVoidInvoicePayment(
    { stripe_checkout_session_id: 'cs_late' },
    { sessionId: 'cs_late', amount: 50, at: '2026-10-05T18:00:00.000Z' }
  );
  assert.equal(flagged.void_payment_ignored, true);
  assert.equal((flagged.void_payment_attempts as { amount: number }[])[0].amount, 50);
  assert.throws(
    () =>
      buildInvoicePaymentPatch({
        invoice: { id: 9, status: 'void', total: 80, amount_paid: 0 },
        addAmount: 80,
        method: 'Stripe',
        sessionId: 'cs_late',
      }),
    /voided/
  );
});

test('Stripe expire treats an open session as expired and a completed session as not voidable', () => {
  assert.equal(classifyCheckoutExpire(200, { id: 'cs_1', status: 'expired' }), 'expired');
  assert.equal(
    classifyCheckoutExpire(400, { error: { message: 'This Checkout Session has a status of expired.' } }),
    'already_expired'
  );
  assert.equal(
    classifyCheckoutExpire(400, { error: { message: 'This Checkout Session has a status of complete.' } }),
    'completed'
  );
  assert.equal(classifyCheckoutExpire(500, { error: { message: 'Stripe is down' } }), 'failed');
});

test('void invoices are left out of outstanding, billed income, and revenue KPIs', () => {
  const report = assembleFinancialReport({
    organizationId: 1,
    timeZone: 'America/Los_Angeles',
    asOf: new Date('2026-10-05T17:00:00Z'),
    invoiceColumns: columns,
    invoices: [
      {
        id: 1,
        invoice_number: 'INV-OPEN',
        status: 'sent',
        customer_name: 'Clinic',
        total: 100,
        amount_paid: 0,
        invoice_date: '2026-10-05',
        due_date: '2026-10-20',
      },
      {
        id: 2,
        invoice_number: 'INV-VOID',
        status: 'void',
        customer_name: 'Clinic',
        total: 400,
        amount_paid: 0,
        invoice_date: '2026-10-05',
        due_date: '2026-10-01',
      },
      {
        id: 3,
        invoice_number: 'INV-VOID-DRAFT',
        status: 'void',
        customer_name: 'Clinic',
        total: 50,
        amount_paid: 0,
        invoice_date: '2026-10-05',
      },
    ],
    purchaseOrders: [],
    estimates: [],
  });
  const metric = (id: string) => report.metrics.find((row) => row.id === id);
  assert.equal(metric('billed_income')?.amount, 100);
  assert.equal(metric('outstanding_balance')?.amount, 100);
  assert.equal(metric('draft_invoices')?.amount, 0);
  assert.equal(report.summary.kpis.find((row) => row.id === 'outstanding_invoices')?.amount, 100);
  assert.equal(report.summary.kpis.find((row) => row.id === 'revenue_this_month')?.amount, 100);
  assert.equal(report.outstanding.map((row) => row.number).join(','), 'INV-OPEN');
  assert.equal(
    report.metrics.some((row) => row.source.includes('service_invoices.')),
    false
  );
});
