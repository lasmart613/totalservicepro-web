import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAN_OFFERS } from './plan-catalog.ts';
import {
  buildUpgradeCheckoutFields,
  buildUpgradeReceipt,
  evaluateUpgradeSession,
  firstHttpsUrl,
  orgUpgradeFields,
  parsePaidSubscriptionRecord,
  parsePaidUpgradeSession,
  planDisplayName,
} from './upgrade-session.ts';

const owner = { userId: 'user-1', organizationId: '42' };

function fields() {
  return buildUpgradeCheckoutFields({
    offer: PLAN_OFFERS.premium_monthly,
    priceId: 'price_existing',
    owner,
    successUrl: 'https://repairplanet.net/checkout/receipt?session_id={CHECKOUT_SESSION_ID}',
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

test('complete session with exact plan metadata is paid even without sku', () => {
  const parsed = parsePaidUpgradeSession({
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    client_reference_id: '42',
    metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', plan: 'premium' },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.plan, 'premium');

  const pro = parsePaidUpgradeSession({
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', plan: 'pro' },
  });
  assert.equal(pro.ok, false);
});

test('active Stripe subscription with org metadata is paid', () => {
  const parsed = parsePaidSubscriptionRecord({
    id: 'sub_1',
    status: 'active',
    metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', sku: 'team_monthly' },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.plan, 'team');

  const canceled = parsePaidSubscriptionRecord({
    status: 'canceled',
    metadata: { sku: 'premium_monthly', organization_id: '42' },
  });
  assert.equal(canceled.ok, false);
});

test('complete $9.99 subscription session is Premium even without plan metadata', () => {
  const parsed = parsePaidUpgradeSession({
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 999,
    metadata: {},
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.plan, 'premium');
    assert.equal(parsed.sku, 'premium_monthly');
  }
  const unknownAmount = parsePaidUpgradeSession({
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    amount_total: 123,
    metadata: {},
  });
  assert.equal(unknownAmount.ok, false);
});

test('evaluate may accept a complete session when user_id is missing if allowed', () => {
  const session = {
    mode: 'subscription' as const,
    status: 'complete',
    payment_status: 'paid',
    metadata: { kind: 'org_plan', organization_id: '42', sku: 'premium_monthly' },
  };
  assert.equal(evaluateUpgradeSession(session, owner).ok, false);
  const allowed = evaluateUpgradeSession(session, owner, { allowMissingUser: true });
  assert.equal(allowed.ok, true);
});

test('org upgrade writes paid flags for the selected plan', () => {
  assert.deepEqual(orgUpgradeFields('premium'), {
    is_premium: true,
    subscription_tier: 'premium',
    plan: 'premium',
    manual_slots: 15,
  });
  assert.deepEqual(orgUpgradeFields('team').manual_slots, 50);
  assert.deepEqual(orgUpgradeFields('enterprise').manual_slots, 999);
});

test('receipt uses Stripe amount and URL and does not invent a receipt number', () => {
  const receipt = buildUpgradeReceipt({
    plan: 'premium',
    sku: 'premium_monthly',
    session: {
      amount_total: 999,
      currency: 'usd',
      invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/acct_real', number: 'INV-99' },
    },
  });
  assert.equal(receipt.planLabel, 'Premium');
  assert.equal(receipt.amountLabel, '$9.99');
  assert.equal(receipt.stripeReceiptUrl, 'https://invoice.stripe.com/i/acct_real');
  assert.equal(receipt.existingOrganizationUpgraded, true);
  assert.equal('receiptNumber' in receipt, false);
  assert.equal(planDisplayName('team'), 'Team');
  assert.equal(firstHttpsUrl('not-a-url', 'https://pay.stripe.com/receipts/in_1'), 'https://pay.stripe.com/receipts/in_1');
});

test('receipt omits a Stripe link when the session has no invoice or receipt URL', () => {
  const receipt = buildUpgradeReceipt({
    plan: 'team',
    sku: 'team_monthly',
    session: { amount_total: 3999, currency: 'usd', invoice: 'in_123' },
    fallbackAmountLabel: '$39.99 / month',
  });
  assert.equal(receipt.planLabel, 'Team');
  assert.equal(receipt.amountLabel, '$39.99');
  assert.equal(receipt.stripeReceiptUrl, null);
});
