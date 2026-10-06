import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgIsPaid } from '../org-plan.ts';
import { applyBillingSubscriptionEvent, subscriptionIdFromInvoice } from './apply-org-downgrade.ts';
import { orgFreePlanFields } from './upgrade-session.ts';

const here = dirname(fileURLToPath(import.meta.url));

type Org = {
  id: number;
  name: string;
  is_premium: boolean;
  plan: string;
  subscription_tier: string;
  premium_until: string | null;
  premium_grant: string | null;
  manual_slots: number;
};

type Sub = {
  organization_id: number;
  user_id: string;
  stripe_subscription_id: string;
  status: string;
  tier: string;
};

type State = {
  orgs: Org[];
  subs: Sub[];
  customers: { user_id: string; stripe_customer_id: string }[];
  profiles: { id: string; organization_id: number }[];
  orgWrites: Record<string, unknown>[];
};

function paidOrg(over: Partial<Org> = {}): Org {
  return {
    id: 42,
    name: 'Paid Shop',
    is_premium: true,
    plan: 'premium',
    subscription_tier: 'premium',
    premium_until: null,
    premium_grant: null,
    manual_slots: 15,
    ...over,
  };
}

function compOrg(): Org {
  return {
    id: 7,
    name: 'Comp Shop',
    is_premium: true,
    plan: 'premium',
    subscription_tier: 'premium',
    premium_until: '2027-04-01T00:00:00.000Z',
    premium_grant: 'complimentary_signup',
    manual_slots: 15,
  };
}

function billingState(opts?: { comp?: boolean; premiumUntil?: string | null }): State {
  const org = paidOrg(opts?.premiumUntil ? { premium_until: opts.premiumUntil } : {});
  return {
    orgs: opts?.comp ? [compOrg(), org] : [org],
    subs: [
      {
        organization_id: 42,
        user_id: 'user-1',
        stripe_subscription_id: 'sub_paid',
        status: 'active',
        tier: 'premium',
      },
    ],
    customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_paid' }],
    profiles: [{ id: 'user-1', organization_id: 42 }],
    orgWrites: [],
  };
}

function writerFor(state: State) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
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
          return api;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return api;
        },
        or() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') {
            const org = state.orgs.find((row) => String(row.id) === String(filters.id));
            if (op === 'update') {
              if (!org || !payload) return { data: null, error: null };
              Object.assign(org, payload);
              state.orgWrites.push({ ...payload });
              return { data: { id: org.id }, error: null };
            }
            return { data: org ? { ...org } : null, error: null };
          }
          if (table === 'subscriptions') {
            const sub = state.subs.find((row) => {
              if (
                filters.stripe_subscription_id != null &&
                row.stripe_subscription_id !== filters.stripe_subscription_id
              ) {
                return false;
              }
              if (filters.user_id != null && row.user_id !== filters.user_id) return false;
              return filters.stripe_subscription_id != null || filters.user_id != null;
            });
            if (op === 'update' && sub && payload) Object.assign(sub, payload);
            return { data: sub ? { ...sub } : null, error: null };
          }
          if (table === 'stripe_customers') {
            const cus = state.customers.find((row) => {
              if (filters.stripe_customer_id != null && row.stripe_customer_id !== filters.stripe_customer_id) {
                return false;
              }
              if (filters.user_id != null && row.user_id !== filters.user_id) return false;
              return filters.stripe_customer_id != null || filters.user_id != null;
            });
            return { data: cus ? { ...cus } : null, error: null };
          }
          if (table === 'user_profiles') {
            const profile = state.profiles.find((row) => row.id === filters.id);
            return { data: profile ? { ...profile } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
}

function paidSub(status: string, metadataOrg = '42') {
  return {
    id: 'sub_paid',
    status,
    customer: 'cus_paid',
    metadata: {
      kind: 'org_plan',
      organization_id: metadataOrg,
      user_id: 'user-1',
      sku: 'premium_monthly',
      plan: 'premium',
    },
  };
}

async function runEvent(
  state: State,
  eventType: string,
  status: string,
  list: { id?: string; status?: string | null }[],
  opts?: { object?: Record<string, unknown>; metadataOrg?: string }
) {
  const listCalls: string[] = [];
  const result = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: {
      type: eventType,
      data: { object: opts?.object || { id: 'sub_paid', status } },
    },
    retrieveSubscription: async () => paidSub(status, opts?.metadataOrg ?? '42') as never,
    listLiveSubscriptions: async (customerId: string) => {
      listCalls.push(customerId);
      return list;
    },
  });
  return { result, listCalls };
}

function assertFree(org: Org, write: Record<string, unknown> | undefined) {
  const free = orgFreePlanFields();
  assert.equal(org.is_premium, false);
  assert.equal(org.plan, 'free');
  assert.equal(org.subscription_tier, 'free');
  assert.equal(org.manual_slots, free.manual_slots);
  assert.equal(orgIsPaid(org), false);
  assert.ok(write);
  assert.equal(write?.is_premium, false);
  assert.equal(write?.plan, 'free');
  assert.equal(write?.subscription_tier, 'free');
  assert.equal('premium_until' in (write || {}), false);
  assert.equal('premium_grant' in (write || {}), false);
}

test('subscription.deleted downgrades a Stripe-linked org to Free', async () => {
  const state = billingState();
  const first = await runEvent(state, 'customer.subscription.deleted', 'canceled', []);
  assert.equal(first.result.httpStatus, 200);
  assert.equal(first.result.body.downgraded, true);
  assert.equal(first.result.body.plan, 'free');
  assert.equal(first.result.body.organizationId, '42');
  assert.deepEqual(first.listCalls, ['cus_paid']);
  assertFree(state.orgs[0], state.orgWrites.at(-1));
  assert.equal(state.subs[0].status, 'canceled');
  assert.equal(state.subs[0].tier, 'free');

  const replay = await runEvent(state, 'customer.subscription.deleted', 'canceled', []);
  assert.equal(replay.result.body.downgraded, true);
  assert.equal(state.orgs[0].plan, 'free');
  assert.equal(state.orgs[0].is_premium, false);

  state.orgs[0].is_premium = true;
  state.orgs[0].plan = 'premium';
  state.orgs[0].subscription_tier = 'premium';
  const viaStoredId = await runEvent(state, 'customer.subscription.deleted', 'canceled', [], {
    metadataOrg: '',
  });
  assert.equal(viaStoredId.result.body.downgraded, true);
  assert.equal(state.orgs[0].subscription_tier, 'free');
});

test('updated to canceled, unpaid, or incomplete_expired downgrades', async () => {
  for (const status of ['canceled', 'unpaid', 'incomplete_expired']) {
    const state = billingState({
      premiumUntil: status === 'canceled' ? '2027-06-01T00:00:00.000Z' : null,
    });
    const { result } = await runEvent(state, 'customer.subscription.updated', status, []);
    assert.equal(result.body.downgraded, true, status);
    assert.equal(result.body.plan, 'free', status);
    assertFree(state.orgs[0], state.orgWrites.at(-1));
    if (status === 'canceled') {
      assert.equal(state.orgs[0].premium_until, '2027-06-01T00:00:00.000Z');
      assert.equal(orgIsPaid(state.orgs[0]), false);
    }
  }
});

test('updated to past_due does not downgrade', async () => {
  const state = billingState();
  const { result, listCalls } = await runEvent(state, 'customer.subscription.updated', 'past_due', []);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.handled, true);
  assert.equal(result.body.downgraded, false);
  assert.equal(result.body.ignored, undefined);
  assert.deepEqual(listCalls, []);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgs[0].subscription_tier, 'premium');
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.subs[0].status, 'active');
  assert.equal(state.subs[0].tier, 'premium');
});

test('invoice.payment_failed logs and does not downgrade', async () => {
  const state = billingState();
  const logs: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    const { result, listCalls } = await runEvent(
      state,
      'invoice.payment_failed',
      'active',
      [{ id: 'sub_paid', status: 'active' }],
      {
        object: {
          id: 'in_failed',
          customer: 'cus_paid',
          subscription: 'sub_paid',
          attempt_count: 2,
        },
      }
    );
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.handled, true);
    assert.equal(result.body.logged, true);
    assert.equal(result.body.downgraded, false);
    assert.equal(result.body.ignored, undefined);
    assert.equal(result.body.organizationId, '42');
    assert.equal(result.body.subscriptionId, 'sub_paid');
    assert.equal(result.body.attemptCount, 2);
    assert.deepEqual(listCalls, []);
    assert.equal(state.orgs[0].is_premium, true);
    assert.equal(state.orgs[0].plan, 'premium');
    assert.equal(state.orgs[0].subscription_tier, 'premium');
    assert.equal(state.orgWrites.length, 0);
    assert.equal(state.subs[0].status, 'active');
    assert.equal(state.subs[0].tier, 'premium');
    const entry = logs.find((args) => args[0] === '[billing] invoice.payment_failed');
    assert.ok(entry);
    assert.deepEqual(entry?.[1], {
      organizationId: '42',
      subscriptionId: 'sub_paid',
      attemptCount: 2,
    });
  } finally {
    console.info = original;
  }
});

test('a second live subscription prevents the downgrade', async () => {
  const state = billingState();
  const { result } = await runEvent(state, 'customer.subscription.updated', 'canceled', [
    { id: 'sub_paid', status: 'canceled' },
    { id: 'sub_team', status: 'trialing' },
  ]);
  assert.equal(result.body.downgraded, undefined);
  assert.equal(result.body.ignored, 'live_subscription_remains');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgs[0].subscription_tier, 'premium');
  assert.equal(state.orgWrites.length, 0);

  const deleted = await runEvent(state, 'customer.subscription.deleted', 'canceled', [
    { id: 'sub_other', status: 'active' },
  ]);
  assert.equal(deleted.result.body.ignored, 'live_subscription_remains');
  assert.equal(state.orgs[0].is_premium, true);
});

test('a complimentary org is not downgraded by an unrelated event', async () => {
  const state = billingState({ comp: true });
  const comp = state.orgs[0];
  assert.equal(comp.premium_grant, 'complimentary_signup');

  const unrelated = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_other', status: 'canceled' } },
    },
    retrieveSubscription: async () =>
      ({
        id: 'sub_other',
        status: 'canceled',
        customer: 'cus_other',
        metadata: { kind: 'org_plan', organization_id: '99', plan: 'premium', sku: 'premium_monthly' },
      }) as never,
    listLiveSubscriptions: async () => [],
  });
  assert.equal(unrelated.body.ignored, 'no_stripe_link');
  assert.equal(comp.is_premium, true);
  assert.equal(comp.plan, 'premium');
  assert.equal(comp.premium_until, '2027-04-01T00:00:00.000Z');
  assert.equal(state.orgs[1].is_premium, true);
  assert.equal(state.orgWrites.length, 0);

  const namesCompOrg = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_other', status: 'canceled' } },
    },
    retrieveSubscription: async () =>
      ({
        id: 'sub_other',
        status: 'canceled',
        customer: 'cus_other',
        metadata: { kind: 'org_plan', organization_id: '7', plan: 'premium', sku: 'premium_monthly' },
      }) as never,
    listLiveSubscriptions: async () => [],
  });
  assert.equal(namesCompOrg.body.ignored, 'no_stripe_link');
  assert.equal(comp.is_premium, true);
  assert.equal(comp.subscription_tier, 'premium');

  state.subs.push({
    organization_id: 7,
    user_id: 'user-comp',
    stripe_subscription_id: 'sub_comp',
    status: 'active',
    tier: 'premium',
  });
  state.customers.push({ user_id: 'user-comp', stripe_customer_id: 'cus_comp' });
  state.profiles.push({ id: 'user-comp', organization_id: 7 });
  const linkedGrant = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: { type: 'customer.subscription.deleted', data: { object: { id: 'sub_comp' } } },
    retrieveSubscription: async () =>
      ({
        id: 'sub_comp',
        status: 'canceled',
        customer: 'cus_comp',
        metadata: { kind: 'org_plan', organization_id: '7', plan: 'premium', sku: 'premium_monthly' },
      }) as never,
    listLiveSubscriptions: async () => [],
  });
  assert.equal(linkedGrant.body.ignored, 'complimentary');
  assert.equal(comp.is_premium, true);
  assert.equal(comp.plan, 'premium');
  assert.equal(comp.premium_grant, 'complimentary_signup');
  assert.equal(state.orgWrites.length, 0);
});

test('updated to active still upgrades', async () => {
  const state = billingState();
  state.orgs[0].is_premium = false;
  state.orgs[0].plan = 'free';
  state.orgs[0].subscription_tier = 'free';
  state.orgs[0].manual_slots = 5;
  let listed = false;
  const result = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_paid', status: 'canceled' } },
    },
    retrieveSubscription: async () => paidSub('active') as never,
    listLiveSubscriptions: async () => {
      listed = true;
      return [];
    },
  });
  assert.equal(listed, false);
  assert.equal(result.body.applied, true);
  assert.equal(result.body.plan, 'premium');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgs[0].subscription_tier, 'premium');
  assert.equal(state.orgs[0].premium_until, null);
  assert.equal(state.orgs[0].premium_grant, null);
});

test('invoice subscription id is read from the invoice or its parent', () => {
  assert.equal(subscriptionIdFromInvoice({ subscription: 'sub_paid' }), 'sub_paid');
  assert.equal(
    subscriptionIdFromInvoice({
      parent: { subscription_details: { subscription: 'sub_parent' } },
    }),
    'sub_parent'
  );
  assert.equal(subscriptionIdFromInvoice({ id: 'in_only' }), null);
});

test('upgrade webhook wires the downgrade events to the subscription list', () => {
  const src = readFileSync(join(here, '../../app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  assert.match(src, /customer\.subscription\.deleted/);
  assert.match(src, /invoice\.payment_failed/);
  assert.match(src, /listLiveSubscriptionsForCustomer/);
  assert.match(src, /applyBillingSubscriptionEvent/);
  assert.match(src, /applyPaidCheckoutSession/);
});
