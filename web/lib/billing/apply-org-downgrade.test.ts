import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orgIsPaid } from '../org-plan.ts';
import {
  applyBillingSubscriptionEvent,
  resolveAnchoredOrganization,
  subscriptionIdFromInvoice,
} from './apply-org-downgrade.ts';
import {
  ledgerStatusForStripe,
  persistPaidOrgUpgrade,
  subscriptionTypeFromRecurringInterval,
} from './persist-org-upgrade.ts';
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
  id?: string | number;
  organization_id: number | null;
  user_id: string;
  stripe_subscription_id: string | null;
  status: string;
  tier: string;
  platform?: string | null;
  subscription_type?: string | null;
  stripe_price_id?: string | null;
  stripe_product_id?: string | null;
};

type Membership = { user_id: string; organization_id: number };

type State = {
  orgs: Org[];
  subs: Sub[];
  customers: { id?: string; user_id: string; stripe_customer_id: string; email?: string | null }[];
  profiles: { id: string; organization_id: number }[];
  memberships: Membership[];
  orgWrites: Record<string, unknown>[];
  subscriptionWrites: Record<string, unknown>[];
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
        id: 1,
        organization_id: 42,
        user_id: 'user-1',
        stripe_subscription_id: 'sub_paid',
        status: 'active',
        tier: 'premium',
        platform: 'stripe',
      },
    ],
    customers: [{ id: 'cus-row-1', user_id: 'user-1', stripe_customer_id: 'cus_paid' }],
    profiles: [{ id: 'user-1', organization_id: 42 }],
    memberships: [{ user_id: 'user-1', organization_id: 42 }],
    orgWrites: [],
    subscriptionWrites: [],
  };
}

function sameFilter(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

function writerFor(state: State) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;
      const matches = (row: Record<string, unknown>) =>
        Object.entries(filters).every(([col, val]) => sameFilter(row[col], val));
      const run = () => {
        if (table === 'organizations') {
          const rows = state.orgs.filter((row) => matches(row as unknown as Record<string, unknown>));
          if (op === 'update' && payload) {
            for (const org of rows) {
              Object.assign(org, payload);
              state.orgWrites.push({ ...payload });
            }
          }
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (table === 'subscriptions') {
          if (op === 'insert' && payload) {
            const row = { id: state.subs.length + 1, ...payload } as Sub;
            state.subs.push(row);
            state.subscriptionWrites.push({ ...payload });
            return { data: [{ ...row }], error: null };
          }
          const rows = state.subs.filter((row) => matches(row as unknown as Record<string, unknown>));
          if (op === 'update' && payload) {
            for (const sub of rows) {
              Object.assign(sub, payload);
              state.subscriptionWrites.push({ ...payload });
            }
          }
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (table === 'stripe_customers') {
          if (op === 'insert' && payload) {
            const row = { id: `cus-row-${state.customers.length + 1}`, ...payload } as State['customers'][number];
            state.customers.push(row);
            return { data: [{ ...row }], error: null };
          }
          const rows = state.customers.filter((row) => matches(row as unknown as Record<string, unknown>));
          if (op === 'update' && payload) {
            for (const cus of rows) Object.assign(cus, payload);
          }
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (table === 'organization_memberships') {
          const rows = state.memberships.filter((row) => matches(row as unknown as Record<string, unknown>));
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        if (table === 'user_profiles') {
          const rows = state.profiles.filter((row) => matches(row as unknown as Record<string, unknown>));
          return { data: rows.map((row) => ({ ...row })), error: null };
        }
        return { data: [], error: null };
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
        or() {
          return api;
        },
        maybeSingle: async () => {
          const result = run();
          const row = result.data[0] || null;
          return { data: row, error: result.error };
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(onFulfilled, onRejected);
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
  assert.equal(state.subs[0].status, 'cancelled');
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
    assert.equal(state.subs[0].status, status === 'canceled' ? 'cancelled' : 'expired', status);
    assert.equal(state.subs[0].tier, 'free', status);
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
  assert.equal(state.subs[0].status, 'grace_period');
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

test('ledger status maps onto the subscriptions check constraint', () => {
  assert.equal(ledgerStatusForStripe('active'), 'active');
  assert.equal(ledgerStatusForStripe('trialing'), 'active');
  assert.equal(ledgerStatusForStripe('canceled'), 'cancelled');
  assert.equal(ledgerStatusForStripe('cancelled'), 'cancelled');
  assert.equal(ledgerStatusForStripe('unpaid'), 'expired');
  assert.equal(ledgerStatusForStripe('incomplete_expired'), 'expired');
  assert.equal(ledgerStatusForStripe('past_due'), 'grace_period');
  assert.equal(ledgerStatusForStripe('incomplete'), null);
  assert.equal(subscriptionTypeFromRecurringInterval('month'), 'monthly');
  assert.equal(subscriptionTypeFromRecurringInterval('year'), 'yearly');
  assert.equal(subscriptionTypeFromRecurringInterval('week'), null);
});

test('a trialing upgrade stores an active monthly or yearly Stripe ledger row', async () => {
  const state = billingState();
  await persistPaidOrgUpgrade({
    writer: writerFor(state) as never,
    organizationId: '42',
    userId: 'user-1',
    plan: 'premium',
    sku: 'premium_monthly',
    customerId: 'cus_paid',
    subscriptionId: 'sub_paid',
    stripeStatus: 'trialing',
    stripeRecord: {
      items: {
        data: [
          {
            price: {
              id: 'price_month',
              product: 'prod_premium',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    },
  });
  assert.equal(state.subs[0].status, 'active');
  assert.equal(state.subs[0].platform, 'stripe');
  assert.equal(state.subs[0].subscription_type, 'monthly');
  assert.equal(state.subs[0].stripe_subscription_id, 'sub_paid');
  assert.equal(state.subs[0].stripe_price_id, 'price_month');
  assert.equal(state.subs[0].stripe_product_id, 'prod_premium');
  assert.equal(state.subs[0].organization_id, 42);
  assert.equal(state.orgs[0].plan, 'premium');
});

test('a non-Stripe subscription row is not overwritten', async () => {
  const state = billingState();
  state.subs[0].platform = 'google_play';
  state.subs[0].stripe_subscription_id = null;
  state.subs[0].subscription_type = 'monthly';
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    await persistPaidOrgUpgrade({
      writer: writerFor(state) as never,
      organizationId: '42',
      userId: 'user-1',
      plan: 'premium',
      sku: 'premium_yearly',
      customerId: 'cus_paid',
      subscriptionId: 'sub_new',
      stripeStatus: 'active',
      stripeRecord: {
        items: { data: [{ price: { id: 'price_year', product: 'prod_premium', recurring: { interval: 'year' } } }] },
      },
    });
  } finally {
    console.error = original;
  }
  assert.equal(state.subs[0].platform, 'google_play');
  assert.equal(state.subs[0].stripe_subscription_id, null);
  assert.equal(state.subs.length, 1);
  assert.equal(state.orgs[0].is_premium, true);
  assert.ok(logs.some((args) => String(args[0]).includes('non-Stripe row')));
});

test('a subscription ledger write error is logged and thrown', async () => {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  const client = {
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        update() {
          return api;
        },
        insert() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') return { data: { id: 42 }, error: null };
          if (table === 'subscriptions') return { data: null, error: null };
          if (table === 'stripe_customers') return { data: { id: 'cus-row' }, error: null };
          return { data: null, error: null };
        },
        then(onFulfilled: (value: unknown) => unknown) {
          if (table === 'subscriptions') {
            return Promise.resolve({ data: null, error: { message: 'check violation', code: '23514' } }).then(onFulfilled);
          }
          return Promise.resolve({ data: null, error: null }).then(onFulfilled);
        },
      };
      return api;
    },
  };
  try {
    await assert.rejects(
      () =>
        persistPaidOrgUpgrade({
          writer: client as never,
          organizationId: '42',
          userId: 'user-1',
          plan: 'premium',
          sku: 'premium_monthly',
          customerId: 'cus_paid',
          subscriptionId: 'sub_paid',
          stripeStatus: 'active',
        }),
      /check violation/
    );
    assert.ok(logs.some((args) => String(args[0]).includes('subscription ledger insert failed')));
  } finally {
    console.error = original;
  }
});

test('a payer who moved home org downgrades the paid org and leaves the new org untouched', async () => {
  const state = billingState();
  state.orgs.push(paidOrg({ id: 88, name: 'New Home' }));
  state.profiles[0].organization_id = 88;
  state.memberships = [
    { user_id: 'user-1', organization_id: 42 },
    { user_id: 'user-1', organization_id: 88 },
  ];
  const { result } = await runEvent(state, 'customer.subscription.deleted', 'canceled', []);
  assert.equal(result.body.downgraded, true);
  assert.equal(result.body.organizationId, '42');
  assertFree(state.orgs[0], state.orgWrites.at(-1));
  assert.equal(state.orgs[1].id, 88);
  assert.equal(state.orgs[1].is_premium, true);
  assert.equal(state.orgs[1].plan, 'premium');
  assert.equal(state.orgs[1].subscription_tier, 'premium');
  assert.equal(state.orgWrites.length, 1);
});

test('no subscription anchor makes no plan change', async () => {
  const state = billingState();
  state.subs[0].organization_id = null;
  state.profiles[0].organization_id = 88;
  state.memberships = [];
  const { result } = await runEvent(state, 'customer.subscription.deleted', 'canceled', [], { metadataOrg: '' });
  assert.equal(result.body.downgraded, undefined);
  assert.equal(result.body.ignored, 'no_stripe_link');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgWrites.length, 0);
});

test('metadata naming an org the user is not a member of makes no plan change', async () => {
  const state = billingState();
  state.subs[0].organization_id = null;
  state.profiles[0].organization_id = 42;
  state.memberships = [{ user_id: 'user-1', organization_id: 7 }];
  const { result } = await runEvent(state, 'customer.subscription.deleted', 'canceled', []);
  assert.equal(result.body.ignored, 'not_a_member');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgWrites.length, 0);
  assert.equal(
    resolveAnchoredOrganization({
      storedOrganizationId: '42',
      metadataOrganizationId: '88',
      memberOrganizationIds: new Set(['42', '88']),
      userId: 'user-1',
    }).reason,
    'anchor_mismatch'
  );
});

test('stored organization and metadata that disagree make no plan change', async () => {
  const state = billingState();
  state.orgs.push(paidOrg({ id: 88, name: 'Other Shop' }));
  state.memberships = [
    { user_id: 'user-1', organization_id: 42 },
    { user_id: 'user-1', organization_id: 88 },
  ];
  const { result } = await runEvent(state, 'customer.subscription.deleted', 'canceled', [], { metadataOrg: '88' });
  assert.equal(result.body.ignored, 'anchor_mismatch');
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgs[1].plan, 'premium');
  assert.equal(state.orgWrites.length, 0);
});

test('ending one payer keeps Premium while another subscription for the org is live', async () => {
  const state = billingState();
  state.subs.push({
    id: 2,
    organization_id: 42,
    user_id: 'user-2',
    stripe_subscription_id: 'sub_other',
    status: 'active',
    tier: 'premium',
    platform: 'stripe',
  });
  state.customers.push({ id: 'cus-row-2', user_id: 'user-2', stripe_customer_id: 'cus_other' });
  state.memberships.push({ user_id: 'user-2', organization_id: 42 });
  const listed: string[] = [];
  const result = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: { type: 'customer.subscription.deleted', data: { object: { id: 'sub_paid' } } },
    retrieveSubscription: async () => paidSub('canceled') as never,
    listLiveSubscriptions: async (customerId: string) => {
      listed.push(customerId);
      if (customerId === 'cus_other') return [{ id: 'sub_other', status: 'active' }];
      return [];
    },
  });
  assert.equal(result.body.ignored, 'live_subscription_remains');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgWrites.length, 0);
  assert.ok(listed.includes('cus_paid'));
  assert.ok(listed.includes('cus_other'));
});

test('a deleted event replayed after a newer active subscription exists for the org makes no change', async () => {
  const state = billingState();
  const first = await runEvent(state, 'customer.subscription.deleted', 'canceled', []);
  assert.equal(first.result.body.downgraded, true);
  assert.equal(state.orgs[0].plan, 'free');
  state.subs.push({
    id: 3,
    organization_id: 42,
    user_id: 'user-2',
    stripe_subscription_id: 'sub_new',
    status: 'active',
    tier: 'premium',
    platform: 'stripe',
  });
  state.customers.push({ id: 'cus-row-2', user_id: 'user-2', stripe_customer_id: 'cus_new' });
  state.memberships.push({ user_id: 'user-2', organization_id: 42 });
  state.orgs[0].is_premium = true;
  state.orgs[0].plan = 'premium';
  state.orgs[0].subscription_tier = 'premium';
  const writes = state.orgWrites.length;
  const replay = await applyBillingSubscriptionEvent({
    writer: writerFor(state) as never,
    event: { type: 'customer.subscription.deleted', data: { object: { id: 'sub_paid' } } },
    retrieveSubscription: async (subscriptionId: string) => {
      if (subscriptionId === 'sub_new') {
        return {
          id: 'sub_new',
          status: 'active',
          customer: 'cus_new',
          metadata: { kind: 'org_plan', organization_id: '42', plan: 'premium', sku: 'premium_monthly' },
        } as never;
      }
      return paidSub('canceled') as never;
    },
    listLiveSubscriptions: async (customerId: string) => {
      if (customerId === 'cus_new') return [{ id: 'sub_new', status: 'active' }];
      return [];
    },
  });
  assert.equal(replay.body.ignored, 'live_subscription_remains');
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.orgs[0].subscription_tier, 'premium');
  assert.equal(state.orgWrites.length, writes);
});

test('upgrade webhook wires the downgrade events to the subscription list', () => {
  const src = readFileSync(join(here, '../../app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  assert.match(src, /customer\.subscription\.deleted/);
  assert.match(src, /invoice\.payment_failed/);
  assert.match(src, /listLiveSubscriptionsForCustomer/);
  assert.match(src, /applyBillingSubscriptionEvent/);
  assert.match(src, /applyPaidCheckoutSession/);
});
