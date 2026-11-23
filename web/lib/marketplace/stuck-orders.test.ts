import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyPartCheckoutSession } from '../billing/apply-part-order.ts';
import { productIssuesTeamRecipients } from '../product-issues.ts';
import {
  DESTINATION_REFUND_NOTE,
  assembleStuckOrders,
  claimStuckOrderAlert,
  clearStuckOrderAlertsForTests,
  marketplaceOrdersAuthStatus,
  notifyStuckMarketplaceOrder,
  releaseStuckOrderAlert,
  STUCK_ORDER_ALERT_BUDGET_MS,
  STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS,
  STUCK_ORDER_ALERT_MARK_TIMEOUT_MS,
  STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS,
  STUCK_ORDER_ALERT_TIMEOUT_MS,
  stuckOrderAgeLabel,
  stuckOrderAlertIdempotencyKey,
  stuckOrderAlertKey,
  stuckOrderAlertRecipients,
  stuckOrderAlertText,
  type StuckOrderAlertLedger,
} from './stuck-orders.ts';
import { marketplaceOrderAlertLedger, STUCK_ORDER_ALERT_CLAIM_TTL_MS } from './stuck-order-alert-ledger.ts';

const here = new URL('.', import.meta.url);

test('non-admin gets 403 on the marketplace order list', () => {
  assert.equal(marketplaceOrdersAuthStatus({ ok: false, httpStatus: 404 }), 403);
  assert.equal(marketplaceOrdersAuthStatus({ ok: false, httpStatus: 401 }), 401);
  assert.equal(marketplaceOrdersAuthStatus({ ok: true }), 200);
  const route = readFileSync(new URL('../../app/api/god/marketplace-orders/route.ts', here), 'utf8');
  const gateAt = route.indexOf('requireGodCaller');
  const statusAt = route.indexOf('marketplaceOrdersAuthStatus');
  const queryAt = route.indexOf("from('marketplace_orders')");
  assert.ok(gateAt > 0 && statusAt > gateAt && queryAt > statusAt);
  assert.match(route, /status: 403|marketplaceOrdersAuthStatus/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.doesNotMatch(route, /return gate\.response/);
  assert.match(route, /truncated/);
  assert.match(route, /STUCK_ORDER_LIST_LIMIT \+ 1/);
  assert.doesNotMatch(route, /export async function POST|export async function PATCH|export async function DELETE/);
  const page = readFileSync(new URL('../../app/admin/god/marketplace-orders/page.tsx', here), 'utf8');
  assert.match(page, /stuck-orders-truncated/);
  const lib = readFileSync(new URL('./stuck-orders.ts', here), 'utf8');
  assert.match(lib, /AbortSignal\.timeout\(ms\)/);
  assert.equal(STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS, 1000);
  assert.equal(STUCK_ORDER_ALERT_TIMEOUT_MS, 3000);
  assert.equal(STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS, 1000);
  assert.equal(STUCK_ORDER_ALERT_MARK_TIMEOUT_MS, 1000);
  assert.equal(STUCK_ORDER_ALERT_BUDGET_MS, 5000);
  assert.ok(
    STUCK_ORDER_ALERT_CLAIM_TIMEOUT_MS + STUCK_ORDER_ALERT_TIMEOUT_MS + STUCK_ORDER_ALERT_RELEASE_TIMEOUT_MS <=
      STUCK_ORDER_ALERT_BUDGET_MS
  );
  assert.equal(STUCK_ORDER_ALERT_TIMEOUT_MS, 3000);
  assert.match(lib, /409 is not treated as already delivered/);
  assert.match(lib, /000973/);
  assert.match(lib, /order_id, status/);
  assert.match(page, /overflow-x-auto/);
  assert.match(page, /min-w-\[1100px\]/);
  assert.doesNotMatch(page, /scrollbar-width:\s*none/);
  assert.match(page, /DESTINATION_REFUND_NOTE/);
  assert.doesNotMatch(page, /<button/);
  const nav = readFileSync(new URL('../../components/god/GodSubnav.tsx', here), 'utf8');
  assert.match(nav, /\/admin\/god\/marketplace-orders/);
});

test('stuck order rows show age, money, and only the two waiting statuses', () => {
  const now = Date.parse('2026-11-22T12:00:00.000Z');
  assert.equal(stuckOrderAgeLabel('2026-11-22T10:30:00.000Z', now), '1h 30m');
  const rows = assembleStuckOrders({
    now,
    orders: [
      {
        id: 'ord-1',
        listing_id: 'listing-1',
        seller_organization_id: 2655,
        buyer_email: 'buyer@qa.example',
        amount_cents: 2500,
        currency: 'usd',
        stripe_checkout_session_id: 'cs_qa',
        stripe_payment_intent_id: 'pi_qa',
        status: 'refund_review',
        payout_status: 'transferred',
        quantity: 1,
        created_at: '2026-11-22T08:00:00.000Z',
        updated_at: '2026-11-22T10:30:00.000Z',
      },
      { id: 'ord-paid', status: 'paid', listing_id: 'listing-2' },
    ],
    organizations: [{ id: 2655, name: 'QA Seller' }],
    listings: [{ id: 'listing-1', part_number: 'L-1', title: 'Flashlamp' }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sellerOrganizationName, 'QA Seller');
  assert.equal(rows[0]?.listingTitle, 'L-1 · Flashlamp');
  assert.equal(rows[0]?.amount, '25.00 USD');
  assert.equal(rows[0]?.age, '1h 30m');
  assert.equal(rows[0]?.stripeCheckoutSessionId, 'cs_qa');
  assert.match(DESTINATION_REFUND_NOTE, /reverse transfer/);
});

test('admin alert dedupes per order and never addresses the buyer or seller', async () => {
  const seen = new Set<string>();
  const sent: { to: string[]; text: string }[] = [];
  const input = {
    orderId: 'ord-dedupe',
    listingId: 'listing-1',
    status: 'refund_review' as const,
    buyerEmail: 'buyer@qa.example',
    sellerOrganizationId: '2655',
    payoutStatus: 'transferred',
    sessionId: 'cs_dedupe',
    seen,
    send: async (message: { to: string[]; text: string }) => {
      sent.push(message);
    },
  };
  const first = await notifyStuckMarketplaceOrder(input);
  const second = await notifyStuckMarketplaceOrder(input);
  assert.equal(first.sent, true);
  assert.deepEqual(second, { sent: false, reason: 'duplicate' });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.to, stuckOrderAlertRecipients(['buyer@qa.example']));
  assert.ok(!sent[0]?.to.includes('buyer@qa.example'));
  assert.deepEqual(stuckOrderAlertRecipients(['buyer@qa.example', 'seller@qa.example']), productIssuesTeamRecipients());
  assert.match(sent[0]?.text || '', /reverse transfer/);
  assert.match(stuckOrderAlertText(input), /not a recipient/);
  assert.equal(claimStuckOrderAlert('ord-dedupe', 'refund_review', seen), false);
  const pending = await notifyStuckMarketplaceOrder({ ...input, status: 'stock_pending' });
  assert.equal(pending.sent, true);
  assert.equal(sent.length, 2);
  const pendingAgain = await notifyStuckMarketplaceOrder({ ...input, status: 'stock_pending' });
  assert.deepEqual(pendingAgain, { sent: false, reason: 'duplicate' });
});

test('a hung alert send times out and stays non-fatal', async () => {
  const seen = new Set<string>();
  const started = Date.now();
  const result = await notifyStuckMarketplaceOrder({
    orderId: 'ord-timeout',
    listingId: 'listing-1',
    status: 'stock_pending',
    seen,
    timeoutMs: 40,
    send: (_message, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10_000);
        const fail = () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error('aborted'));
        };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      }),
  });
  assert.deepEqual(result, { sent: false, reason: 'error' });
  assert.ok(Date.now() - started < 1000);
  const retry = await notifyStuckMarketplaceOrder({
    orderId: 'ord-timeout',
    listingId: 'listing-1',
    status: 'stock_pending',
    seen,
    timeoutMs: 40,
    send: async () => {},
  });
  assert.equal(retry.sent, true);
});

test('a refund review from checkout alerts admins once for that order', async () => {
  clearStuckOrderAlertsForTests();
  const sent: string[] = [];
  const orders: { id: string; status: string; session: string }[] = [];
  const listing = { id: 'listing-qa', quantity: 0, status: 'active' };
  const writer = {
    from() {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'insert' = 'select';
      const run = async () => {
        if (op === 'select') {
          return {
            data: orders.find((row) => row.session === filters.stripe_checkout_session_id) || null,
            error: null,
          };
        }
        const row = { id: 'ord-alert', status: 'stock_pending', session: 'cs_alert' };
        orders.push(row);
        return { data: { id: row.id }, error: null };
      };
      const api = {
        select() {
          return api;
        },
        insert() {
          op = 'insert';
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        maybeSingle() {
          return run();
        },
      };
      return api;
    },
    rpc() {
      const order = orders[0];
      if (!order) return Promise.resolve({ data: null, error: { message: 'missing' } });
      if (order.status === 'refund_review') return Promise.resolve({ data: 'refund_review', error: null });
      if (listing.quantity < 1) {
        order.status = 'refund_review';
        return Promise.resolve({ data: 'refund_review', error: null });
      }
      return Promise.resolve({ data: 'claimed', error: null });
    },
  };
  const session = {
    id: 'cs_alert',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 5000,
    metadata: {
      marketplace_kind: 'part',
      marketplace_listing_id: 'listing-qa',
      quantity: '1',
      seller_organization_id: '2655',
      buyer_email: 'buyer@qa.example',
    },
  };
  const notifyStuck = async (alert: { orderId: string; buyerEmail?: string | null; status: 'stock_pending' | 'refund_review' }) => {
    await notifyStuckMarketplaceOrder({
      ...alert,
      listingId: 'listing-qa',
      send: async (message) => {
        sent.push(message.to.join(','));
        assert.ok(!message.to.includes(String(alert.buyerEmail || '')));
      },
    });
  };
  const first = await applyPartCheckoutSession({ writer: writer as never, session, notifyStuck });
  const second = await applyPartCheckoutSession({ writer: writer as never, session, notifyStuck });
  assert.equal(first.ok && first.applied.fulfilled, false);
  assert.equal(second.ok && second.applied.fulfilled, false);
  assert.equal(sent.length, 1);
});

const ALERT_ORDER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function sharedAlertLedger(): { ledger: StuckOrderAlertLedger; rows: Set<string>; claims: { n: number } } {
  const rows = new Set<string>();
  const claims = { n: 0 };
  let tail = Promise.resolve();
  const exclusive = <T>(fn: () => T): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  return {
    rows,
    claims,
    ledger: {
      claim(orderId, status) {
        return exclusive(() => {
          claims.n += 1;
          const key = stuckOrderAlertKey(orderId, status);
          if (rows.has(key)) return false;
          rows.add(key);
          return true;
        });
      },
      release(orderId, status) {
        return exclusive(() => {
          rows.delete(stuckOrderAlertKey(orderId, status));
        });
      },
    },
  };
}

test('two instances insert one alert row and the memory set skips a repeat', async () => {
  const { ledger, claims } = sharedAlertLedger();
  const seenA = new Set<string>();
  const seenB = new Set<string>();
  let sends = 0;
  const base = {
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'stock_pending' as const,
    ledger,
    send: async () => {
      sends += 1;
    },
  };
  const [first, second] = await Promise.all([
    notifyStuckMarketplaceOrder({ ...base, seen: seenA }),
    notifyStuckMarketplaceOrder({ ...base, seen: seenB }),
  ]);
  assert.equal(sends, 1);
  assert.equal(Number(first.sent) + Number(second.sent), 1);
  const winner = first.sent ? seenA : seenB;
  const repeat = await notifyStuckMarketplaceOrder({ ...base, seen: winner });
  assert.deepEqual(repeat, { sent: false, reason: 'duplicate' });
  assert.equal(sends, 1);
  assert.equal(claims.n, 2);
  const ledgerSrc = readFileSync(new URL('./stuck-order-alert-ledger.ts', here), 'utf8');
  assert.match(ledgerSrc, /Gap left as-is/);
  assert.match(ledgerSrc, /onConflict:\s*'order_id,status'/);
  assert.match(ledgerSrc, /ignoreDuplicates:\s*true/);
  assert.match(ledgerSrc, /\.delete\(\)/);
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261122_000973_marketplace_order_alerts.sql', here),
    'utf8'
  );
  assert.match(migration, /NOT APPLIED/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS/);
  assert.match(migration, /PRIMARY KEY \(order_id, status\)/);
  assert.match(migration, /alerted_at/);
  assert.match(migration, /sent_at/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /DROP POLICY IF EXISTS/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(migration, /GRANT SELECT, INSERT, DELETE ON TABLE public\.marketplace_order_alerts TO service_role/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.marketplace_order_alerts FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.marketplace_order_alerts FROM service_role/);
  const rollback = readFileSync(
    new URL('../../supabase/migrations/20261122_000973_marketplace_order_alerts_rollback.sql', here),
    'utf8'
  );
  assert.match(rollback, /DROP TABLE IF EXISTS public\.marketplace_order_alerts/);
  assert.match(rollback, /REVOKE UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.marketplace_order_alerts FROM service_role/);
  const apply = readFileSync(new URL('../billing/apply-part-order.ts', here), 'utf8');
  assert.match(apply, /hasServiceRole\(\)/);
  assert.match(apply, /supabaseMarketplaceOrderAlertLedger\(\)/);
});

test('a status change on the same order inserts a second alert', async () => {
  const { ledger, rows } = sharedAlertLedger();
  let sends = 0;
  const send = async () => {
    sends += 1;
  };
  const pending = await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'stock_pending',
    seen: new Set(),
    ledger,
    send,
  });
  const review = await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen: new Set(),
    ledger,
    send,
  });
  assert.equal(pending.sent, true);
  assert.equal(review.sent, true);
  assert.equal(sends, 2);
  assert.equal(rows.size, 2);
  const again = await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen: new Set(),
    ledger,
    send,
  });
  assert.deepEqual(again, { sent: false, reason: 'duplicate' });
  assert.equal(sends, 2);
});

test('a failed send releases the alert row so another instance can send', async () => {
  const { ledger, rows } = sharedAlertLedger();
  const failed = await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen: new Set(),
    ledger,
    send: async () => {
      throw new Error('resend down');
    },
  });
  assert.deepEqual(failed, { sent: false, reason: 'error' });
  assert.equal(rows.size, 0);
  let sends = 0;
  const retry = await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen: new Set(),
    ledger,
    send: async () => {
      sends += 1;
    },
  });
  assert.equal(retry.sent, true);
  assert.equal(sends, 1);
  assert.equal(rows.size, 1);
});

function hangOn(signal: AbortSignal | undefined, ms = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const fail = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
}

test('the alert send uses one Resend idempotency key per order and status', async () => {
  const seen = new Set<string>();
  const keys: string[] = [];
  await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen,
    send: async (message) => {
      keys.push(message.idempotencyKey);
    },
  });
  releaseStuckOrderAlert(ALERT_ORDER, 'refund_review', seen);
  await notifyStuckMarketplaceOrder({
    orderId: ALERT_ORDER,
    listingId: 'listing-1',
    status: 'refund_review',
    seen,
    send: async (message) => {
      keys.push(message.idempotencyKey);
    },
  });
  const expected = `stuck-order/${ALERT_ORDER}/refund_review`;
  assert.equal(stuckOrderAlertIdempotencyKey(ALERT_ORDER, 'refund_review'), expected);
  assert.deepEqual(keys, [expected, expected]);
  const mail = readFileSync(new URL('../mail/outgoing-mail.ts', here), 'utf8');
  assert.match(mail, /'Idempotency-Key': key/);
  const src = readFileSync(new URL('./stuck-orders.ts', here), 'utf8');
  assert.match(src, /idempotencyKey/);
});

test('a missing alert table is logged and the in-memory claim still sends once', async () => {
  const seen = new Set<string>();
  const errors: string[] = [];
  const warns: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  };
  try {
    let sends = 0;
    const ledger: StuckOrderAlertLedger = {
      async claim() {
        throw new Error('relation marketplace_order_alerts does not exist');
      },
      async release() {},
    };
    const first = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'stock_pending',
      seen,
      ledger,
      send: async () => {
        sends += 1;
      },
    });
    const second = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'stock_pending',
      seen,
      ledger,
      send: async () => {
        sends += 1;
      },
    });
    assert.equal(first.sent, true);
    assert.deepEqual(second, { sent: false, reason: 'duplicate' });
    assert.equal(sends, 1);
    assert.ok(errors.some((line) => line.includes('alert claim failed') && line.includes('marketplace_order_alerts')));
    assert.ok(warns.some((line) => line.includes('duplicate')));
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test('a hung claim times out on its own clock and the send still goes out', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => String(item)).join(' '));
  };
  const started = Date.now();
  try {
    let sends = 0;
    const result = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'stock_pending',
      seen: new Set(),
      claimTimeoutMs: 40,
      ledger: {
        claim(_orderId, _status, signal) {
          return hangOn(signal).then(() => true);
        },
        async release() {},
      },
      send: async () => {
        sends += 1;
      },
    });
    assert.equal(result.sent, true);
    assert.equal(sends, 1);
    assert.ok(Date.now() - started < 1000);
    assert.ok(errors.some((line) => line.includes('alert claim failed')));
  } finally {
    console.error = originalError;
  }
});

test('a send timeout releases the row and the retry alerts', async () => {
  const { ledger, rows } = sharedAlertLedger();
  const originalError = console.error;
  console.error = () => {};
  const started = Date.now();
  try {
    const first = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'refund_review',
      seen: new Set(),
      ledger,
      timeoutMs: 40,
      send: (_message, signal) => hangOn(signal),
    });
    assert.deepEqual(first, { sent: false, reason: 'error' });
    assert.equal(rows.size, 0);
    assert.ok(Date.now() - started < 1000);
    let sends = 0;
    const retry = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'refund_review',
      seen: new Set(),
      ledger,
      send: async () => {
        sends += 1;
      },
    });
    assert.equal(retry.sent, true);
    assert.equal(sends, 1);
    assert.equal(rows.size, 1);
  } finally {
    console.error = originalError;
  }
});

test('a slow claim does not starve the send', async () => {
  const originalError = console.error;
  console.error = () => {};
  let sendWait = 0;
  const started = Date.now();
  try {
    const result = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'stock_pending',
      seen: new Set(),
      claimTimeoutMs: 500,
      timeoutMs: 80,
      ledger: {
        claim: () => new Promise((resolve) => setTimeout(() => resolve(true), 50)),
        async release() {},
      },
      send: (_message, signal) => {
        const began = Date.now();
        return hangOn(signal).finally(() => {
          sendWait = Date.now() - began;
        });
      },
    });
    assert.deepEqual(result, { sent: false, reason: 'error' });
    assert.ok(sendWait >= 60, `send waited ${sendWait}ms`);
    assert.ok(Date.now() - started >= 110);
    assert.ok(Date.now() - started < 500);
  } finally {
    console.error = originalError;
  }
});

test('a failed release is logged on its own timeout', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' '));
  };
  const started = Date.now();
  try {
    let claimSignal: AbortSignal | undefined;
    let sendSignal: AbortSignal | undefined;
    let releaseSignal: AbortSignal | undefined;
    const result = await notifyStuckMarketplaceOrder({
      orderId: ALERT_ORDER,
      listingId: 'listing-1',
      status: 'refund_review',
      seen: new Set(),
      releaseTimeoutMs: 40,
      ledger: {
        async claim(_orderId, _status, signal) {
          claimSignal = signal;
          return true;
        },
        release(_orderId, _status, signal) {
          releaseSignal = signal;
          return hangOn(signal);
        },
      },
      send: async (_message, signal) => {
        sendSignal = signal;
        throw new Error('resend down');
      },
    });
    assert.deepEqual(result, { sent: false, reason: 'error' });
    assert.ok(claimSignal && sendSignal && releaseSignal);
    assert.notEqual(claimSignal, sendSignal);
    assert.notEqual(sendSignal, releaseSignal);
    assert.ok(Date.now() - started < 1000);
    assert.ok(errors.some((line) => line.includes('alert release failed')));
  } finally {
    console.error = originalError;
  }
});

test('a stale unsent claim can be taken again and a sent claim cannot', async () => {
  assert.equal(STUCK_ORDER_ALERT_CLAIM_TTL_MS, 60 * 60 * 1000);
  const now = Date.parse('2026-11-23T12:00:00.000Z');
  type AlertRow = { order_id: string; status: string; alerted_at: string; sent_at: string | null };
  const rows: AlertRow[] = [];
  const writer = {
    from() {
      const filters: Record<string, unknown> = {};
      let nullColumn: string | null = null;
      let op: 'upsert' | 'delete' | 'select' = 'select';
      let values: Partial<AlertRow> | null = null;
      const matches = (row: AlertRow) =>
        Object.entries(filters).every(([key, value]) => row[key as keyof AlertRow] === value) &&
        (nullColumn == null || row[nullColumn as keyof AlertRow] == null);
      const run = async () => {
        if (op === 'delete') {
          for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i])) rows.splice(i, 1);
          return { data: null, error: null };
        }
        if (op === 'select') {
          return { data: rows.find(matches) ?? null, error: null };
        }
        const existing = rows.find((row) => row.order_id === values?.order_id && row.status === values?.status);
        if (existing) return { data: [], error: null };
        const row: AlertRow = {
          order_id: String(values?.order_id),
          status: String(values?.status),
          alerted_at: values?.alerted_at || new Date(now).toISOString(),
          sent_at: values?.sent_at ?? null,
        };
        rows.push(row);
        return { data: [row], error: null };
      };
      const api = {
        upsert(next: Partial<AlertRow>) {
          op = 'upsert';
          values = next;
          return api;
        },
        select() {
          if (op !== 'upsert') op = 'select';
          return api;
        },
        delete() {
          op = 'delete';
          return api;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        is(column: string, value: null) {
          if (value === null) nullColumn = column;
          return api;
        },
        abortSignal() {
          return api;
        },
        maybeSingle() {
          return run();
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return run().then(resolve, reject);
        },
      };
      return api;
    },
  };
  const ledger = marketplaceOrderAlertLedger(writer, () => now);
  rows.push({
    order_id: ALERT_ORDER,
    status: 'stock_pending',
    alerted_at: '2026-11-23T09:00:00.000Z',
    sent_at: null,
  });
  assert.equal(await ledger.claim(ALERT_ORDER, 'stock_pending'), true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sent_at, null);

  rows[0] = {
    order_id: ALERT_ORDER,
    status: 'stock_pending',
    alerted_at: '2026-11-23T11:30:00.000Z',
    sent_at: null,
  };
  assert.equal(await ledger.claim(ALERT_ORDER, 'stock_pending'), false);
  assert.equal(rows[0]?.alerted_at, '2026-11-23T11:30:00.000Z');

  rows[0] = {
    order_id: ALERT_ORDER,
    status: 'stock_pending',
    alerted_at: '2026-11-23T09:00:00.000Z',
    sent_at: '2026-11-23T09:05:00.000Z',
  };
  assert.equal(await ledger.claim(ALERT_ORDER, 'stock_pending'), false);
  assert.equal(rows[0]?.sent_at, '2026-11-23T09:05:00.000Z');
});
