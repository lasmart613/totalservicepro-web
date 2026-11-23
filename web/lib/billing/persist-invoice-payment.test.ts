import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoicePaymentPatch } from './apply-invoice-payment.ts';
import {
  applyInvoiceCheckoutSession,
  INVOICE_NOTIFICATION_TYPE,
  INVOICE_PAY_WEBHOOK_STATUS,
  NOTIFICATION_TYPE_ALLOWLIST,
  invoiceCheckoutWebhookResult,
  notifyShopOfPayment,
  STRIPE_PAYMENT_CONFLICT_KEY,
} from './persist-invoice-payment.ts';
import { buildNewListingInvoicePayload } from './listing-invoice.ts';
import { buildVoidInvoicePatch } from './void-invoice.ts';
import { runConfirmInvoice } from '../../app/api/billing/invoices/confirm/route.ts';

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

function memoryInvoice(initial: Record<string, unknown>, options: { failPaymentInserts?: number } = {}) {
  const row = cloneInvoice(initial);
  let creditWrites = 0;
  let notes = 0;
  let paymentInsertFailures = options.failPaymentInserts ?? 0;
  let lastFilter = '';
  let reads = 0;
  const payments = new Map<
    string,
    { invoiceId: string; outcome: 'credited' | 'overpaid_not_credited' | 'possibly_already_credited' | 'charge_mismatch' }
  >();
  const messages: string[] = [];
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
        if (owner.outcome === 'overpaid_not_credited' || owner.outcome === 'possibly_already_credited') {
          return Promise.resolve({
            data: {
              ok: true,
              claimed: false,
              overpaid: owner.outcome === 'overpaid_not_credited',
              notify: false,
              reason: owner.outcome,
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
        const existing = data.stripe_checkout_session_conflict;
        const list = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
        const seen = list.some(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            (entry as { sessionId?: string; reason?: string }).sessionId === sessionId &&
            (entry as { reason?: string }).reason === 'different_paid_session'
        );
        if (!seen) {
          list.push({
            reason: 'different_paid_session',
            sessionId,
            creditedSessionId: row.stripe_session_id || null,
          });
          data.stripe_checkout_session_conflict = list;
          row.invoice_data = data;
        }
        return Promise.resolve({
          data: {
            ok: false,
            reason: 'different_paid_session',
            notify: !seen,
            session_amount: amount,
          },
          error: null,
        });
      }
      if (amount > remaining + 0.01) {
        const prior = { ...((row.invoice_data as Record<string, unknown>) || {}) };
        const ids = Array.isArray(prior.stripe_checkout_session_ids)
          ? prior.stripe_checkout_session_ids.map(String)
          : [];
        const known = String(row.stripe_session_id || '') === sessionId || ids.includes(sessionId);
        const outcome = known ? 'possibly_already_credited' : 'overpaid_not_credited';
        const reason = known ? 'verify' : 'overpaid';
        payments.set(sessionId, { invoiceId, outcome });
        const existing = prior.stripe_checkout_session_conflict;
        const list = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
        list.push({ reason, sessionId, amount, balanceDue: remaining });
        prior.stripe_checkout_session_conflict = list;
        row.invoice_data = prior;
        return Promise.resolve({
          data: {
            ok: true,
            claimed: false,
            overpaid: !known,
            notify: true,
            reason: known ? 'possibly_already_credited' : 'overpaid_not_credited',
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
        insert(next?: Record<string, unknown>) {
          op = 'insert';
          if (table === 'notifications') {
            notes += 1;
            if (next?.message) messages.push(String(next.message));
          }
          if (table === 'service_invoice_stripe_payments' && paymentInsertFailures > 0) {
            paymentInsertFailures -= 1;
            return Promise.resolve({ error: { message: 'connection terminated unexpectedly' } });
          }
          if (table === 'service_invoice_stripe_payments' && next?.session_id) {
            const outcome = String(next.outcome || 'credited');
            if (
              outcome === 'credited' ||
              outcome === 'overpaid_not_credited' ||
              outcome === 'possibly_already_credited' ||
              outcome === 'charge_mismatch'
            ) {
              payments.set(String(next.session_id), {
                invoiceId: String(next.invoice_id),
                outcome,
              });
            }
          }
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
        in() {
          return api;
        },
        order() {
          return api;
        },
        limit() {
          if (table === 'organization_memberships') {
            return Promise.resolve({ data: [{ user_id: 'admin-1', role: 'admin' }], error: null });
          }
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            return {
              data: { id: row.organization_id, currency_code: row.currency_code ?? null },
              error: null,
            };
          }
          if (table === 'service_invoice_stripe_payments') {
            const payment = payments.get(String(filters.session_id || ''));
            if (!payment) return { data: null, error: null };
            return { data: { invoice_id: payment.invoiceId, outcome: payment.outcome }, error: null };
          }
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
    get messages() {
      return messages;
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
  const conflict = (db.row.invoice_data as { stripe_checkout_session_conflict?: Record<string, unknown>[] })
    .stripe_checkout_session_conflict;
  assert.equal(conflict?.[0]?.reason, 'overpaid');
  assert.equal(conflict?.[0]?.sessionId, 'cs_test_585');
  assert.equal(conflict?.[0]?.amount, 585);
  assert.equal(conflict?.[0]?.balanceDue, 485);
  assert.deepEqual((db.row.invoice_data as { line_items?: unknown }).line_items, [{ description: 'Service' }]);
});

test('a replay of a session stored before the payments table is not an overpayment alert', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 1760,
      amount_paid: 1275,
      status: 'partially_paid',
      stripe_session_id: 'cs_test_1175',
      invoice_data: {
        line_items: [{ description: 'Service' }],
        stripe_checkout_session_id: 'cs_test_1175',
        stripe_checkout_session_ids: ['cs_test_1175'],
      },
    })
  );
  const session = paidSession('cs_test_1175', '44', 117500);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  const replay = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok, false);
  assert.equal(replay.ok, false);
  if (!first.ok) assert.equal(first.reason, 'possibly_already_credited');
  if (!replay.ok) assert.equal(replay.reason, 'possibly_already_credited');
  assert.equal(db.row.amount_paid, 1275);
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 1);
  const conflict = (db.row.invoice_data as { stripe_checkout_session_conflict?: { reason?: string }[] })
    .stripe_checkout_session_conflict;
  assert.equal(conflict?.[0]?.reason, 'verify');
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
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 100);
  assert.equal(db.row.stripe_session_id, 'cs_test_first');
  assert.equal(db.row.status, 'paid');
  const data = db.row.invoice_data as Record<string, unknown>;
  const conflict = data[STRIPE_PAYMENT_CONFLICT_KEY] as { sessionId?: string; creditedSessionId?: string }[];
  assert.equal(conflict[0].sessionId, 'cs_test_second');
  assert.equal(conflict[0].creditedSessionId, 'cs_test_first');
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
  if (!freeResult.ok) assert.equal(freeResult.reason, 'no_payment_required');
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
  assert.equal(invoiceCheckoutWebhookResult('unexpected_reason')?.status, 500);
  assert.equal(invoiceCheckoutWebhookResult('canceling statement due to lock timeout')?.status, 500);
  assert.equal(invoiceCheckoutWebhookResult('connection terminated unexpectedly')?.status, 500);
});

test('raw database errors stay retryable', async () => {
  const session = paidSession('cs_test_lock', '44', 10000);
  const invoice = openInvoice();
  async function fail(message: string) {
    const writer = {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () =>
            message.startsWith('load')
              ? { data: null, error: { message } }
              : { data: invoice, error: null },
          rpc: async () => ({ data: null, error: { message } }),
        };
      },
      rpc: async () => ({ data: null, error: { message } }),
    };
    return applyInvoiceCheckoutSession({ writer: writer as never, session });
  }
  const locked = await fail('canceling statement due to lock timeout');
  const dropped = await fail('connection terminated unexpectedly');
  const loaded = await fail('load invoice: connection terminated');
  assert.equal(locked.ok, false);
  assert.equal(dropped.ok, false);
  assert.equal(loaded.ok, false);
  if (!locked.ok) assert.equal(locked.reason, 'update_failed');
  if (!dropped.ok) assert.equal(dropped.reason, 'update_failed');
  if (!loaded.ok) assert.equal(loaded.reason, 'load_failed');
  for (const reason of ['update_failed', 'load_failed', 'canceling statement due to lock timeout']) {
    assert.equal(invoiceCheckoutWebhookResult(reason)?.status, 500);
  }
  assert.equal(invoiceCheckoutWebhookResult('not_paid')?.status, 200);
});

test('shop payment notices use the production notification allowlist', async () => {
  const inserted: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const writer = {
    from(table: string) {
      tables.push(table);
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        or() {
          return this;
        },
        order() {
          return this;
        },
        limit: async () => ({
          data:
            table === 'organization_memberships'
              ? [
                  { user_id: 'user-b', role: 'owner' },
                  { user_id: 'user-a', role: 'admin' },
                  { user_id: 'user-c', role: 'fse' },
                ]
              : [],
          error: null,
        }),
        insert(row: Record<string, unknown>) {
          if (table === 'notifications') {
            if (row.type === 'blocked') {
              return Promise.resolve({ error: { message: 'notifications_type_check' } });
            }
            inserted.push(row);
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const invoice = {
    id: 44,
    invoice_number: '1044',
    customer_name: 'Clinic',
    created_by: 'former-member',
    organization_id: 2655,
    total: 1000,
  };
  await notifyShopOfPayment(writer as never, invoice, 'partially_paid', 300, 'payment', 0, { paid: 600, total: 1000 });
  await notifyShopOfPayment(writer as never, invoice, 'partially_paid', 585, 'overpaid', 485);
  await notifyShopOfPayment(writer as never, invoice, 'paid', 800, 'verify');
  await notifyShopOfPayment(writer as never, invoice, 'sent', 80, 'charge_mismatch');
  assert.equal(tables.includes('user_profiles'), false);
  assert.equal(tables.includes('organization_memberships'), true);
  assert.deepEqual(
    inserted.map((row) => row.user_id),
    ['user-a', 'user-b', 'user-a', 'user-b', 'user-a', 'user-b', 'user-a', 'user-b']
  );
  assert.equal(inserted[0].type, 'general');
  assert.match(String(inserted[0].message), /^\$300\.00 payment received on invoice 1044 \(\$600\.00 of \$1,000\.00 paid\)/);
  assert.match(String(inserted[2].message), /^Overpayment on invoice 1044 needs a manual refund/);
  assert.equal(String(inserted[4].message), 'Check Stripe: invoice 1044 may have been paid twice.');
  assert.equal(
    String(inserted[6].message),
    "Invoice 1044: A payment came in that doesn't match this invoice's amount or currency. We didn't apply it. Please check it in Stripe before crediting the invoice."
  );
  assert.equal(inserted[0].link, '/invoices/new?id=44');
  for (const row of inserted) {
    assert.equal(NOTIFICATION_TYPE_ALLOWLIST.includes(row.type as (typeof NOTIFICATION_TYPE_ALLOWLIST)[number]), true);
    assert.equal(row.type, INVOICE_NOTIFICATION_TYPE);
    assert.notEqual(row.user_id, 'former-member');
    assert.notEqual(row.user_id, 'user-c');
  }
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  const failing = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        or() {
          return this;
        },
        order() {
          return this;
        },
        limit: async () => ({ data: [{ user_id: 'user-a', role: 'admin' }], error: null }),
        insert: async () => ({ error: { message: 'notifications_type_check' } }),
      };
    },
  };
  await notifyShopOfPayment(failing as never, invoice, 'paid', 10);
  console.warn = original;
  assert.equal(warnings.some((line) => /notifications_type_check/.test(line)), true);
});

function chargedSession(id: string, invoiceId: string, currency: string, minor: number) {
  return paidSession(id, invoiceId, minor, {
    currency,
    metadata: {
      kind: 'invoice_pay',
      invoice_id: invoiceId,
      charge_currency: currency,
      charge_amount_minor: String(minor),
    },
  });
}

function withErrors<T>(run: () => Promise<T>): Promise<{ result: T; reasons: string[] }> {
  const reasons: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const detail = args.find((arg) => arg && typeof arg === 'object') as { reason?: string } | undefined;
    if (detail?.reason) reasons.push(String(detail.reason));
  };
  return run()
    .then((result) => ({ result, reasons }))
    .finally(() => {
      console.error = original;
    });
}

test('cash recorded after the link is reviewed as an overpayment, not left unpaid', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 100,
      amount_paid: 40,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 10000, payment_amount: 100 },
    })
  );
  const { result, reasons } = await withErrors(() =>
    applyInvoiceCheckoutSession({
      writer: db.writer as never,
      session: chargedSession('cs_test_cash', '44', 'usd', 10000),
    })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'overpaid_not_credited');
  assert.deepEqual(reasons, []);
  assert.equal(db.row.amount_paid, 40);
});

test('a deposit link still credits after the balance is released', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 1555,
      amount_paid: 0,
      status: 'sent',
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 65000, payment_amount: 650, deferredReleased: true },
    })
  );
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: chargedSession('cs_test_deposit', '44', 'usd', 65000),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.applied.alreadyApplied, false);
    assert.equal(result.applied.amountPaid, 650);
    assert.equal(result.applied.status, 'partially_paid');
  }
});

test('an organization currency change does not reject the stored charge currency', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 80,
      amount_paid: 0,
      invoice_data: { payment_currency: 'eur', payment_amount_minor: 8000, payment_amount: 80 },
    })
  );
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: chargedSession('cs_test_eur', '44', 'eur', 8000),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.applied.amountPaid, 80);
  assert.equal(db.creditWrites, 1);
});

test('session metadata is trusted when invoice_data disagrees', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 100,
      amount_paid: 0,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 5000, payment_amount: 50 },
    })
  );
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: chargedSession('cs_test_meta_wins', '44', 'usd', 10000),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.applied.amountPaid, 100);
  assert.equal(db.creditWrites, 1);
  assert.equal(db.row.amount_paid, 100);
});

test('a re-issued link uses the new session metadata, not the previous invoice_data amount', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 200,
      amount_paid: 0,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 10000, payment_amount: 100 },
    })
  );
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: chargedSession('cs_test_reissue', '44', 'usd', 20000),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.applied.amountPaid, 200);
});

test('a currency mismatch against the stored charge is logged, notified, and recorded', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 80,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 8000, payment_amount: 80 },
    })
  );
  const session = chargedSession('cs_test_mismatch', '44', 'eur', 8000);
  session.currency = 'usd';
  const { result, reasons } = await withErrors(() =>
    applyInvoiceCheckoutSession({
      writer: db.writer as never,
      session,
    })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'currency_mismatch');
  assert.deepEqual(reasons, ['currency_mismatch']);
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 0);
  const list = (db.row.invoice_data as { stripe_checkout_session_conflict?: { reason?: string }[] })
    .stripe_checkout_session_conflict;
  assert.equal(list?.[0]?.reason, 'currency_mismatch');
  assert.match(db.messages[0] || '', /doesn't match this invoice's amount or currency/);
  assert.doesNotMatch(db.messages[0] || '', /paid twice/);
  const again = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session,
  });
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, 'charge_mismatch');
  assert.equal(db.notes, 1);
});

test('a payments insert failure still records the mismatch and notifies on retry', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 80,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 8000, payment_amount: 80 },
    }),
    { failPaymentInserts: 1 }
  );
  const session = chargedSession('cs_test_retry', '44', 'eur', 8000);
  session.currency = 'usd';
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.reason, 'update_failed');
  assert.equal(invoiceCheckoutWebhookResult('update_failed')?.status, 500);
  assert.equal(db.notes, 0);
  assert.equal(db.creditWrites, 0);
  const conflicts = (db.row.invoice_data as { stripe_checkout_session_conflict?: { reason?: string }[] })
    .stripe_checkout_session_conflict;
  assert.equal(conflicts?.length, 1);
  const second = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'currency_mismatch');
  assert.equal(db.notes, 1);
  const conflictsAfter = (db.row.invoice_data as { stripe_checkout_session_conflict?: unknown[] })
    .stripe_checkout_session_conflict;
  assert.equal(conflictsAfter?.length, 1);
  assert.match(db.messages[0] || '', /doesn't match this invoice's amount or currency/);
  assert.doesNotMatch(db.messages[0] || '', /paid twice/);
  const third = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.reason, 'charge_mismatch');
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 0);
});

test('an amount mismatch is labelled amount_mismatch and notifies the shop', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 100,
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 10000, payment_amount: 100 },
    })
  );
  const session = chargedSession('cs_test_amount', '44', 'usd', 10000);
  session.amount_total = 5000;
  const { result, reasons } = await withErrors(() =>
    applyInvoiceCheckoutSession({ writer: db.writer as never, session })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'amount_mismatch');
  assert.deepEqual(reasons, ['amount_mismatch']);
  assert.equal(db.notes, 1);
  assert.equal(db.creditWrites, 0);
  const list = (db.row.invoice_data as { stripe_checkout_session_conflict?: { reason?: string }[] })
    .stripe_checkout_session_conflict;
  assert.equal(list?.[0]?.reason, 'amount_mismatch');
  assert.match(db.messages[0] || '', /doesn't match this invoice's amount or currency/);
  assert.doesNotMatch(db.messages[0] || '', /paid twice/);
});

test('a legacy session with no stored charge must match the organization currency', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 100,
      currency_code: 'USD',
      invoice_data: { line_items: [{ description: 'Service' }] },
    })
  );
  const { result, reasons } = await withErrors(() =>
    applyInvoiceCheckoutSession({
      writer: db.writer as never,
      session: paidSession('cs_test_legacy_eur', '44', 10000, {
        currency: 'eur',
        metadata: { kind: 'invoice_pay', invoice_id: '44' },
      }),
    })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'currency_mismatch');
  assert.deepEqual(reasons, ['currency_mismatch']);
  assert.equal(db.creditWrites, 0);
  assert.equal(db.notes, 1);
  assert.equal(db.row.amount_paid, 0);
});

test('a KWD charge credits the 3-decimal major amount', async () => {
  const db = memoryInvoice(
    openInvoice({
      total: 1.23,
      amount_paid: 0,
      invoice_data: { payment_currency: 'kwd', payment_amount_minor: 1230, payment_amount: 1.23 },
    })
  );
  const result = await applyInvoiceCheckoutSession({
    writer: db.writer as never,
    session: chargedSession('cs_test_kwd', '44', 'kwd', 1230),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.applied.amountPaid, 1.23);
});

test('redelivery after the webhook returns success even if the stored charge was edited', async () => {
  const db = memoryInvoice(
    openInvoice({
      invoice_data: { payment_currency: 'usd', payment_amount_minor: 10000, payment_amount: 100 },
    })
  );
  const session = chargedSession('cs_test_replay', '44', 'usd', 10000);
  const first = await applyInvoiceCheckoutSession({ writer: db.writer as never, session });
  assert.equal(first.ok && first.applied.alreadyApplied, false);
  db.row.amount_paid = 0;
  db.row.invoice_data = { payment_currency: 'jpy', payment_amount_minor: 1 };
  const res = await runConfirmInvoice('cs_test_replay', {
    serviceRole: true,
    writer: db.writer as never,
    retrieve: async () => session,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.alreadyApplied, true);
  assert.equal(db.creditWrites, 1);
});

test('no_payment_required is logged and not credited', async () => {
  const db = memoryInvoice(openInvoice());
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  try {
    const result = await applyInvoiceCheckoutSession({
      writer: db.writer as never,
      session: { ...chargedSession('cs_test_free', '44', 'usd', 10000), payment_status: 'no_payment_required' },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'no_payment_required');
    assert.equal(db.creditWrites, 0);
    assert.equal(warnings.some((line) => line.includes('no_payment_required')), true);
  } finally {
    console.warn = original;
  }
});
