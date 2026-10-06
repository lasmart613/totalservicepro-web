import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceSessionClaimFilter } from './apply-invoice-payment.ts';
import { applyInvoiceCheckoutSession } from './persist-invoice-payment.ts';

test('invoice session claim filter is null-or-different-session', () => {
  assert.equal(
    invoiceSessionClaimFilter('cs_test_race1'),
    'stripe_session_id.is.null,stripe_session_id.neq.cs_test_race1'
  );
  assert.equal(invoiceSessionClaimFilter('cs test'), null);
});

test('overlapping checkout deliveries credit a session only once', async () => {
  let claimedSession: string | null = null;
  let writes = 0;
  let notes = 0;
  let lastFilter = '';

  const writer = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
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
          op = 'insert';
          if (table === 'notifications') notes += 1;
          return Promise.resolve({ error: null });
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        or(filter: string) {
          if (table === 'service_invoices') lastFilter = filter;
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'service_invoices' && op === 'select') {
            return {
              data: {
                id: '44',
                total: 100,
                status: 'sent',
                amount_paid: 0,
                invoice_number: '1044',
                customer_name: 'Clinic',
                created_by: 'user-1',
                organization_id: 42,
                invoice_data: {},
              },
              error: null,
            };
          }
          if (table === 'service_invoices' && op === 'update') {
            const session = String(payload?.stripe_session_id || '');
            if (claimedSession && claimedSession === session) {
              return { data: null, error: null };
            }
            claimedSession = session;
            writes += 1;
            return { data: { id: filters.id }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };

  const session = {
    id: 'cs_test_race1',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 10000,
    metadata: { kind: 'invoice_pay', invoice_id: '44' },
  };

  const [first, second] = await Promise.all([
    applyInvoiceCheckoutSession({ writer: writer as never, session }),
    applyInvoiceCheckoutSession({ writer: writer as never, session }),
  ]);

  const results = [first, second];
  assert.equal(results.filter((row) => row.ok && row.applied.alreadyApplied).length, 1);
  assert.equal(results.filter((row) => row.ok && !row.applied.alreadyApplied).length, 1);
  const credited = results.find((row) => row.ok && !row.applied.alreadyApplied);
  assert.ok(credited && credited.ok);
  if (credited && credited.ok) assert.equal(credited.applied.amountPaid, 100);
  assert.equal(writes, 1);
  assert.equal(notes, 1);
  assert.equal(claimedSession, 'cs_test_race1');
  assert.equal(lastFilter, invoiceSessionClaimFilter('cs_test_race1'));
});
