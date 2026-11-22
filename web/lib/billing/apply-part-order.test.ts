import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPartCheckoutSession, PART_ORDER_REFUND_REVIEW_STATUS } from './apply-part-order.ts';

type Listing = {
  id: string;
  quantity: number | null;
  qty: number | null;
  status: string;
  details: Record<string, unknown> | null;
};

type OrderRow = {
  id: string;
  stripe_checkout_session_id: string;
  listing_id: string;
  status: string;
  payout_status: string;
  quantity: number;
};

type ClaimFilter = Record<string, unknown>;

function createDb(listing: Listing, peerReads = 1) {
  const orders: OrderRow[] = [];
  const claims: ClaimFilter[] = [];
  let listingReads = 0;
  const waiters: Array<() => void> = [];

  const writer = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const isFilters: Record<string, unknown> = {};
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;

      const run = async () => {
        if (table === 'marketplace_orders' && op === 'select') {
          const row = orders.find((o) => o.stripe_checkout_session_id === filters.stripe_checkout_session_id) || null;
          return { data: row, error: null };
        }
        if (table === 'marketplace_orders' && op === 'insert') {
          const sessionId = String(payload?.stripe_checkout_session_id || '');
          if (orders.some((o) => o.stripe_checkout_session_id === sessionId)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint 23505' } };
          }
          const row: OrderRow = {
            id: `ord-${orders.length + 1}`,
            stripe_checkout_session_id: sessionId,
            listing_id: String(payload?.listing_id || ''),
            status: String(payload?.status || 'paid'),
            payout_status: String(payload?.payout_status || 'held'),
            quantity: Number(payload?.quantity || 1),
          };
          orders.push(row);
          return { data: { id: row.id }, error: null };
        }
        if (table === 'marketplace_orders' && op === 'update') {
          const row = orders.find((o) => o.id === filters.id);
          if (!row) return { data: null, error: { message: 'missing order' } };
          if (payload?.status != null) row.status = String(payload.status);
          if (payload?.payout_status != null) row.payout_status = String(payload.payout_status);
          return { data: row, error: null };
        }
        if (table === 'marketplace_listings' && op === 'select') {
          listingReads += 1;
          if (peerReads > 1 && listingReads <= peerReads) {
            await new Promise<void>((resolve) => {
              waiters.push(resolve);
              if (waiters.length >= peerReads) {
                const ready = waiters.splice(0);
                queueMicrotask(() => {
                  for (const wake of ready) wake();
                });
              }
            });
          }
          return {
            data: {
              id: listing.id,
              quantity: listing.quantity,
              qty: listing.qty,
              status: listing.status,
              details: listing.details,
            },
            error: null,
          };
        }
        if (table === 'marketplace_listings' && op === 'update') {
          claims.push({ ...filters, ...Object.fromEntries(Object.entries(isFilters).map(([key, value]) => [`is:${key}`, value])) });
          if (filters.id != null && String(filters.id) !== listing.id) return { data: [], error: null };
          if (Object.prototype.hasOwnProperty.call(filters, 'quantity') && listing.quantity !== filters.quantity) {
            return { data: [], error: null };
          }
          if (Object.prototype.hasOwnProperty.call(filters, 'qty') && listing.qty !== filters.qty) {
            return { data: [], error: null };
          }
          if (Object.prototype.hasOwnProperty.call(isFilters, 'quantity') && listing.quantity !== isFilters.quantity) {
            return { data: [], error: null };
          }
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'quantity')) {
            listing.quantity = payload.quantity as number | null;
          }
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'qty')) listing.qty = payload.qty as number | null;
          if (payload?.status != null) listing.status = String(payload.status);
          return { data: [{ id: listing.id, quantity: listing.quantity, status: listing.status }], error: null };
        }
        return { data: null, error: { message: `unexpected ${table} ${op}` } };
      };

      const api = {
        select() {
          return api;
        },
        update(next: Record<string, unknown>) {
          op = 'update';
          payload = next;
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
        is(col: string, val: unknown) {
          isFilters[col] = val;
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
  };

  return { writer, orders, listing, claims };
}

function session(id: string, quantity = 1) {
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
      marketplace_listing_id: 'listing-qa',
      quantity: String(quantity),
      seller_organization_id: '2655',
      stripe_destination_account: 'acct_qa2655',
    },
  };
}

const active = (quantity: number | null, extra?: Partial<Listing>): Listing => ({
  id: 'listing-qa',
  quantity,
  qty: null,
  status: 'active',
  details: null,
  ...extra,
});

async function withWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const warnings: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = orig;
  }
}

test('concurrent last-unit purchase fulfills once', { timeout: 2000 }, async () => {
  const db = createDb(active(1), 2);
  const { result, warnings } = await withWarnings(() =>
    Promise.all([
      applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_last_a') }),
      applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_last_b') }),
    ])
  );
  const fulfilled = result.filter((row) => row.ok && row.applied.fulfilled && !row.applied.alreadyApplied);
  const refused = result.filter((row) => row.ok && !row.applied.fulfilled);
  assert.equal(fulfilled.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(db.listing.quantity, 0);
  assert.equal(db.listing.status, 'sold');
  assert.equal(db.orders.filter((row) => row.status === 'paid').length, 1);
  assert.equal(db.orders.filter((row) => row.status === PART_ORDER_REFUND_REVIEW_STATUS).length, 1);
  const review = db.orders.find((row) => row.status === PART_ORDER_REFUND_REVIEW_STATUS);
  assert.equal(review?.payout_status, 'transferred');
  assert.ok(db.claims.some((claim) => claim.quantity === 1 && claim.id === 'listing-qa'));
  assert.ok(db.claims.every((claim) => Object.prototype.hasOwnProperty.call(claim, 'quantity')));
  assert.ok(warnings.some((line) => String(line[0]).includes('marked for refund review')));
});

test('two concurrent purchases both fulfill when stock covers both', { timeout: 2000 }, async () => {
  const db = createDb(active(5), 2);
  const [first, second] = await Promise.all([
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_both_a') }),
    applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_both_b') }),
  ]);
  assert.equal(first.ok && first.applied.fulfilled && !first.applied.alreadyApplied, true);
  assert.equal(second.ok && second.applied.fulfilled && !second.applied.alreadyApplied, true);
  assert.equal(db.listing.quantity, 3);
  assert.equal(db.listing.status, 'active');
  assert.equal(db.orders.filter((row) => row.status === 'paid').length, 2);
  assert.equal(db.orders.filter((row) => row.status === PART_ORDER_REFUND_REVIEW_STATUS).length, 0);
});

test('insufficient stock does not fulfill or zero the listing', async () => {
  const short = createDb(active(1));
  const { result, warnings } = await withWarnings(() =>
    applyPartCheckoutSession({ writer: short.writer as never, session: session('cs_short', 2) })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.applied.fulfilled, false);
  assert.equal(result.applied.alreadyApplied, false);
  assert.equal(short.listing.quantity, 1);
  assert.equal(short.listing.status, 'active');
  assert.equal(short.claims.length, 0);
  assert.equal(short.orders[0]?.status, PART_ORDER_REFUND_REVIEW_STATUS);
  assert.ok(warnings.some((line) => (line[1] as { reason?: string } | undefined)?.reason === 'insufficient'));

  const none = createDb(active(0));
  const emptyRun = await withWarnings(() =>
    applyPartCheckoutSession({ writer: none.writer as never, session: session('cs_zero') })
  );
  const empty = emptyRun.result;
  assert.equal(empty.ok && empty.applied.fulfilled, false);
  assert.equal(none.listing.quantity, 0);
  assert.equal(none.listing.status, 'active');
  assert.equal(none.orders[0]?.status, PART_ORDER_REFUND_REVIEW_STATUS);
});

test('webhook retry is idempotent and does not decrement again', async () => {
  const db = createDb(active(3));
  const first = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_retry') });
  const second = await applyPartCheckoutSession({ writer: db.writer as never, session: session('cs_retry') });
  assert.equal(first.ok && first.applied.fulfilled && !first.applied.alreadyApplied, true);
  assert.equal(second.ok && second.applied.alreadyApplied && second.applied.fulfilled, true);
  assert.equal(second.ok && second.applied.orderId, first.ok ? first.applied.orderId : null);
  assert.equal(db.listing.quantity, 2);
  assert.equal(db.orders.length, 1);
  assert.equal(db.orders[0]?.status, 'paid');

  const raced = createDb(active(1), 2);
  await withWarnings(() =>
    Promise.all([
      applyPartCheckoutSession({ writer: raced.writer as never, session: session('cs_retry_a') }),
      applyPartCheckoutSession({ writer: raced.writer as never, session: session('cs_retry_b') }),
    ])
  );
  assert.equal(raced.listing.quantity, 0);
  const paid = raced.orders.find((row) => row.status === 'paid');
  const review = raced.orders.find((row) => row.status === PART_ORDER_REFUND_REVIEW_STATUS);
  assert.ok(paid && review);
  const againPaid = await applyPartCheckoutSession({
    writer: raced.writer as never,
    session: session(paid.stripe_checkout_session_id),
  });
  const againReview = await applyPartCheckoutSession({
    writer: raced.writer as never,
    session: session(review.stripe_checkout_session_id),
  });
  assert.equal(againPaid.ok && againPaid.applied.alreadyApplied && againPaid.applied.fulfilled, true);
  assert.equal(againReview.ok && againReview.applied.alreadyApplied && !againReview.applied.fulfilled, true);
  assert.equal(raced.listing.quantity, 0);
  assert.equal(raced.orders.length, 2);
  assert.equal(raced.orders.filter((row) => row.status === 'paid').length, 1);
});

test('qty and details-only stock still compare before they write', async () => {
  const qty = createDb(active(null, { qty: 1 }));
  const fromQty = await applyPartCheckoutSession({ writer: qty.writer as never, session: session('cs_qty') });
  assert.equal(fromQty.ok && fromQty.applied.fulfilled, true);
  assert.equal(qty.listing.quantity, 0);
  assert.equal(qty.listing.qty, 0);
  assert.equal(qty.listing.status, 'sold');
  assert.ok(qty.claims.some((claim) => claim.qty === 1));

  const details = createDb(active(null, { details: { quantity_available: 1 } }));
  const fromDetails = await applyPartCheckoutSession({ writer: details.writer as never, session: session('cs_details') });
  assert.equal(fromDetails.ok && fromDetails.applied.fulfilled, true);
  assert.equal(details.listing.quantity, 0);
  assert.equal(details.listing.status, 'sold');
  assert.ok(details.claims.some((claim) => claim['is:quantity'] === null));
});
