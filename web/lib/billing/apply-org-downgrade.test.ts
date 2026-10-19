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
import { runPastDueSweep } from './past-due-sweep.ts';
import { resetPastDueDisabledWarning } from './past-due.ts';
import { isStripeResourceMissing, retrieveStripeSubscription, StripeSubscriptionError } from './stripe-subscription.ts';

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
  past_due_since?: string | null;
  past_due_checked_at?: string | null;
  updated_at?: string | null;
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
  /** Database clock for the emulated 000928 trigger. */
  dbNow?: string;
  /** Emulate 000928 not applied: any read of past_due_since errors. */
  noPastDueColumn?: boolean;
};

/**
 * In-memory copy of the 000928 trigger subscriptions_past_due_clock (the SQL
 * proof covers the real one). A supplied past_due_since is never accepted:
 * grace_period keeps the clock of the same subscription id or starts it at
 * the database time, active clears it, any other status keeps the previous
 * clock of the same id (none on an insert or a new id). past_due_checked_at
 * is dropped whenever the clock is empty or changes.
 */
function emulatePastDueClock(state: State, row: Sub, before: Sub | null) {
  if (state.noPastDueColumn) return;
  const id = String(row.stripe_subscription_id || '');
  const sameSub = before != null && before.stripe_subscription_id === row.stripe_subscription_id;
  const prior = sameSub ? before?.past_due_since ?? null : null;
  if (!id.startsWith('sub_')) row.past_due_since = null;
  else if (row.status === 'active') row.past_due_since = null;
  else if (row.status === 'grace_period') row.past_due_since = prior || state.dbNow || new Date().toISOString();
  else row.past_due_since = prior;
  if (row.past_due_since == null || (before != null && row.past_due_since !== (before.past_due_since ?? null))) {
    row.past_due_checked_at = null;
  }
}

/** Minimal PostgREST or() parser for the filters the code sends. */
function parseOrFilter(expr: string): (row: Record<string, unknown>) => boolean {
  const parts = expr.split(/,(?=[a-z_]+\.)/);
  const tests = parts.map((part) => {
    const match = /^([a-z_]+)\.(is|lte|eq)\.(.*)$/.exec(part);
    assert.ok(match, `unsupported or() part ${part}`);
    const [, col, operator, rawValue] = match;
    const value = rawValue.replace(/^"(.*)"$/, '$1');
    if (operator === 'is') {
      assert.equal(value, 'null');
      return (row: Record<string, unknown>) => row[col] == null;
    }
    if (operator === 'lte') {
      return (row: Record<string, unknown>) => row[col] != null && Date.parse(String(row[col])) <= Date.parse(value);
    }
    return (row: Record<string, unknown>) => sameFilter(row[col], value);
  });
  return (row) => tests.some((fn) => fn(row));
}

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
      const extra: Array<(row: Record<string, unknown>) => boolean> = [];
      let selected = '';
      let limitTo: number | null = null;
      const orders: { col: string; ascending: boolean; nullsFirst: boolean }[] = [];
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;
      const matches = (row: Record<string, unknown>) =>
        Object.entries(filters).every(([col, val]) => sameFilter(row[col], val)) && extra.every((fn) => fn(row));
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
          if (
            state.noPastDueColumn &&
            (/past_due_(since|checked_at)/.test(selected) || extra.length > 0 || 'past_due_since' in filters)
          ) {
            return { data: [], error: { message: 'column subscriptions.past_due_since does not exist' } };
          }
          if (op === 'insert' && payload) {
            const row = { id: state.subs.length + 1, ...payload } as Sub;
            emulatePastDueClock(state, row, null);
            state.subs.push(row);
            state.subscriptionWrites.push({ ...payload });
            return { data: [{ ...row }], error: null };
          }
          let rows = state.subs.filter((row) => matches(row as unknown as Record<string, unknown>));
          if (op === 'update' && payload) {
            for (const sub of rows) {
              const before = { ...sub };
              Object.assign(sub, payload);
              emulatePastDueClock(state, sub, before);
              state.subscriptionWrites.push({ ...payload });
            }
          }
          if (orders.length > 0) {
            rows = [...rows].sort((a, b) => {
              for (const o of orders) {
                const av = (a as Record<string, unknown>)[o.col];
                const bv = (b as Record<string, unknown>)[o.col];
                if (av == null && bv == null) continue;
                if (av == null) return o.nullsFirst ? -1 : 1;
                if (bv == null) return o.nullsFirst ? 1 : -1;
                const diff = Date.parse(String(av)) - Date.parse(String(bv));
                if (diff !== 0) return o.ascending ? diff : -diff;
              }
              return 0;
            });
          }
          if (limitTo != null) rows = rows.slice(0, limitTo);
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
        select(columns?: string) {
          if (typeof columns === 'string') selected = columns;
          return api;
        },
        neq(col: string, val: unknown) {
          extra.push((row) => !sameFilter(row[col], val));
          return api;
        },
        lte(col: string, val: string) {
          extra.push((row) => row[col] != null && Date.parse(String(row[col])) <= Date.parse(val));
          return api;
        },
        not(col: string, operator: string, val: unknown) {
          assert.equal(operator, 'is');
          assert.equal(val, null);
          extra.push((row) => row[col] != null);
          return api;
        },
        order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
          const ascending = opts?.ascending !== false;
          // PostgREST default: nulls last when ascending, first when descending.
          orders.push({ col, ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
          return api;
        },
        limit(n: number) {
          limitTo = n;
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
        or(expr: string) {
          if (table === 'subscriptions') extra.push(parseOrFilter(expr));
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

const FAILED_INVOICE = { id: 'in_failed', customer: 'cus_paid', subscription: 'sub_paid', attempt_count: 4 };

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.info;
  console.info = () => {};
  try {
    return await fn();
  } finally {
    console.info = original;
  }
}

test('invoice.payment_failed downgrades when the retrieved subscription is unpaid, canceled, or incomplete_expired', async () => {
  for (const status of ['unpaid', 'canceled', 'incomplete_expired']) {
    const state = billingState();
    const { result, listCalls } = await quietly(() =>
      runEvent(state, 'invoice.payment_failed', status, [], { object: FAILED_INVOICE })
    );
    assert.equal(result.httpStatus, 200, status);
    assert.equal(result.body.downgraded, true, status);
    assert.equal(result.body.plan, 'free', status);
    assert.equal(result.body.organizationId, '42', status);
    assert.equal(result.body.trigger, 'invoice.payment_failed', status);
    assert.equal(result.body.status, status, status);
    assert.equal(result.body.attemptCount, 4, status);
    assert.deepEqual(listCalls, ['cus_paid'], status);
    assertFree(state.orgs[0], state.orgWrites.at(-1));
    assert.equal(state.subs[0].status, status === 'canceled' ? 'cancelled' : 'expired', status);
    assert.equal(state.subs[0].tier, 'free', status);
  }
});

test('invoice.payment_failed leaves active, trialing and incomplete on Premium with no write', async () => {
  for (const status of ['active', 'trialing', 'incomplete']) {
    const state = billingState();
    const { result, listCalls } = await quietly(() =>
      runEvent(state, 'invoice.payment_failed', status, [], { object: FAILED_INVOICE })
    );
    assert.equal(result.httpStatus, 200, status);
    assert.equal(result.body.downgraded, false, status);
    assert.equal(result.body.logged, true, status);
    assert.deepEqual(listCalls, [], status);
    assert.equal(state.orgWrites.length, 0, status);
    assert.equal(state.subscriptionWrites.length, 0, status);
    assert.equal(state.orgs[0].is_premium, true, status);
    assert.equal(state.subs[0].status, 'active', status);
  }
});

test('invoice.payment_failed keeps every downgrade guard: live subscription, complimentary, unanchored', async () => {
  const live = billingState();
  const kept = await quietly(() =>
    runEvent(live, 'invoice.payment_failed', 'unpaid', [{ id: 'sub_other', status: 'active' }], { object: FAILED_INVOICE })
  );
  assert.equal(kept.result.body.downgraded, undefined);
  assert.equal(kept.result.body.ignored, 'live_subscription_remains');
  assert.equal(live.orgWrites.length, 0);

  const comp = billingState();
  comp.orgs[0].premium_grant = 'complimentary_god';
  const compResult = await quietly(() =>
    runEvent(comp, 'invoice.payment_failed', 'canceled', [], { object: FAILED_INVOICE })
  );
  assert.equal(compResult.result.body.ignored, 'complimentary');
  assert.equal(comp.orgWrites.length, 0);

  const loose = billingState();
  loose.subs = [];
  loose.memberships = [];
  const looseResult = await quietly(() =>
    runEvent(loose, 'invoice.payment_failed', 'unpaid', [], { object: FAILED_INVOICE })
  );
  assert.equal(looseResult.result.body.ignored, 'not_a_member');
  assert.equal(loose.orgWrites.length, 0);
});

test('invoice.payment_failed with no subscription is logged only; a failed retrieve throws so Stripe retries', async () => {
  const state = billingState();
  const noSub = await quietly(() =>
    runEvent(state, 'invoice.payment_failed', 'unpaid', [], { object: { id: 'in_one_off', customer: 'cus_paid' } })
  );
  assert.equal(noSub.result.body.downgraded, false);
  assert.equal(noSub.result.body.subscriptionId, null);
  assert.equal(state.orgWrites.length, 0);

  await assert.rejects(
    applyBillingSubscriptionEvent({
      writer: writerFor(state) as never,
      event: { type: 'invoice.payment_failed', data: { object: FAILED_INVOICE } },
      retrieveSubscription: async () => {
        throw new Error('stripe unavailable');
      },
      listLiveSubscriptions: async () => [],
    }),
    /stripe unavailable/
  );
  assert.equal(state.orgWrites.length, 0);
});

test('a fresh past_due still keeps Premium; the immediate-downgrade set is unchanged (past_due is not in it)', async () => {
  const state = billingState();
  const { result } = await runEvent(state, 'customer.subscription.updated', 'past_due', []);
  assert.equal(result.body.downgraded, false);
  assert.equal(state.subs[0].status, 'grace_period');
  assert.equal(state.orgs[0].is_premium, true);
  const src = readFileSync(join(here, './apply-org-downgrade.ts'), 'utf8');
  assert.match(src, /const SUBSCRIPTION_DOWNGRADE_STATUSES = new Set\(\['canceled', 'unpaid', 'incomplete_expired'\]\);/);
});

// ---- 000924 billing low: permanent "No such subscription" on retrieve ----

function missingSubscriptionError() {
  return new StripeSubscriptionError("No such subscription: 'sub_paid'", 400, {
    stripeCode: 'resource_missing',
    stripeHttpStatus: 404,
  });
}

test('invoice.payment_failed: a permanent resource_missing on retrieve logs and returns 200, no writes', async () => {
  const state = billingState();
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const result = await applyBillingSubscriptionEvent({
      writer: writerFor(state) as never,
      event: { type: 'invoice.payment_failed', data: { object: FAILED_INVOICE } },
      retrieveSubscription: async () => {
        throw missingSubscriptionError();
      },
      listLiveSubscriptions: async () => [],
    });
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.downgraded, false);
    assert.equal(result.body.ignored, 'subscription_missing');
    assert.equal(result.body.subscriptionId, 'sub_paid');
    assert.equal(result.body.attemptCount, 4);
    assert.equal(state.orgWrites.length, 0);
    assert.equal(state.subscriptionWrites.length, 0);
    assert.equal(state.orgs[0].is_premium, true);
    assert.ok(warnings.some((args) => args[0] === '[billing] invoice.payment_failed subscription missing in Stripe'));
  } finally {
    console.warn = original;
  }
});

test('invoice.payment_failed: transient retrieve errors still throw so Stripe retries', async () => {
  const transient: unknown[] = [
    new StripeSubscriptionError('Stripe is down', 502, { stripeCode: null, stripeHttpStatus: 500 }),
    new StripeSubscriptionError('Too many requests', 400, { stripeCode: 'rate_limit', stripeHttpStatus: 429 }),
    new StripeSubscriptionError('Invalid API Key provided', 400, { stripeCode: null, stripeHttpStatus: 401 }),
    new StripeSubscriptionError('STRIPE_SECRET_KEY is not set on the server.', 503),
    new StripeSubscriptionError('Not found but not resource_missing', 400, { stripeCode: 'other', stripeHttpStatus: 404 }),
    new Error('fetch failed'),
  ];
  for (const err of transient) {
    const state = billingState();
    await assert.rejects(
      applyBillingSubscriptionEvent({
        writer: writerFor(state) as never,
        event: { type: 'invoice.payment_failed', data: { object: FAILED_INVOICE } },
        retrieveSubscription: async () => {
          throw err;
        },
        listLiveSubscriptions: async () => [],
      }),
      (thrown: unknown) => thrown === err
    );
    assert.equal(state.orgWrites.length, 0);
  }
});

test('isStripeResourceMissing needs both Stripe 404 and code resource_missing', () => {
  assert.equal(isStripeResourceMissing(missingSubscriptionError()), true);
  assert.equal(isStripeResourceMissing(new StripeSubscriptionError('x', 400, { stripeCode: 'resource_missing', stripeHttpStatus: 400 })), false);
  assert.equal(isStripeResourceMissing(new StripeSubscriptionError('x', 400, { stripeHttpStatus: 404 })), false);
  assert.equal(isStripeResourceMissing(new StripeSubscriptionError('x', 400)), false);
  assert.equal(isStripeResourceMissing(Object.assign(new Error('x'), { stripeCode: 'resource_missing', stripeHttpStatus: 404 })), false);
  assert.equal(isStripeResourceMissing(null), false);
});

test('retrieveStripeSubscription carries Stripe\'s HTTP status and error code (no network: fetch is stubbed)', async () => {
  const saved = {
    fetch: globalThis.fetch,
    key: process.env.STRIPE_SECRET_KEY,
    alias: process.env.STRIPE_SECRET,
    ctx: process.env.CONTEXT,
  };
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub_for_unit_test';
  delete process.env.STRIPE_SECRET;
  process.env.CONTEXT = 'dev';
  const calls: string[] = [];
  try {
    const answer = (status: number, body: unknown) => {
      globalThis.fetch = (async (url: string) => {
        calls.push(String(url));
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
    };
    answer(404, { error: { type: 'invalid_request_error', code: 'resource_missing', message: "No such subscription: 'sub_gone'" } });
    const missing = await retrieveStripeSubscription('sub_gone').catch((e: unknown) => e);
    assert.equal(isStripeResourceMissing(missing), true);
    assert.equal((missing as StripeSubscriptionError).status, 400);

    answer(429, { error: { type: 'rate_limit_error', code: 'rate_limit', message: 'Too many requests' } });
    assert.equal(isStripeResourceMissing(await retrieveStripeSubscription('sub_x').catch((e: unknown) => e)), false);

    answer(500, { error: { type: 'api_error', message: 'boom' } });
    const down = await retrieveStripeSubscription('sub_x').catch((e: unknown) => e);
    assert.equal(isStripeResourceMissing(down), false);
    assert.equal((down as StripeSubscriptionError).status, 502);
    assert.ok(calls.every((url) => url.startsWith('https://api.stripe.com/v1/subscriptions/')));
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = saved.key;
    if (saved.alias === undefined) delete process.env.STRIPE_SECRET;
    else process.env.STRIPE_SECRET = saved.alias;
    if (saved.ctx === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = saved.ctx;
  }
});

// ---- 000928: 14-day past_due downgrade (Larry, 2026-10-18) ----

const T0 = '2026-10-01T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
function at(days: number, extraMs = 0): Date {
  return new Date(Date.parse(T0) + days * DAY + extraMs);
}

async function runPastDue(
  state: State,
  eventType: 'customer.subscription.updated' | 'invoice.payment_failed',
  status: string,
  now: Date,
  opts?: {
    list?: { id?: string; status?: string | null }[];
    /** Stripe statuses for successive retrieves (the last one repeats). */
    stripe?: string[];
    onList?: () => void;
  }
) {
  const object = eventType === 'invoice.payment_failed' ? FAILED_INVOICE : { id: 'sub_paid', status };
  const sequence = opts?.stripe ? [...opts.stripe] : null;
  return quietly(() =>
    applyBillingSubscriptionEvent({
      writer: writerFor(state) as never,
      event: { type: eventType, data: { object } },
      retrieveSubscription: async () => {
        if (!sequence) return paidSub(status) as never;
        const next = sequence.length > 1 ? sequence.shift()! : sequence[0];
        return paidSub(next) as never;
      },
      listLiveSubscriptions: async () => {
        opts?.onList?.();
        return opts?.list || [];
      },
      now: () => now,
    })
  );
}

function pastDueState(): State {
  const state = billingState();
  state.dbNow = T0;
  return state;
}

test('past_due: day 13 keeps Premium, day 14 downgrades exactly like unpaid (customer.subscription.updated)', async () => {
  const state = pastDueState();
  const first = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  assert.equal(first.body.downgraded, false);
  assert.equal(first.body.pastDueKept, 'past_due_grace');
  assert.equal(state.subs[0].status, 'grace_period');
  assert.equal(state.subs[0].past_due_since, T0);

  const day13 = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(14, -60_000));
  assert.equal(day13.body.downgraded, false);
  assert.equal(day13.body.pastDueDays, 13);
  assert.equal(day13.body.pastDueSince, T0);
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.subs[0].tier, 'premium');

  const day14 = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(14));
  assert.equal(day14.body.downgraded, true);
  assert.equal(day14.body.plan, 'free');
  assert.equal(day14.body.organizationId, '42');
  assert.equal(day14.body.reason, 'past_due_14_days');
  assert.equal(day14.body.pastDueDays, 14);
  assertFree(state.orgs[0], state.orgWrites.at(-1));
  assert.equal(state.subs[0].status, 'grace_period');
  assert.equal(state.subs[0].tier, 'free');
  assert.equal(state.subs[0].past_due_since, T0, 'the clock does not move');

  // Same org outcome as an unpaid downgrade.
  const unpaid = billingState();
  await runEvent(unpaid, 'customer.subscription.updated', 'unpaid', []);
  assert.deepEqual(state.orgWrites.at(-1) && { ...state.orgWrites.at(-1), updated_at: null }, {
    ...unpaid.orgWrites.at(-1),
    updated_at: null,
  });

  const day40 = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(40));
  assert.equal(day40.body.downgraded, true, 'replays stay idempotent');
  assert.equal(state.orgs[0].plan, 'free');
});

test('past_due via invoice.payment_failed: records grace and the clock, day 13 kept, day 14 downgrades', async () => {
  const state = pastDueState();
  const first = await runPastDue(state, 'invoice.payment_failed', 'past_due', at(0));
  assert.equal(first.body.downgraded, false);
  assert.equal(first.body.logged, true);
  assert.equal(first.body.pastDueKept, 'past_due_grace');
  assert.equal(state.subs[0].status, 'grace_period');
  assert.equal(state.subs[0].tier, 'premium');
  assert.equal(state.subs[0].past_due_since, T0);
  assert.equal(state.orgWrites.length, 0);

  const day13 = await runPastDue(state, 'invoice.payment_failed', 'past_due', at(13, 23 * 60 * 60 * 1000));
  assert.equal(day13.body.downgraded, false);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgWrites.length, 0);

  const day14 = await runPastDue(state, 'invoice.payment_failed', 'past_due', at(14, 1));
  assert.equal(day14.body.downgraded, true);
  assert.equal(day14.body.trigger, 'invoice.payment_failed');
  assert.equal(day14.body.reason, 'past_due_14_days');
  assert.equal(day14.body.attemptCount, 4);
  assertFree(state.orgs[0], state.orgWrites.at(-1));
});

test('recovery after a 14-day past_due downgrade restores Premium the same way as after unpaid', async () => {
  const recover = async (state: State) =>
    quietly(() =>
      applyBillingSubscriptionEvent({
        writer: writerFor(state) as never,
        event: { type: 'customer.subscription.updated', data: { object: { id: 'sub_paid', status: 'active' } } },
        retrieveSubscription: async () => paidSub('active') as never,
        listLiveSubscriptions: async () => [],
        now: () => at(16),
      })
    );

  const pastDue = pastDueState();
  await runPastDue(pastDue, 'customer.subscription.updated', 'past_due', at(0));
  await runPastDue(pastDue, 'customer.subscription.updated', 'past_due', at(15));
  assert.equal(pastDue.orgs[0].is_premium, false);
  const back = await recover(pastDue);
  assert.equal(back.body.applied, true);
  assert.equal(back.body.plan, 'premium');

  const unpaid = billingState();
  await runEvent(unpaid, 'customer.subscription.updated', 'unpaid', []);
  assert.equal(unpaid.orgs[0].is_premium, false);
  await recover(unpaid);

  for (const state of [pastDue, unpaid]) {
    assert.equal(state.orgs[0].is_premium, true);
    assert.equal(state.orgs[0].plan, 'premium');
    assert.equal(state.orgs[0].subscription_tier, 'premium');
    assert.equal(state.subs[0].status, 'active');
    assert.equal(state.subs[0].tier, 'premium');
    assert.equal(state.subs[0].past_due_since ?? null, null, 'recovery clears the clock');
  }
  assert.deepEqual({ ...pastDue.orgs[0], updated_at: null }, { ...unpaid.orgs[0], updated_at: null });
});

test('recovery before day 14 clears the clock; the next past_due starts a new 14 days', async () => {
  const state = pastDueState();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  await quietly(() =>
    applyBillingSubscriptionEvent({
      writer: writerFor(state) as never,
      event: { type: 'customer.subscription.updated', data: { object: { id: 'sub_paid', status: 'active' } } },
      retrieveSubscription: async () => paidSub('active') as never,
      listLiveSubscriptions: async () => [],
      now: () => at(10),
    })
  );
  assert.equal(state.subs[0].status, 'active');
  assert.equal(state.subs[0].past_due_since, null);

  state.dbNow = at(12).toISOString();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(12));
  assert.equal(state.subs[0].past_due_since, at(12).toISOString());
  const day20 = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(20));
  assert.equal(day20.body.downgraded, false, 'only 8 days into the new episode');
  assert.equal(state.orgs[0].is_premium, true);
  const day26 = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(26));
  assert.equal(day26.body.downgraded, true);
});

test('complimentary Premium is never touched by the 14-day past_due rule', async () => {
  for (const grant of ['complimentary_signup', 'complimentary_god', 'manual_grant']) {
    const state = pastDueState();
    state.orgs[0].premium_grant = grant;
    state.orgs[0].premium_until = '2027-04-01T00:00:00.000Z';
    await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
    for (const eventType of ['customer.subscription.updated', 'invoice.payment_failed'] as const) {
      const late = await runPastDue(state, eventType, 'past_due', at(45));
      assert.equal(late.body.downgraded, false, `${grant} ${eventType}`);
      assert.equal(late.body.pastDueKept, 'complimentary', `${grant} ${eventType}`);
    }
    assert.equal(state.orgWrites.length, 0, grant);
    assert.equal(state.orgs[0].is_premium, true, grant);
    assert.equal(state.orgs[0].plan, 'premium', grant);
    assert.equal(state.orgs[0].premium_grant, grant, grant);
    assert.equal(state.orgs[0].premium_until, '2027-04-01T00:00:00.000Z', grant);
  }
});

test('unpaid still downgrades immediately, with or without a past_due clock', async () => {
  for (const eventType of ['customer.subscription.updated', 'invoice.payment_failed'] as const) {
    const fresh = billingState();
    const now = await runPastDue(fresh, eventType, 'unpaid', at(0));
    assert.equal(now.body.downgraded, true, eventType);
    assert.equal(fresh.subs[0].status, 'expired', eventType);

    const afterOneDay = pastDueState();
    await runPastDue(afterOneDay, 'customer.subscription.updated', 'past_due', at(0));
    const unpaid = await runPastDue(afterOneDay, eventType, 'unpaid', at(1));
    assert.equal(unpaid.body.downgraded, true, eventType);
    assert.equal(unpaid.body.reason, undefined, 'the unpaid path, not the 14-day path');
    assertFree(afterOneDay.orgs[0], afterOneDay.orgWrites.at(-1));
  }
});

test('other statuses ignore the past_due clock', async () => {
  for (const status of ['incomplete', 'paused']) {
    const state = pastDueState();
    state.subs[0].status = 'grace_period';
    state.subs[0].past_due_since = at(-60).toISOString();
    const result = await runPastDue(state, 'customer.subscription.updated', status, at(0));
    assert.equal(result.body.downgraded, false, status);
    assert.equal(result.body.pastDueKept, undefined, status);
    assert.equal(state.orgWrites.length, 0, status);
    assert.equal(state.orgs[0].is_premium, true, status);
  }
  for (const status of ['active', 'trialing']) {
    const state = pastDueState();
    state.subs[0].status = 'grace_period';
    state.subs[0].past_due_since = at(-60).toISOString();
    const result = await runPastDue(state, 'customer.subscription.updated', status, at(0));
    assert.equal(result.body.applied, true, status);
    assert.equal(state.orgs[0].is_premium, true, status);
    assert.equal(state.subs[0].status, 'active', status);
    assert.equal(state.subs[0].past_due_since, null, status);
  }
  const failedActive = pastDueState();
  failedActive.subs[0].past_due_since = at(-60).toISOString();
  const kept = await runPastDue(failedActive, 'invoice.payment_failed', 'active', at(0));
  assert.equal(kept.body.downgraded, false);
  assert.equal(failedActive.subscriptionWrites.length, 0);
  assert.equal(failedActive.orgWrites.length, 0);
});

test('past_due: a second live subscription still blocks the 14-day downgrade', async () => {
  const state = pastDueState();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  const late = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(20), {
    list: [{ id: 'sub_team', status: 'active' }],
  });
  assert.equal(late.body.downgraded, false);
  assert.equal(late.body.pastDueKept, 'live_subscription_remains');
  assert.equal(state.orgWrites.length, 0);
});

test('past_due with no stored clock (000928 not applied) keeps Premium', async () => {
  const state = pastDueState();
  state.noPastDueColumn = true;
  const warns: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    for (const eventType of ['customer.subscription.updated', 'invoice.payment_failed'] as const) {
      const result = await runPastDue(state, eventType, 'past_due', at(90));
      assert.equal(result.body.downgraded, false, eventType);
      assert.equal(result.body.pastDueKept, 'no_past_due_clock', eventType);
    }
  } finally {
    console.warn = original;
  }
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.orgs[0].is_premium, true);
  assert.ok(warns.some((args) => String(args[0]).includes('past_due clock unavailable')));
});

test('PAST_DUE_DOWNGRADE_DISABLED accepts 1/true/yes (any case, trimmed) and warns once', async () => {
  const original = process.env.PAST_DUE_DOWNGRADE_DISABLED;
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    resetPastDueDisabledWarning();
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'Yes', 'tRuE\n']) {
      const state = pastDueState();
      await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
      process.env.PAST_DUE_DOWNGRADE_DISABLED = value;
      const result = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(30));
      assert.equal(result.body.pastDueKept, 'past_due_downgrade_disabled', JSON.stringify(value));
      assert.equal(state.orgWrites.length, 0, JSON.stringify(value));
      delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
    }
    const disabledWarnings = warns.filter((args) => String(args[0]).includes('PAST_DUE_DOWNGRADE_DISABLED is on'));
    assert.equal(disabledWarnings.length, 1, 'warns once per process');
    assert.match(String(disabledWarnings[0][0]), /clock keeps running/);
    for (const value of ['', '0', 'false', 'no', 'off', 'y', 'enabled']) {
      const state = pastDueState();
      await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
      process.env.PAST_DUE_DOWNGRADE_DISABLED = value;
      const result = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(30));
      assert.equal(result.body.downgraded, true, JSON.stringify(value));
      delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
    }
  } finally {
    console.warn = originalWarn;
    if (original === undefined) delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
    else process.env.PAST_DUE_DOWNGRADE_DISABLED = original;
    resetPastDueDisabledWarning();
  }
});

test('PAST_DUE_DOWNGRADE_DISABLED=1 keeps past_due on Premium (pre-000928 behaviour)', async () => {
  const state = pastDueState();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  process.env.PAST_DUE_DOWNGRADE_DISABLED = '1';
  try {
    const result = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(30));
    assert.equal(result.body.downgraded, false);
    assert.equal(result.body.pastDueKept, 'past_due_downgrade_disabled');
    assert.equal(state.orgWrites.length, 0);
    const swept = await runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: async () => paidSub('past_due') as never,
      listLiveSubscriptions: async () => [],
      now: at(30),
    });
    assert.equal(swept.disabled, true);
    assert.equal(state.orgWrites.length, 0);
  } finally {
    delete process.env.PAST_DUE_DOWNGRADE_DISABLED;
  }
  const enabled = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(30));
  assert.equal(enabled.body.downgraded, true);
});

// ---- 000928: hourly sweep (netlify/functions/past-due-downgrade.mts) ----

type SweepOrg = { orgId: number; user: string; sub: string; cus: string; stripeStatus: string; since: string | null; tier?: string; grant?: string | null };

function sweepState(rows: SweepOrg[]): State {
  const state: State = {
    orgs: [],
    subs: [],
    customers: [],
    profiles: [],
    memberships: [],
    orgWrites: [],
    subscriptionWrites: [],
    dbNow: T0,
  };
  for (const row of rows) {
    state.orgs.push(paidOrg({ id: row.orgId, name: `Org ${row.orgId}`, premium_grant: row.grant ?? null }));
    state.subs.push({
      id: state.subs.length + 1,
      organization_id: row.orgId,
      user_id: row.user,
      stripe_subscription_id: row.sub,
      status: 'grace_period',
      tier: row.tier || 'premium',
      platform: 'stripe',
      past_due_since: row.since,
    });
    state.customers.push({ id: `row-${row.cus}`, user_id: row.user, stripe_customer_id: row.cus });
    state.profiles.push({ id: row.user, organization_id: row.orgId });
    state.memberships.push({ user_id: row.user, organization_id: row.orgId });
  }
  return state;
}

function sweepRetrieve(rows: SweepOrg[]) {
  return async (subscriptionId: string) => {
    const row = rows.find((r) => r.sub === subscriptionId);
    if (!row) throw new Error('unexpected retrieve ' + subscriptionId);
    if (row.stripeStatus === 'missing') throw missingSubscriptionError();
    if (row.stripeStatus === 'boom') throw new Error('stripe unavailable');
    return {
      id: row.sub,
      status: row.stripeStatus,
      customer: row.cus,
      metadata: { kind: 'org_plan', organization_id: String(row.orgId), user_id: row.user, sku: 'premium_monthly', plan: 'premium' },
    } as never;
  };
}

test('sweep: downgrades day-14+ past_due, keeps day 13, recovers the ledger for active, follows Stripe for unpaid', async () => {
  const rows: SweepOrg[] = [
    { orgId: 2655, user: 'u-2655', sub: 'sub_d14', cus: 'cus_2655', stripeStatus: 'past_due', since: at(-14).toISOString() },
    { orgId: 2639, user: 'u-2639', sub: 'sub_d13', cus: 'cus_2639', stripeStatus: 'past_due', since: at(-14, 60_000).toISOString() },
    { orgId: 2656, user: 'u-2656', sub: 'sub_back', cus: 'cus_2656', stripeStatus: 'active', since: at(-20).toISOString() },
    { orgId: 2668, user: 'u-2668', sub: 'sub_unpaid', cus: 'cus_2668', stripeStatus: 'unpaid', since: at(-30).toISOString() },
    { orgId: 2669, user: 'u-2669', sub: 'sub_done', cus: 'cus_2669', stripeStatus: 'past_due', since: at(-30).toISOString(), tier: 'free' },
  ];
  const state = sweepState(rows);
  const retrieved: string[] = [];
  const retrieve = sweepRetrieve(rows);
  const summary = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: async (id: string) => {
        retrieved.push(id);
        return retrieve(id);
      },
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(summary.ok, true);
  assert.equal(summary.candidates, 3);
  assert.equal(summary.downgraded, 2);
  assert.deepEqual([...new Set(retrieved)].sort(), ['sub_back', 'sub_d14', 'sub_unpaid']);
  // sub_d14: the sweep read, the re-check right before the write, the check right after.
  assert.equal(retrieved.filter((id) => id === 'sub_d14').length, 3);
  const byOrg = (id: number) => state.orgs.find((o) => o.id === id)!;
  const subOf = (id: string) => state.subs.find((s) => s.stripe_subscription_id === id)!;

  assert.equal(byOrg(2655).is_premium, false);
  assert.equal(byOrg(2655).plan, 'free');
  assert.equal(subOf('sub_d14').tier, 'free');
  assert.deepEqual(summary.results.find((r) => r.subscriptionId === 'sub_d14')?.reason, 'past_due_14_days');

  assert.equal(byOrg(2639).is_premium, true, 'day 13 is not a candidate');
  assert.equal(byOrg(2656).is_premium, true, 'active in Stripe: never downgraded');
  assert.equal(subOf('sub_back').status, 'active');
  assert.equal(subOf('sub_back').past_due_since, null);
  assert.equal(summary.results.find((r) => r.subscriptionId === 'sub_back')?.outcome, 'ledger_recovered');

  assert.equal(byOrg(2668).is_premium, false);
  assert.equal(subOf('sub_unpaid').status, 'expired');
  assert.equal(byOrg(2669).is_premium, true, 'already-free ledger rows are not re-swept');

  const again = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: retrieve,
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(again.candidates, 0, 'a second run finds nothing left to do');
});

test('sweep: complimentary Premium is never a candidate and is refused if linked', async () => {
  const rows: SweepOrg[] = [
    { orgId: 2655, user: 'u-2655', sub: 'sub_comp', cus: 'cus_2655', stripeStatus: 'past_due', since: at(-30).toISOString(), grant: 'complimentary_god' },
  ];
  const state = sweepState(rows);
  const comp = compOrg();
  state.orgs.push(comp);
  const summary = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: sweepRetrieve(rows),
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(summary.candidates, 1);
  assert.equal(summary.downgraded, 0);
  assert.equal(summary.results[0].reason, 'complimentary');
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(comp.is_premium, true);
  assert.equal(comp.premium_grant, 'complimentary_signup');
  assert.equal(comp.premium_until, '2027-04-01T00:00:00.000Z');
});

test('sweep: missing Stripe subscription is skipped, a Stripe error does not stop the run, no clock column finds nothing', async () => {
  const rows: SweepOrg[] = [
    { orgId: 2655, user: 'u-2655', sub: 'sub_gone', cus: 'cus_2655', stripeStatus: 'missing', since: at(-30).toISOString() },
    { orgId: 2639, user: 'u-2639', sub: 'sub_boom', cus: 'cus_2639', stripeStatus: 'boom', since: at(-29).toISOString() },
    { orgId: 2656, user: 'u-2656', sub: 'sub_due', cus: 'cus_2656', stripeStatus: 'past_due', since: at(-28).toISOString() },
  ];
  const state = sweepState(rows);
  const summary = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: sweepRetrieve(rows),
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(summary.ok, false);
  assert.equal(summary.candidates, 3);
  assert.equal(summary.downgraded, 1);
  assert.equal(summary.results.find((r) => r.subscriptionId === 'sub_gone')?.reason, 'subscription_missing');
  assert.equal(summary.results.find((r) => r.subscriptionId === 'sub_boom')?.outcome, 'error');
  assert.equal(state.orgs.find((o) => o.id === 2655)?.is_premium, true);
  assert.equal(state.orgs.find((o) => o.id === 2639)?.is_premium, true);
  assert.equal(state.orgs.find((o) => o.id === 2656)?.is_premium, false);

  const old = sweepState(rows);
  old.noPastDueColumn = true;
  const none = await runPastDueSweep({
    writer: writerFor(old) as never,
    retrieveSubscription: sweepRetrieve(rows),
    listLiveSubscriptions: async () => [],
    now: at(0),
  });
  assert.equal(none.ok, true);
  assert.equal(none.skipped, 'past_due_clock_missing');
  assert.equal(none.candidates, 0);
  assert.equal(old.orgWrites.length, 0);
});

// ---- QA L-1: a recovery racing the 14-day downgrade ----

test('L-1: Stripe recovered before the write: nothing is written, the org stays Premium', async () => {
  for (const eventType of ['customer.subscription.updated', 'invoice.payment_failed'] as const) {
    const state = pastDueState();
    await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
    // The event says past_due; the re-check right before the write sees active.
    const late = await runPastDue(state, eventType, 'past_due', at(20), { stripe: ['past_due', 'active'] });
    assert.equal(late.body.downgraded, false, eventType);
    assert.equal(late.body.pastDueKept, 'stripe_status_changed', eventType);
    assert.equal(state.orgWrites.length, 0, eventType);
    assert.equal(state.orgs[0].is_premium, true, eventType);
    assert.equal(state.subs[0].tier, 'premium', eventType);
  }
});

test('L-1: a recovery that rewrites the ledger mid-flow fails the compare-and-set; the org stays Premium', async () => {
  const state = pastDueState();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  const clockBefore = state.subs[0].past_due_since;
  assert.ok(clockBefore);
  // The recovery webhook lands after the clock was read but before the write:
  // it sets the ledger active, and the trigger clears the clock.
  const late = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(20), {
    onList: () => {
      const before = { ...state.subs[0] };
      state.subs[0].status = 'active';
      emulatePastDueClock(state, state.subs[0], before);
    },
  });
  assert.equal(late.body.downgraded, false);
  assert.equal(late.body.pastDueKept, 'past_due_clock_changed');
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.subs[0].status, 'active', 'the recovered ledger row is not turned back to grace');
  assert.equal(state.subs[0].past_due_since, null);
  assert.equal(state.subs[0].tier, 'premium');

  // A new past_due episode (fresh clock) between read and write fails it too.
  const episode = pastDueState();
  await runPastDue(episode, 'customer.subscription.updated', 'past_due', at(0));
  const second = await runPastDue(episode, 'customer.subscription.updated', 'past_due', at(20), {
    onList: () => {
      episode.subs[0].past_due_since = at(19).toISOString();
    },
  });
  assert.equal(second.body.downgraded, false);
  assert.equal(second.body.pastDueKept, 'past_due_clock_changed');
  assert.equal(episode.orgs[0].is_premium, true);
});

test('L-1: a recovery that lands right after the plan write re-applies Premium', async () => {
  const state = pastDueState();
  await runPastDue(state, 'customer.subscription.updated', 'past_due', at(0));
  // Reads: the event, the re-check before the write (still past_due), then
  // the check right after the write (the payment went through: active).
  const late = await runPastDue(state, 'customer.subscription.updated', 'past_due', at(20), {
    stripe: ['past_due', 'past_due', 'active'],
  });
  assert.equal(late.body.downgraded, false);
  assert.equal(late.body.pastDueKept, 'recovered_during_write');
  assert.ok(state.orgWrites.length >= 2, 'free write then the Premium re-apply');
  assert.equal(state.orgWrites[0].is_premium, false);
  assert.equal(state.orgs[0].is_premium, true);
  assert.equal(state.orgs[0].plan, 'premium');
  assert.equal(state.subs[0].status, 'active');
  assert.equal(state.subs[0].past_due_since, null);
});

test('L-1: the sweep also re-checks Stripe right before writing', async () => {
  const rows: SweepOrg[] = [
    { orgId: 2655, user: 'u-2655', sub: 'sub_race', cus: 'cus_2655', stripeStatus: 'past_due', since: at(-20).toISOString() },
  ];
  const state = sweepState(rows);
  const base = sweepRetrieve(rows);
  let calls = 0;
  const summary = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: async (id: string) => {
        calls += 1;
        const sub = (await base(id)) as unknown as Record<string, unknown>;
        return (calls === 1 ? sub : { ...sub, status: 'active' }) as never;
      },
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(summary.downgraded, 0);
  assert.equal(summary.results[0].outcome, 'kept');
  assert.equal(summary.results[0].reason, 'stripe_status_changed');
  assert.equal(state.orgWrites.length, 0);
  assert.equal(state.orgs[0].is_premium, true);
});

// ---- QA LM-1: refused rows rotate out; 18 s budget ----

test('LM-1: 55 refused rows ahead of a real overdue org do not starve it', async () => {
  const rows: SweepOrg[] = [];
  for (let i = 0; i < 55; i += 1) {
    rows.push({
      orgId: 3000 + i,
      user: `u-comp-${i}`,
      sub: `sub_comp_${i}`,
      cus: `cus_comp_${i}`,
      stripeStatus: 'past_due',
      // Older clocks than the real org: they sort ahead of it.
      since: at(-60, i * 1000).toISOString(),
      grant: 'complimentary_god',
    });
  }
  rows.push({ orgId: 2655, user: 'u-2655', sub: 'sub_real', cus: 'cus_2655', stripeStatus: 'past_due', since: at(-15).toISOString() });
  const state = sweepState(rows);
  const run = (now: Date) =>
    quietly(() =>
      runPastDueSweep({
        writer: writerFor(state) as never,
        retrieveSubscription: sweepRetrieve(rows),
        listLiveSubscriptions: async () => [],
        now,
      })
    );
  const real = () => state.orgs.find((o) => o.id === 2655)!;

  const first = await run(at(0));
  assert.equal(first.candidates, 50, 'a run handles at most 50 rows');
  assert.equal(first.downgraded, 0);
  assert.ok(first.results.every((r) => r.reason === 'complimentary'));
  assert.equal(real().is_premium, true, 'not reached on the first run');
  assert.equal(state.subs.filter((s) => s.past_due_checked_at).length, 50, 'every refused row is stamped');

  const second = await run(at(0, 60 * 60 * 1000));
  assert.equal(second.candidates, 6, 'the 5 unchecked refused rows plus the real org');
  assert.equal(second.downgraded, 1);
  assert.equal(second.results.find((r) => r.subscriptionId === 'sub_real')?.outcome, 'downgraded');
  assert.equal(real().is_premium, false);
  assert.ok(state.orgs.filter((o) => o.id >= 3000).every((o) => o.is_premium), 'complimentary orgs untouched');

  const third = await run(at(0, 2 * 60 * 60 * 1000));
  assert.equal(third.candidates, 0, 'refused rows wait 23 hours before another look');

  const nextDay = await run(at(1, 60 * 60 * 1000));
  assert.equal(nextDay.candidates, 50, 'after 23 hours refused rows are looked at again, least recently checked first');
  assert.ok(nextDay.results.every((r) => r.subscriptionId.startsWith('sub_comp_')));
});

test('LM-1: the sweep stops starting rows after its 18 s budget', async () => {
  const rows: SweepOrg[] = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push({ orgId: 4000 + i, user: `u-${i}`, sub: `sub_b_${i}`, cus: `cus_b_${i}`, stripeStatus: 'past_due', since: at(-20, i * 1000).toISOString() });
  }
  const state = sweepState(rows);
  let fakeMs = 0;
  const summary = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(state) as never,
      retrieveSubscription: async (id: string) => {
        fakeMs += 1000; // each Stripe call "takes" 1 s
        return sweepRetrieve(rows)(id);
      },
      listLiveSubscriptions: async () => [],
      now: at(0),
      clock: () => fakeMs,
    })
  );
  // Each downgraded row makes 3 Stripe reads (3 s): rows start at 0,3,...,15 s.
  assert.equal(summary.budgetExhausted, true);
  assert.equal(summary.candidates, 6);
  assert.equal(summary.downgraded, 6);
  assert.equal(state.orgs.filter((o) => !o.is_premium).length, 6);

  const defaults = await quietly(() =>
    runPastDueSweep({
      writer: writerFor(sweepState(rows)) as never,
      retrieveSubscription: sweepRetrieve(rows),
      listLiveSubscriptions: async () => [],
      now: at(0),
    })
  );
  assert.equal(defaults.budgetExhausted, undefined, 'a fast run is not cut short');
  assert.equal(defaults.candidates, 30);
});
