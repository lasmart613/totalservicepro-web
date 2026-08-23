import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUpgradeCheckoutFields,
  evaluateUpgradeSession,
  orgUpgradeFields,
} from './upgrade-session.ts';
import { livePlanFromStripePrice } from './plan-catalog.ts';

const owner = { userId: 'user-1', organizationId: '42' };

function fields() {
  return buildUpgradeCheckoutFields({
    priceId: 'price_liveExisting',
    productId: 'prod_liveExisting',
    owner,
    successUrl: 'https://repairplanet.net/plans?upgraded=1&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://repairplanet.net/plans?paid=0',
    customerEmail: 'tech@example.com',
  });
}

test('checkout session is subscription mode attached to the current org', () => {
  const body = fields();
  assert.equal(body.mode, 'subscription');
  assert.equal(body.client_reference_id, '42');
  assert.equal(body['metadata[organization_id]'], '42');
  assert.equal(body['metadata[user_id]'], 'user-1');
  assert.equal(body['metadata[stripe_price_id]'], 'price_liveExisting');
  assert.equal(body['line_items[0][price]'], 'price_liveExisting');
  assert.match(body.cancel_url, /paid=0/);
});

test('checkout refuses to start without an organization or a Stripe price', () => {
  assert.throws(
    () =>
      buildUpgradeCheckoutFields({
        priceId: 'price_x',
        productId: 'prod_x',
        owner: { userId: 'user-1', organizationId: '' },
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    /organization_id/
  );
  assert.throws(
    () =>
      buildUpgradeCheckoutFields({
        priceId: 'not-a-price',
        productId: 'prod_x',
        owner,
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    /price id/
  );
});

test('complete paid session for the same org is accepted', () => {
  const result = evaluateUpgradeSession(
    {
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      client_reference_id: '42',
      metadata: {
        kind: 'org_plan',
        organization_id: '42',
        user_id: 'user-1',
        stripe_price_id: 'price_liveExisting',
      },
    },
    owner
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.priceId, 'price_liveExisting');
});

test('canceled or unpaid checkout does not upgrade', () => {
  const open = evaluateUpgradeSession(
    { mode: 'subscription', status: 'open', payment_status: 'unpaid', metadata: {} },
    owner
  );
  assert.equal(open.ok, false);

  const otherOrg = evaluateUpgradeSession(
    {
      mode: 'subscription',
      status: 'complete',
      payment_status: 'paid',
      metadata: {
        organization_id: '99',
        user_id: 'user-1',
        stripe_price_id: 'price_liveExisting',
        kind: 'org_plan',
      },
    },
    owner
  );
  assert.equal(otherOrg.ok, false);
  if (!otherOrg.ok) assert.equal(otherOrg.reason, 'org_mismatch');
});

test('org upgrade only sets is_premium — no invented plan name', () => {
  assert.deepEqual(orgUpgradeFields(), { is_premium: true });
});

test('live plan mapper drops marketplace prices and one-off prices', () => {
  assert.equal(
    livePlanFromStripePrice({
      id: 'price_part',
      active: true,
      type: 'recurring',
      unit_amount: 5000,
      recurring: { interval: 'month' },
      metadata: { marketplace_listing_id: 'abc' },
    }),
    null
  );
  assert.equal(
    livePlanFromStripePrice({
      id: 'price_once',
      active: true,
      type: 'one_time',
      unit_amount: 5000,
    }),
    null
  );
  const live = livePlanFromStripePrice({
    id: 'price_abc123',
    active: true,
    type: 'recurring',
    unit_amount: 2500,
    currency: 'usd',
    recurring: { interval: 'month' },
    product: { id: 'prod_abc', name: 'Existing Stripe name' },
  });
  assert.equal(live?.priceId, 'price_abc123');
  assert.equal(live?.name, 'Existing Stripe name');
  assert.equal(live?.unitAmountCents, 2500);
});
