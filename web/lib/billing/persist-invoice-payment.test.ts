import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoicePaymentPatch } from './apply-invoice-payment.ts';
import {
  applyInvoiceCheckoutSession,
  INVOICE_PAY_WEBHOOK_STATUS,
  invoiceCheckoutWebhookResult,
  STRIPE_PAYMENT_CONFLICT_KEY,
} from './persist-invoice-payment.ts';
import { buildNewListingInvoicePayload } from './listing-invoice.ts';
import { buildVoidInvoicePatch } from './void-invoice.ts';

const here = dirname(fileURLToPath(import.meta.url));

const QA_ORG = 2655;

function cloneInvoice(row: Record<string, unknown>) {
  const copy = { ...row };
  if (copy.invoice_data && typeof copy.invoice_data === 'object') {
    copy.invoice_data = { ...(copy.invoice_data as Record<string, unknown>) };
  }
  return copy;
}

function orMatches(row: Record<string, unknown>, filter: string): boolean {
  return filter.split(',').some((part) => {
    const [col, op, ...rest] = part.split('.');
    const value = rest.join('.');
    const current = row[col];
    if (op === 'is' && value === 'null') return current == null || current === '';
    if (op === 'eq') return String(current ?? '') === value;
    return false;
  });
}

function memoryInvoice(initial: Record<string, unknown>) {
  const row = cloneInvoice(initial);
  let creditWrites = 0;
  let notes = 0;
  let lastFilter = '';
  let reads = 0;
  const payments = new Map<string, { invoiceId: string; outcome: 'credited' | 'overpaid_not_credited' }>();
  const writer = {
    rpc(_fn: string, args: Record<string, unknown>) {
      const sessionId = String(args.p_session_id || '');
      const amount = Math.round((Number(args.p_amount) || 0) * 100) / 100;
      const invoiceId = String(args.p_invoice_id);
      if (invoiceId !== String(row.id)) {
        return Promise.resolve({ data: { ok: false, reason: 'invoice_not_found' }, error: null });
      }
      const owner = payments.get(sessionId);
      if (owner) {
        if (owner.invoiceId !== invoiceId) {
          return Promise.resolve({ data: { ok: false, reason: 'invoice_mismatch' }, error: null });
        }
        if (owner.outcome === 'overpaid_not_credited') {
          return Promise.resolve({
            data: {
              ok: true,
              claimed: false,
              overpaid: true,
              notify: false,
              reason: 'overpaid_not_credited',
              status: row.status,
              amount_paid: row.amount_paid,
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: { ok: true, claimed: false, status: row.status, amount_paid: row.amount_paid },
          error: null,
        });
      }
      const statusText = String(row.status || '').toLowerCase();
      if (statusText === 'void' || statusText === 'voided') {
        return Promise.resolve({ data: { ok: false, reason: 'invoice_void' }, error: null });
      }
      const total = Math.round((Number(row.total) || 0) * 100) / 100;
      let paid = Math.round((Number(row.amount_paid) || 0) * 100) / 100;
      const deposit = Number((row.invoice_data as { deposit?: number } | null)?.deposit);
      if (!(paid > 0) && deposit > 0) paid = Math.round(deposit * 100) / 100;
      const remaining = Math.round(Math.max(0, total - paid) * 100) / 100;
      if (statusText === 'paid' || (total > 0 && paid + 0.004 >= total)) {
        const data = { ...((row.invoice_data as Record<string, unknown>) || {}) };
        data.stripe_checkout_session_conflict = {
          sessionId,
          creditedSessionId: row.stripe_session_id || null,
        };
        row.invoice_data = data;
        return Promise.resolve({ data: { ok: false, reason: 'different_paid_session' }, error: null });
      }
      if (amount > remaining + 0.01) {
        payments.set(sessionId, { invoiceId, outcome: 'overpaid_not_credited' });
        const data = { ...((row.invoice_data as Record<string, unknown>) || {}) };
        data.stripe_checkout_session_conflict = {
          reason: 'overpaid',
          sessionId,
          amount,
          balanceDue: remaining,
        };
        row.invoice_data = data;
        return Promise.resolve({
          data: {
            ok: true,
            claimed: false,
            overpaid: true,
            notify: true,
            reason: 'overpaid_not_credited',
            status: row.status,
            amount_paid: paid,
            session_amount: amount,
            balance_due: remaining,
          },
          error: null,
        });
      }
      const newPaid = Math.round((paid + amount) * 100) / 100;
      const status = total > 0 && newPaid + 0.004 >= total ? 'paid' : 'partially_paid';
      payments.set(sessionId, { invoiceId, outcome: 'credited' });
      creditWrites += 1;
      row.amount_paid = newPaid;
      row.status = status;
      row.stripe_session_id = sessionId;
      row.invoice_data = { ...((row.invoice_data as Record<string, unknown>) || {}) };
      return Promise.resolve({
        data: { ok: true, claimed: true, status, amount_paid: newPaid },
        error: null,
      });
    },
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
          op = 'insert';
          if (table === 'notifications') notes += 1;
          return Promise.resolve({ error: null });
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        or(filter: string) {
          orFilter = filter;
          if (table === 'service_invoices') lastFilter = filter;
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if (table !== 'service_invoices') return { data: null, error: null };
          const idOk = filters.id == null || String(filters.id) === String(row.id);
          if (!idOk) return { data: null, error: null };
          if (op === 'select') {
            reads += 1;
            return { data: cloneInvoice(row), error: null };
          }
          if (op === 'update') {
            if (orFilter && !orMatches(row, orFilter)) return { data: null, error: null };
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
    get lastFilter() {
      return lastFilter;
    },
    get reads() {
      return reads;
    },
  };
}

function paidSession(id: string, invoiceId: string, amountCents = 10000, extra: Record<string, unknown> = {}) {
  return {
    id,
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    amount_total: amountCents,
    metadata: { kind: 'invoice_pay', invoice_id: invoiceId },
    ...extra,
  };
}

function openInvoice(extra: Record<string, unknown> = {}) {
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
    invoice_data: {
      line_items: [{ description: 'Service' }],
      stripe_checkout_session_id: 'cs_test_open',
      payment_url: 'https://checkout.stripe.com/c/pay/cs_test_open',
      payment_amount: 100,
    },
    ...extra,
  };
}

test('pay after the pay link was sent credits once and notifies the shop', async () => {
  const db = memoryInvoice(openInvoice());
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: paidSession('cs_test_open', '44'),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.applied.alreadyApplied, false);
  assert.equal(result.applied.amountPaid, 100);
  assert.equal(result.applied.status, 'paid');
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.stripe_session_id, 'cs_test_open');
  assert.equal(db.row.status, 'paid');
  assert.equal(db.row.amount_paid, 100);
  const stored = db.row.invoice_data as { line_items?: { description: string }[] };
  assert.deepEqual(stored.line_items, [{ description: 'Service' }]);
});

test('a duplicate webhook for the same session is a no-op success', async () => {
  const db = memoryInvoice(openInvoice());
  const session = paidSession('cs_test_open', '44');
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  const second = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok && !first.applied.alreadyApplied, true);
  assert.equal(second.ok && second.applied.alreadyApplied, true);
  if (second.ok) assert.equal(second.applied.amountPaid, 100);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 100);
});

test('a webhook and confirm race for the same session credits once', async () => {
  const db = memoryInvoice(openInvoice());
  const session = paidSession('cs_test_race1', '44');
  const [first, second] = await Promise.all([
    applyInvoiceCheckoutSession({ writer: db.writer as never, session }),
    applyInvoiceCheckoutSession({ writer: db.writer as never, session }),
  ]);
  const results = [first, second];
  assert.equal(results.filter((row) => row.ok && row.applied.alreadyApplied).length, 1);
  assert.equal(results.filter((row) => row.ok && !row.applied.alreadyApplied).length, 1);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.stripe_session_id, 'cs_test_race1');
  assert.equal(db.row.amount_paid, 100);
});

test('replaying earlier sessions does not credit them again', async () => {
  const db = memoryInvoice(openInvoice({ total: 1000, amount_paid: 0, status: 'sent' }));
  const a = paidSession('cs_test_a', '44', 30000);
  const b = paidSession('cs_test_b', '44', 30000);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session: a });
  const second = await applyInvoiceCheckoutSession({ writer: db.writer as never, session: b });
  const replayA = await applyInvoiceCheckoutSession({ writer: db.writer as never, session: a });
  const replayB = await applyInvoiceCheckoutSession({ writer: db.writer as never, session: b });
  assert.equal(first.ok && first.applied.amountPaid, 300);
  assert.equal(second.ok && second.applied.amountPaid, 600);
  assert.equal(replayA.ok && replayA.applied.alreadyApplied, true);
  assert.equal(replayB.ok && replayB.applied.alreadyApplied, true);
  if (replayB.ok) assert.equal(replayB.applied.amountPaid, 600);
  assert.equal(db.row.amount_paid, 600);
  assert.equal(db.row.status, 'partially_paid');
  assert.equal(db.creditWrites, 2);
  assert.equal(db.notes, 2);
});

test('a $585 Checkout after a $100 cash payment is recorded once and not credited', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 585,
      amount_paid: 100,
      status: 'partially_paid',
      invoice_data: {
        line_items: [{ description: 'Service' }],
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_585',
        stripe_checkout_session_id: 'cs_test_585',
      },
    })
  );
  const session = paidSession('cs_test_585', '44', 58500);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  const replay = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok, false);
  assert.equal(replay.ok, false);
  if (!first.ok) assert.equal(first.reason, 'overpaid_not_credited');
  if (!replay.ok) assert.equal(replay.reason, 'overpaid_not_credited');
  assert.equal(db.row.amount_paid, 100);
  assert.equal(db.row.status, 'partially_paid');
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 1);
  const conflict = (db.row.invoice_data as { stripe_checkout_session_conflict?: Record<string, unknown> })
    .stripe_checkout_session_conflict;
  assert.equal(conflict?.reason, 'overpaid');
  assert.equal(conflict?.sessionId, 'cs_test_585');
  assert.equal(conflict?.amount, 585);
  assert.equal(conflict?.balanceDue, 485);
  assert.deepEqual((db.row.invoice_data as { line_items?: unknown }).line_items, [{ description: 'Service' }]);
});

test('replaying an older larger session records the overpayment once and does not credit', async () => {
  const db = memoryInvoice(openInvoice({ total: 1175, amount_paid: 400, status: 'partially_paid' }));
  const session = paidSession('cs_test_1175', '44', 117500);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  const replay = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok, false);
  assert.equal(replay.ok, false);
  if (!first.ok) assert.equal(first.reason, 'overpaid_not_credited');
  assert.equal(db.row.amount_paid, 400);
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 1);
});

test('a different session on an already-paid invoice does not credit again', async () => {
  const db = memoryInvoice(
    openInvoice({
      status: 'paid',
      amount_paid: 100,
      stripe_session_id: 'cs_test_first',
    })
  );
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '));
  };
  try {
    const result = await applyInvoiceCheckoutSession({
      writer: db.writer as never,
      session: paidSession('cs_test_second', '44'),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'different_paid_session');
  } finally {
    console.warn = original;
  }
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 0);
  assert.equal(db.row.amount_paid, 100);
  assert.equal(db.row.stripe_session_id, 'cs_test_first');
  assert.equal(db.row.status, 'paid');
  const data = db.row.invoice_data as Record<string, unknown>;
  const conflict = data[STRIPE_PAYMENT_CONFLICT_KEY] as { sessionId?: string; creditedSessionId?: string };
  assert.equal(conflict.sessionId, 'cs_test_second');
  assert.equal(conflict.creditedSessionId, 'cs_test_first');
  assert.equal(warnings.some((line) => /different session/.test(line)), true);
});

test('a later session can still pay a remaining balance exactly once', async () => {
  const db = memoryInvoice(
    openInvoice({
      status: 'partially_paid',
      amount_paid: 40,
      stripe_session_id: 'cs_test_deposit',
      invoice_data: { deposit: 40 },
    })
  );
  const session = paidSession('cs_test_balance', '44', 6000);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  const second = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok && !first.applied.alreadyApplied, true);
  if (first.ok) assert.equal(first.applied.amountPaid, 100);
  assert.equal(second.ok && second.applied.alreadyApplied, true);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 100);
  assert.equal(db.row.stripe_session_id, 'cs_test_balance');
});

test('an unpaid or expired Checkout session never credits', async () => {
  const unpaid = memoryInvoice(openInvoice());
  const unpaidResult = await applyInvoiceCheckoutSession({
    writer: unpaid.writer as never,
    session: { ...paidSession('cs_test_open', '44'), status: 'open', payment_status: 'unpaid' },
  });
  assert.equal(unpaidResult.ok, false);
  if (!unpaidResult.ok) assert.equal(unpaidResult.reason, 'not_paid');
  assert.equal(unpaid.creditWrites, 0);
  assert.equal(unpaid.notes, 0);

  const expired = memoryInvoice(openInvoice());
  const expiredResult = await applyInvoiceCheckoutSession({
    writer: expired.writer as never,
    session: { ...paidSession('cs_test_open', '44'), status: 'expired', payment_status: 'unpaid' },
  });
  assert.equal(expiredResult.ok, false);
  if (!expiredResult.ok) assert.equal(expiredResult.reason, 'not_paid');
  assert.equal(expired.creditWrites, 0);

  const free = memoryInvoice(openInvoice());
  const freeResult = await applyInvoiceCheckoutSession({
    writer: free.writer as never,
    session: { ...paidSession('cs_test_open', '44'), payment_status: 'no_payment_required' },
  });
  assert.equal(freeResult.ok, false);
  if (!freeResult.ok) assert.equal(freeResult.reason, 'not_paid');
  assert.equal(free.creditWrites, 0);
  assert.equal(free.row.amount_paid, 0);
});

test('a session for another invoice never credits this invoice', async () => {
  const mismatch = memoryInvoice(openInvoice());
  const mismatchResult = await applyInvoiceCheckoutSession({
    writer: mismatch.writer as never,
    session: { ...paidSession('cs_test_other', '44'), client_reference_id: '99' },
  });
  assert.equal(mismatchResult.ok, false);
  if (!mismatchResult.ok) assert.equal(mismatchResult.reason, 'invoice_mismatch');
  assert.equal(mismatch.reads, 0);
  assert.equal(mismatch.creditWrites, 0);
  assert.equal(mismatch.row.amount_paid, 0);
  assert.equal(mismatch.row.stripe_session_id, null);

  const other = memoryInvoice(openInvoice());
  const otherResult = await applyInvoiceCheckoutSession({
    writer: other.writer as never,
    session: paidSession('cs_test_other', '99'),
  });
  assert.equal(otherResult.ok, false);
  if (!otherResult.ok) assert.equal(otherResult.reason, 'invoice_not_found');
  assert.equal(other.creditWrites, 0);
  assert.equal(other.row.id, 44);
  assert.equal(other.row.amount_paid, 0);
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
  assert.match(claim, /apply_service_invoice_stripe_payment/);
  const webhook = readFileSync(join(here, '../../app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  const confirm = readFileSync(join(here, '../../app/api/billing/invoices/confirm/route.ts'), 'utf8');
  assert.match(webhook, /getSupabaseAdmin\(\)/);
  assert.match(webhook, /applyInvoiceCheckoutSession\(\{\s*writer,/);
  assert.match(webhook, /invoiceCheckoutWebhookResult/);
  assert.match(confirm, /hasServiceRole\(\)/);
  assert.match(confirm, /deps\.writer \?\? getSupabaseAdmin\(\)/);
  assert.doesNotMatch(confirm, /from\('service_invoices'\)/);
  const applySrc = readFileSync(join(here, 'apply-invoice-payment.ts'), 'utf8');
  const already = applySrc.slice(
    applySrc.indexOf('export function alreadyAppliedSession'),
    applySrc.indexOf('export function invoiceFullyPaid')
  );
  assert.doesNotMatch(already, /stripe_checkout_session_id/);
  for (const [reason, status] of Object.entries(INVOICE_PAY_WEBHOOK_STATUS)) {
    assert.equal(invoiceCheckoutWebhookResult(reason)?.status, status, reason);
  }
  assert.equal(invoiceCheckoutWebhookResult('not_invoice_checkout'), null);
  assert.equal(invoiceCheckoutWebhookResult('unexpected_permanent')?.status, 200);
});
