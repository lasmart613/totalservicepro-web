import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runConfirmInvoice, GET, POST } from '../../app/api/billing/invoices/confirm/route.ts';
import { applyInvoiceCheckoutSession } from './persist-invoice-payment.ts';

const QA_ORG = 2655;

function memoryInvoice(initial: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    ...initial,
    invoice_data:
      initial.invoice_data && typeof initial.invoice_data === 'object'
        ? { ...(initial.invoice_data as Record<string, unknown>) }
        : initial.invoice_data,
  };
  let creditWrites = 0;
  let notes = 0;
  const writer = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let orFilter = '';
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;
      const api = {
        select() {
          return api;
        },
        update(next: Record<string, unknown>) {
          op = 'update';
          payload = next;
          return api;
        },
        insert() {
          if (table === 'notifications') notes += 1;
          return Promise.resolve({ error: null });
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        or(filter: string) {
          orFilter = filter;
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if (table !== 'service_invoices') return { data: null, error: null };
          if (filters.id != null && String(filters.id) !== String(row.id)) return { data: null, error: null };
          if (op === 'select') {
            return {
              data: {
                ...row,
                invoice_data:
                  row.invoice_data && typeof row.invoice_data === 'object'
                    ? { ...(row.invoice_data as Record<string, unknown>) }
                    : row.invoice_data,
              },
              error: null,
            };
          }
          if (op === 'update') {
            if (orFilter.includes('.is.null') && row.stripe_session_id) return { data: null, error: null };
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'stripe_session_id')) creditWrites += 1;
            Object.assign(row, payload);
            return { data: { id: row.id }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
  return {
    writer,
    get row() {
      return row;
    },
    get creditWrites() {
      return creditWrites;
    },
    get notes() {
      return notes;
    },
  };
}

function invoice() {
  return {
    id: 44,
    total: 100,
    status: 'sent',
    amount_paid: 0,
    invoice_number: '1044',
    customer_name: 'Clinic',
    created_by: 'user-1',
    organization_id: QA_ORG,
    stripe_session_id: null,
    invoice_data: { stripe_checkout_session_id: 'cs_test_open', payment_url: 'https://checkout.stripe.com/c/pay/cs_test_open' },
  };
}

function paidSession(id = 'cs_test_open') {
  return {
    id,
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 10000,
    metadata: { kind: 'invoice_pay', invoice_id: '44' },
    client_reference_id: '44',
  };
}

test('public confirm credits a paid session once and a second confirm is success', async () => {
  const db = memoryInvoice(invoice());
  const retrieve = async () => paidSession();
  const deps = { serviceRole: true, writer: db.writer as never, retrieve: retrieve as never };
  const first = await runConfirmInvoice('cs_test_open', deps);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.alreadyApplied, false);
  assert.equal(firstBody.amountPaid, 100);
  const second = await runConfirmInvoice('cs_test_open', deps);
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.ok, true);
  assert.equal(secondBody.alreadyApplied, true);
  assert.equal(secondBody.amountPaid, 100);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.status, 'paid');
});

test('public confirm does not credit an unpaid session', async () => {
  const db = memoryInvoice(invoice());
  const res = await runConfirmInvoice('cs_test_open', {
    serviceRole: true,
    writer: db.writer as never,
    retrieve: async () => ({ ...paidSession(), status: 'open', payment_status: 'unpaid' }),
  });
  const body = await res.json();
  assert.equal(res.status, 409);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'not_paid');
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 0);
  assert.equal(db.row.amount_paid, 0);
});

test('confirm and webhook racing the same session credit once', async () => {
  const db = memoryInvoice(invoice());
  const session = paidSession('cs_test_race1');
  const [http, direct] = await Promise.all([
    runConfirmInvoice('cs_test_race1', {
      serviceRole: true,
      writer: db.writer as never,
      retrieve: async () => session,
    }),
    applyInvoiceCheckoutSession({ writer: db.writer as never, session }),
  ]);
  const body = await http.json();
  assert.equal(http.status, 200);
  assert.equal(body.ok, true);
  assert.equal(direct.ok, true);
  const applied = [body.alreadyApplied, direct.ok && direct.applied.alreadyApplied];
  assert.equal(applied.filter(Boolean).length, 1);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 100);
  assert.equal(db.row.stripe_session_id, 'cs_test_race1');
});

test('confirm routes require a session id and do not call Stripe without the service role', async () => {
  const missing = await GET(new NextRequest('https://repairplanet.net/api/billing/invoices/confirm'));
  assert.equal(missing.status, 400);
  let retrieved = 0;
  const blocked = await runConfirmInvoice('cs_test_open', {
    serviceRole: false,
    retrieve: async () => {
      retrieved += 1;
      return paidSession();
    },
  });
  assert.equal(blocked.status, 503);
  assert.equal(retrieved, 0);
  const posted = await POST(
    new NextRequest('https://repairplanet.net/api/billing/invoices/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
  );
  assert.equal(posted.status, 400);
});
