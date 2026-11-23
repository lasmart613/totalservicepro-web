import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyPartCheckoutSession,
  PART_ORDER_ALREADY_SETTLED,
  PART_ORDER_CLAIM_RPC,
  PART_ORDER_CLAIMED,
  PART_ORDER_REFUND_REVIEW_STATUS,
  PART_ORDER_STOCK_PENDING_STATUS,
  partOrderRouteOutcome,
} from './apply-part-order.ts';

type Listing = { id: string; quantity: number | null; status: string };
type OrderRow = {
  id: string;
  stripe_checkout_session_id: string;
  listing_id: string;
  status: string;
  payout_status: string;
  quantity: number;
};

function createDb(listing: Listing, options: { rpcFailures?: number } = {}) {
  const orders: OrderRow[] = [];
  const rpcResults: string[] = [];
  let rpcFailures = options.rpcFailures ?? 0;

  const writer = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;
      const run = async () => {
        if (table !== 'marketplace_orders') {
          return { data: null, error: { message: `unexpected ${table}` } };
        }
        if (op === 'select') {
          const row = orders.find((item) => item.stripe_checkout_session_id === filters.stripe_checkout_session_id) || null;
          return { data: row, error: null };
        }
        const sessionId = String(payload?.stripe_checkout_session_id || '');
        if (orders.some((item) => item.stripe_checkout_session_id === sessionId)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint 23505' } };
        }
        const row: OrderRow = {
          id: `ord-${orders.length + 1}`,
          stripe_checkout_session_id: sessionId,
          listing_id: String(payload?.listing_id || ''),
          status: String(payload?.status || PART_ORDER_STOCK_PENDING_STATUS),
          payout_status: String(payload?.payout_status || 'held'),
          quantity: Number(payload?.quantity || 1),
        };
        orders.push(row);
        return { data: { id: row.id }, error: null };
      };
      const api = {
        select() {
          return api;
        },
        insert(next: Record<string, unknown>) {
          op = 'insert';
          payload = next;
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        maybeSingle() {
          return run();
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return run().then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    rpc(name: string, args: { p_order_id: string; p_listing_id: string; p_quantity: number }) {
      if (name !== PART_ORDER_CLAIM_RPC) return Promise.resolve({ data: null, error: { message: 'missing function' } });
      if (rpcFailures > 0) {
        rpcFailures -= 1;
        return Promise.resolve({ data: null, error: { message: 'db down' } });
      }
      const order = orders.find((item) => item.id === args.p_order_id);
      if (!order) return Promise.resolve({ data: null, error: { message: 'missing order' } });
      if (order.status === 'paid') {
        rpcResults.push(PART_ORDER_ALREADY_SETTLED);
        return Promise.resolve({ data: PART_ORDER_ALREADY_SETTLED, error: null });
      }
      if (order.status === PART_ORDER_REFUND_REVIEW_STATUS) {
        rpcResults.push(PART_ORDER_REFUND_REVIEW_STATUS);
        return Promise.resolve({ data: PART_ORDER_REFUND_REVIEW_STATUS, error: null });
      }
      if (order.status !== PART_ORDER_STOCK_PENDING_STATUS) {
        return Promise.resolve({ data: null, error: { message: 'not claimable' } });
      }
      order.status = 'paid';
      const n = args.p_quantity;
      if (listing.id !== args.p_listing_id || listing.quantity == null || listing.quantity < n) {
        order.status = PART_ORDER_REFUND_REVIEW_STATUS;
        rpcResults.push(PART_ORDER_REFUND_REVIEW_STATUS);
        return Promise.resolve({ data: PART_ORDER_REFUND_REVIEW_STATUS, error: null });
      }
      listing.quantity -= n;
      if (listing.quantity === 0) listing.status = 'sold';
      rpcResults.push(PART_ORDER_CLAIMED);
      return Promise.resolve({ data: PART_ORDER_CLAIMED, error: null });
    },
  };

  return { writer, orders, listing, rpcResults };
}

function session(id: string, quantity = 1, listingId = 'listing-qa') {
  return {
    id,
    status: 'complete',
    payment_status: 'paid',
    mode: 'payment',
    amount_total: 5000,
    currency: 'usd',
    customer_details: { email: 'buyer@qa.example' },
    metadata: {
      marketplace_kind: 'part',
      marketplace_listing_id: listingId,
      quantity: String(quantity),
      seller_organization_id: '2655',
      stripe_destination_account: 'acct_qa2655',
    },
  };
}

async function withErrors<T>(fn: () => Promise<T>): Promise<{ result: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    return { result: await fn(), errors };
  } finally {
    console.error = orig;
  }
}

test('one session re-delivered together decrements stock 5 to 4 once', async () => {
  const db = createDb({ id: 'listing-qa', quantity: 5, status: 'active' });
  const [first, second] = await Promise.all([
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_same') }),
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_same') }),
  ]);
  assert.equal(db.listing.quantity, 4);
  assert.equal(db.listing.status, 'active');
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0]?.status, 'paid');
  assert.deepEqual(db.rpcResults.slice().sort(), [PART_ORDER_ALREADY_SETTLED, PART_ORDER_CLAIMED]);
  for (const result of [first, second]) {
    assert.equal(result.ok && result.applied.fulfilled, true);
  }
  const outcomes = [first, second].map((result) => (result.ok ? partOrderRouteOutcome(result) : null));
  assert.ok(outcomes.every((outcome) => outcome?.httpStatus === 200 && outcome.body.fulfilled === true));
});

test('a missed listing ends refund_review and the route does not say fulfilled', async () => {
  const db = createDb({ id: 'listing-qa', quantity: 0, status: 'active' });
  const { result } = await withErrors(() =>
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_miss', 1) })
  );
  assert.equal(result.ok && result.applied.fulfilled, false);
  assert.equal(db.listing.quantity, 0);
  assert.equal(db.listing.status, 'active');
  assert.equal(db.orders[0]?.status, PART_ORDER_REFUND_REVIEW_STATUS);
  assert.equal(db.rpcResults[0], PART_ORDER_REFUND_REVIEW_STATUS);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const outcome = partOrderRouteOutcome(result);
  assert.equal(outcome.httpStatus, 200);
  assert.equal(outcome.body.fulfilled, false);
  assert.equal(outcome.body.applied, true);
});

test('a repeat of a claimed session is already_settled and does not decrement', async () => {
  const db = createDb({ id: 'listing-qa', quantity: 5, status: 'active' });
  const first = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_once') });
  const second = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_once') });
  assert.equal(first.ok && first.applied.fulfilled && !first.applied.alreadyApplied, true);
  assert.equal(second.ok && second.applied.fulfilled && second.applied.alreadyApplied, true);
  assert.equal(db.listing.quantity, 4);
  assert.equal(db.orders.length, 1);
  assert.deepEqual(db.rpcResults, [PART_ORDER_CLAIMED, PART_ORDER_ALREADY_SETTLED]);
});

test('two buyers of the last unit fulfill once', async () => {
  const db = createDb({ id: 'listing-qa', quantity: 1, status: 'active' });
  const { result } = await withErrors(() =>
    Promise.all([
      applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_a') }),
      applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_b') }),
    ])
  );
  const fulfilled = result.filter((row) => row.ok && row.applied.fulfilled);
  const refused = result.filter((row) => row.ok && !row.applied.fulfilled);
  assert.equal(fulfilled.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(db.listing.quantity, 0);
  assert.equal(db.listing.status, 'sold');
  assert.equal(db.orders.filter((row) => row.status === 'paid').length, 1);
  assert.equal(db.orders.filter((row) => row.status === PART_ORDER_REFUND_REVIEW_STATUS).length, 1);
});

test('a claim error stays unfulfilled and the retry claims once', async () => {
  const db = createDb({ id: 'listing-qa', quantity: 4, status: 'active' }, { rpcFailures: 1 });
  const { result, errors } = await withErrors(() =>
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_retry') })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.retry, true);
  assert.equal(partOrderRouteOutcome(result).httpStatus, 500);
  assert.equal(db.listing.quantity, 4);
  assert.equal(db.orders[0]?.status, PART_ORDER_STOCK_PENDING_STATUS);
  assert.ok(errors.some((line) => String(line[0]).includes('stock claim failed')));

  const retry = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_retry') });
  assert.equal(retry.ok && retry.applied.fulfilled, true);
  assert.equal(db.listing.quantity, 3);
  assert.equal(db.orders.length, 1);

  const again = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_retry') });
  assert.equal(again.ok && again.applied.fulfilled && again.applied.alreadyApplied, true);
  assert.equal(db.listing.quantity, 3);
});

test('an unexpected claim result is not fulfilled', async () => {
  const writer = {
    from() {
      let op: 'select' | 'insert' = 'select';
      const api = {
        select() {
          return api;
        },
        insert() {
          op = 'insert';
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => (op === 'insert' ? { data: { id: 'ord-x' }, error: null } : { data: null, error: null }),
      };
      return api;
    },
    rpc: async () => ({ data: 'nope', error: null }),
  };
  const { result } = await withErrors(() =>
    applyPartCheckoutSession({ writer: writer as never, session: session('cs_odd') })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.retry, true);
  assert.equal(partOrderRouteOutcome(result).body.fulfilled, undefined);
});

test('the claim path is only the stock function, and checkout stays behind its flag', () => {
  const src = readFileSync(new URL('./apply-part-order.ts', import.meta.url), 'utf8');
  assert.match(src, /rpc\(PART_ORDER_CLAIM_RPC/);
  assert.doesNotMatch(src, /from\('marketplace_listings'\)/);
  assert.doesNotMatch(src, /from\('marketplace_orders'\)[\s\S]{0,80}\.update\(/);
  assert.doesNotMatch(src, /STOCK_CLAIM_ATTEMPT_CAP|claimListingStockOnce/);
  assert.match(src, /result === PART_ORDER_CLAIMED \|\| result === PART_ORDER_ALREADY_SETTLED/);
  const route = readFileSync(new URL('../../app/api/billing/upgrade/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /partOrderRouteOutcome\(part\)/);
  const checkout = readFileSync(new URL('../../app/api/marketplace/parts/[id]/checkout/route.ts', import.meta.url), 'utf8');
  assert.match(checkout, /isMarketplaceCheckoutEnabled\(\)/);
  assert.doesNotMatch(checkout, /marketplace_order_claim_stock/);
  const migration = readFileSync(
    new URL('../../supabase/migrations/20261122_000972_marketplace_order_claim_stock.sql', import.meta.url),
    'utf8'
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.marketplace_order_claim_stock\(uuid, uuid, integer\) TO service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.marketplace_order_claim_stock\(uuid, uuid, integer\) FROM PUBLIC/);
  assert.match(migration, /NOT APPLIED/);
  const rollback = readFileSync(
    new URL('../../supabase/migrations/20261122_000972_marketplace_order_claim_stock_rollback.sql', import.meta.url),
    'utf8'
  );
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.marketplace_order_claim_stock\(uuid, uuid, integer\)/);
});
