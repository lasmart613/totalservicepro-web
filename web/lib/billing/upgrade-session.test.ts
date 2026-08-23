import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_OFFERS } from './plan-catalog.ts';
import {
  buildUpgradeCheckoutFields,
  evaluateUpgradeSession,
  orgUpgradeFields,
} from './upgrade-session.ts';

const owner = { userId: 'user-1', organizationId: '42' };

function fields() {
  return buildUpgradeCheckoutFields({
    offer: PLAN_OFFERS.premium_monthly,
    priceId: 'price_existing',
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
  assert.equal(body['metadata[sku]'], 'premium_monthly');
  assert.equal(body['subscription_data[metadata][organization_id]'], '42');
  assert.equal(body['line_items[0][price]'], 'price_existing');
  assert.match(body.cancel_url, /paid=0/);
});

test('checkout refuses to start without an organization', () => {
  assert.throws(
    () =>
      buildUpgradeCheckoutFields({
        offer: PLAN_OFFERS.team_monthly,
        priceId: 'price_x',
        owner: { userId: 'user-1', organizationId: '' },
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      }),
    /organization_id/
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
        sku: 'premium_monthly',
        plan: 'premium',
      },
    },
    owner
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plan, 'premium');
});

test('canceled or unpaid checkout does not upgrade', () => {
  const open = evaluateUpgradeSession(
    { mode: 'subscription', status: 'open', payment_status: 'unpaid', metadata: { sku: 'premium_monthly' } },
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
        sku: 'premium_monthly',
        kind: 'org_plan',
      },
    },
    owner
  );
  assert.equal(otherOrg.ok, false);
  if (!otherOrg.ok) assert.equal(otherOrg.reason, 'org_mismatch');
});

test('org upgrade writes paid flags for the selected plan', () => {
  assert.deepEqual(orgUpgradeFields('premium'), {
    is_premium: true,
    subscription_tier: 'premium',
    plan: 'premium',
  });
});
