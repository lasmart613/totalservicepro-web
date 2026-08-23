import assert from 'node:assert/strict';
import test from 'node:test';
import { pickLatestPaidSubscription, pickLatestPaidUpgradeSession, uniqueStripeObjects } from './sync-subscription.ts';

const owner = { userId: 'user-1', organizationId: '42' };

test('picks the newest complete paid session for this org only', () => {
  const picked = pickLatestPaidUpgradeSession(
    [
      {
        id: 'cs_old',
        created: 10,
        mode: 'subscription',
        status: 'complete',
        payment_status: 'paid',
        metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', sku: 'premium_monthly' },
      },
      {
        id: 'cs_new',
        created: 50,
        mode: 'subscription',
        status: 'complete',
        payment_status: 'paid',
        metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', sku: 'premium_monthly' },
      },
      {
        id: 'cs_other_org',
        created: 99,
        mode: 'subscription',
        status: 'complete',
        payment_status: 'paid',
        metadata: { kind: 'org_plan', organization_id: '99', user_id: 'user-1', sku: 'premium_monthly' },
      },
      {
        id: 'cs_open',
        created: 80,
        mode: 'subscription',
        status: 'open',
        payment_status: 'unpaid',
        metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', sku: 'premium_monthly' },
      },
    ],
    owner
  );
  assert.equal(picked?.id, 'cs_new');
});

test('complete $9.99 session on this customer is Premium even without org metadata', () => {
  const picked = pickLatestPaidUpgradeSession(
    [
      {
        id: 'cs_larry',
        created: 20,
        mode: 'subscription',
        status: 'complete',
        payment_status: 'paid',
        amount_total: 999,
        metadata: {},
      },
    ],
    owner
  );
  assert.equal(picked?.id, 'cs_larry');
});

test('does not invent a match when no complete session belongs to this org', () => {
  assert.equal(
    pickLatestPaidUpgradeSession(
      [
        {
          id: 'cs_other',
          created: 9,
          mode: 'subscription',
          status: 'complete',
          payment_status: 'paid',
          metadata: { kind: 'org_plan', organization_id: '99', user_id: 'user-1', sku: 'premium_monthly' },
        },
      ],
      owner
    ),
    null
  );
});

test('active subscription for this org is a fallback when sessions are missing', () => {
  const picked = pickLatestPaidSubscription(
    [
      {
        id: 'sub_1',
        status: 'active',
        metadata: { kind: 'org_plan', organization_id: '42', user_id: 'user-1', plan: 'premium' },
      },
    ],
    owner
  );
  assert.equal(picked?.id, 'sub_1');
  assert.equal(
    pickLatestPaidSubscription([{ id: 'sub_x', status: 'incomplete', metadata: { plan: 'premium' } }], owner),
    null
  );
});

test('uniqueStripeObjects drops duplicate ids', () => {
  assert.deepEqual(
    uniqueStripeObjects([{ id: 'a' }, { id: 'a' }, { id: 'b' }]).map((item) => item.id),
    ['a', 'b']
  );
});
