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
  stuckOrderAgeLabel,
  stuckOrderAlertRecipients,
  stuckOrderAlertText,
} from './stuck-orders.ts';

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
  assert.doesNotMatch(route, /export async function POST|export async function PATCH|export async function DELETE/);
  const page = readFileSync(new URL('../../app/admin/god/marketplace-orders/page.tsx', here), 'utf8');
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
  assert.equal(claimStuckOrderAlert('ord-dedupe', seen), false);
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
