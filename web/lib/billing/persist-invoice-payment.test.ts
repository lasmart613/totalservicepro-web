import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoicePaymentPatch, invoiceSessionClaimFilter } from './apply-invoice-payment.ts';
import { applyInvoiceCheckoutSession } from './persist-invoice-payment.ts';
import { buildNewListingInvoicePayload } from './listing-invoice.ts';
import { buildVoidInvoicePatch } from './void-invoice.ts';

const here = dirname(fileURLToPath(import.meta.url));

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

test('000803 guards stripe_session_id and client invoice edits leave it unchanged', () => {
  const sql = readFileSync(
    join(here, '../../supabase/migrations/20261006_000803_service_invoice_stripe_session_claim.sql'),
    'utf8'
  );
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  assert.doesNotMatch(sql, /guard_tenant_owner_cols\s*\(/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.guard_tenant_owner_cols/);

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.service_invoices_guard_stripe_session\(\)/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  assert.match(sql, /IF TG_OP = 'INSERT' THEN/);
  assert.match(sql, /IF NEW\.stripe_session_id IS NOT NULL THEN/);
  assert.match(sql, /RAISE EXCEPTION 'stripe_session_id cannot be set by the client'/);
  assert.match(sql, /IF NEW\.stripe_session_id IS DISTINCT FROM OLD\.stripe_session_id THEN/);
  assert.match(sql, /RAISE EXCEPTION 'stripe_session_id cannot be changed by the client'/);
  assert.match(sql, /DROP TRIGGER IF EXISTS service_invoices_guard_stripe_session ON public\.service_invoices/);
  assert.match(
    sql,
    /CREATE TRIGGER service_invoices_guard_stripe_session\s+BEFORE INSERT OR UPDATE ON public\.service_invoices/
  );
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.service_invoices_guard_stripe_session\(\) FROM PUBLIC, anon, authenticated/
  );

  const patch = buildInvoicePaymentPatch({
    invoice: { id: 9, total: 40, amount_paid: 0, invoice_data: {} },
    addAmount: 10,
    method: 'Check',
  });
  assert.equal('stripe_session_id' in patch, false);
  const voided = buildVoidInvoicePatch({ invoice: { invoice_data: {} }, reason: 'duplicate' });
  assert.equal('stripe_session_id' in voided, false);
  const created = buildNewListingInvoicePayload({
    orgId: 4,
    userId: 'user-1',
    customer: { id: 8, name: 'Clinic' },
    listing: { id: 'listing-1', title: 'Tip', price: 12 },
    qty: 1,
    invoiceNumber: 'INV-1',
  });
  assert.equal('stripe_session_id' in created, false);

  const writers = [
    '../../app/invoices/page.tsx',
    '../../app/invoices/new/InvoiceFormClient.tsx',
    '../../app/api/billing/send-invoice/route.ts',
    '../../app/api/billing/invoices/void/route.ts',
    '../../app/api/billing/listing-invoice/route.ts',
    '../../components/marketplace/AddListingToInvoice.tsx',
  ].map((rel) => readFileSync(join(here, rel), 'utf8'));
  for (const src of writers) {
    assert.doesNotMatch(src, /stripe_session_id/);
  }

  const claim = readFileSync(join(here, 'persist-invoice-payment.ts'), 'utf8');
  assert.match(claim, /stripe_session_id: sessionId/);
  const webhook = readFileSync(join(here, '../../app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  const confirm = readFileSync(join(here, '../../app/api/billing/invoices/confirm/route.ts'), 'utf8');
  assert.match(webhook, /getSupabaseAdmin\(\)/);
  assert.match(webhook, /applyInvoiceCheckoutSession\(\{\s*writer,/);
  assert.match(confirm, /hasServiceRole\(\)/);
  assert.match(confirm, /writer: getSupabaseAdmin\(\)/);
  assert.doesNotMatch(confirm, /from\('service_invoices'\)/);
});
