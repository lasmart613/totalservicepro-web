/**
 * A completed Checkout session is not a live plan. Premium is written only
 * when the subscription status is active or trialing. Canceled, missing,
 * and unknown statuses are refused on sync, confirm, and the webhook.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test, { describe } from 'node:test';
import { NextRequest } from 'next/server';
import { POST as confirmPost } from '../../app/api/billing/upgrade/confirm/route.ts';
import { POST as syncPost } from '../../app/api/billing/upgrade/sync/route.ts';
import { POST as webhookPost } from '../../app/api/billing/upgrade/webhook/route.ts';
import { applyBillingSubscriptionEvent } from './apply-org-downgrade.ts';
import { applyPaidCheckoutSession } from './apply-org-upgrade.ts';
import { persistPaidOrgUpgrade } from './persist-org-upgrade.ts';
import { retrieveCheckoutSession, type StripeObject } from './stripe-subscription.ts';

const WEBHOOK_SECRET = 'whsec_test_fake';
const SESSION_ID = 'cs_test_old';
const ORG_ID = 42;

type Db = {
  organizations: Record<string, unknown>[];
  user_profiles: Record<string, unknown>[];
  stripe_customers: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  organization_memberships: Record<string, unknown>[];
};

type StatusCase = 'canceled' | 'active' | 'trialing' | 'missing';

const ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_SECRET',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'URL',
  'DEPLOY_PRIME_URL',
  'NEXT_PUBLIC_SITE_URL',
  'CONTEXT',
  'NETLIFY_CONTEXT',
] as const;

function orgRow(paid: boolean): Record<string, unknown> {
  return {
    id: ORG_ID,
    name: paid ? 'Paid Shop' : 'Free Shop',
    is_premium: paid,
    plan: paid ? 'premium' : 'free',
    subscription_tier: paid ? 'premium' : 'free',
    premium_until: null,
    premium_grant: null,
    manual_slots: paid ? 15 : 5,
  };
}

function emptyDb(paid = false): Db {
  return {
    organizations: [orgRow(paid)],
    user_profiles: [{ id: 'user-1', organization_id: ORG_ID }],
    stripe_customers: [
      { id: 'cus-row-1', user_id: 'user-1', stripe_customer_id: 'cus_paid', email: 'tech@example.com' },
    ],
    subscriptions: paid
      ? [
          {
            id: 1,
            organization_id: ORG_ID,
            user_id: 'user-1',
            stripe_subscription_id: 'sub_paid',
            status: 'active',
            tier: 'premium',
            platform: 'stripe',
            subscription_type: 'monthly',
          },
        ]
      : [],
    organization_memberships: [{ user_id: 'user-1', organization_id: ORG_ID }],
  };
}

function planMeta() {
  return {
    kind: 'org_plan',
    organization_id: '42',
    user_id: 'user-1',
    sku: 'premium_monthly',
    plan: 'premium',
  };
}

function listedSession(): StripeObject {
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'complete',
    payment_status: 'paid',
    created: 1_700_000_000,
    customer: 'cus_paid',
    subscription: 'sub_paid',
    client_reference_id: '42',
    amount_total: 999,
    currency: 'usd',
    metadata: planMeta(),
  };
}

function subscriptionFixture(status: StatusCase | 'paused'): StripeObject {
  const sub: StripeObject = {
    id: 'sub_paid',
    object: 'subscription',
    customer: 'cus_paid',
    metadata: planMeta(),
  };
  if (status !== 'missing') sub.status = status;
  return sub;
}

function retrievedSession(status: StatusCase | 'paused', expanded: boolean): StripeObject {
  const session = listedSession();
  if (expanded) session.subscription = subscriptionFixture(status);
  return session;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const SKIP_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function matches(row: Record<string, unknown>, url: URL): boolean {
  for (const [key, raw] of url.searchParams.entries()) {
    if (SKIP_PARAMS.has(key)) continue;
    if (!raw.startsWith('eq.')) throw new Error(`unsupported filter ${key}=${raw} on ${url.pathname}`);
    if (String(row[key] ?? '') !== raw.slice(3)) return false;
  }
  return true;
}

function installFetch(db: Db, status: StatusCase | 'paused', expanded: boolean, activeList: StripeObject[] = []) {
  const urls: string[] = [];
  const subscription = subscriptionFixture(status);
  const previous = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(href);
    const method = String(init?.method || 'GET').toUpperCase();
    urls.push(`${method} ${url.pathname}${url.search}`);

    if (url.hostname === 'api.stripe.com') {
      if (url.pathname === `/v1/checkout/sessions/${SESSION_ID}`) {
        return jsonResponse(retrievedSession(status, expanded));
      }
      if (url.pathname === '/v1/checkout/sessions' || url.pathname === '/v1/checkout/sessions/search') {
        return jsonResponse({ object: 'list', data: [listedSession()] });
      }
      if (url.pathname === '/v1/customers') {
        return jsonResponse({ object: 'list', data: [{ id: 'cus_paid', email: 'tech@example.com' }] });
      }
      if (url.pathname === '/v1/subscriptions' && url.searchParams.get('status') === 'active') {
        return jsonResponse({ object: 'list', data: activeList });
      }
      if (url.pathname === '/v1/subscriptions' && url.searchParams.get('status') === 'all') {
        return jsonResponse({ object: 'list', data: [subscription] });
      }
      if (url.pathname === '/v1/subscriptions/sub_paid' || url.pathname === '/v1/subscriptions/sub_live') {
        const id = url.pathname.split('/').pop();
        if (id === 'sub_live') {
          return jsonResponse(activeList.find((row) => row.id === 'sub_live') || { id: 'sub_live', status: 'active' });
        }
        return jsonResponse(subscription);
      }
      throw new Error(`unexpected stripe ${method} ${url.pathname}${url.search}`);
    }

    if (url.hostname === 'supabase.test' && url.pathname === '/auth/v1/user') {
      return jsonResponse({ id: 'user-1', email: 'tech@example.com', aud: 'authenticated', role: 'authenticated' });
    }

    if (url.hostname === 'supabase.test' && url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/')[3] as keyof Db;
      const rows = db[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const hit = rows.filter((row) => matches(row, url));
      if (method === 'GET') return jsonResponse(hit);
      const raw = typeof init?.body === 'string' ? init.body : '';
      const payload = raw ? (JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[]) : {};
      if (method === 'PATCH') {
        const patch = payload as Record<string, unknown>;
        for (const row of hit) Object.assign(row, patch);
        return jsonResponse(hit);
      }
      if (method === 'POST') {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const stored = incoming.map((row, index) => {
          const copy = { ...row };
          if (copy.id == null) copy.id = `${table}-${rows.length + index + 1}`;
          rows.push(copy);
          return copy;
        });
        return jsonResponse(stored);
      }
      throw new Error(`unexpected supabase ${method} ${url.pathname}`);
    }

    throw new Error(`unexpected fetch ${method} ${href}`);
  };
  return {
    urls,
    restore() {
      globalThis.fetch = previous;
    },
  };
}

function useEnv() {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) previous[key] = process.env[key];
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_not_a_real_key';
  delete process.env.STRIPE_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_URL = 'http://supabase.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.CONTEXT = 'dev';
  delete process.env.NETLIFY_CONTEXT;
  return () => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function sign(body: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function syncRequest(): NextRequest {
  return new NextRequest('http://localhost/api/billing/upgrade/sync', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
  });
}

function confirmRequest(): NextRequest {
  return new NextRequest('http://localhost/api/billing/upgrade/confirm', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION_ID }),
  });
}

function webhookRequest(payload: unknown): NextRequest {
  const body = JSON.stringify(payload);
  return new NextRequest('http://localhost/api/billing/upgrade/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': sign(body), 'content-type': 'application/json' },
    body,
  });
}

function completedPayload(): unknown {
  return {
    id: 'evt_checkout_old',
    type: 'checkout.session.completed',
    data: {
      object: {
        ...listedSession(),
        subscription: 'sub_paid',
      },
    },
  };
}

async function callPath(path: 'sync' | 'confirm' | 'webhook'): Promise<Response> {
  if (path === 'sync') return syncPost(syncRequest());
  if (path === 'confirm') return confirmPost(confirmRequest());
  return webhookPost(webhookRequest(completedPayload()));
}

function bombWriter() {
  return {
    from() {
      throw new Error('database write attempted');
    },
  };
}

function sessionWithStatus(status: string | null): StripeObject {
  const session = listedSession();
  session.subscription =
    status == null ? { id: 'sub_paid', customer: 'cus_paid' } : { id: 'sub_paid', status, customer: 'cus_paid' };
  return session;
}

describe('checkout upgrade requires a live subscription', { concurrency: 1 }, () => {
  test('persistPaidOrgUpgrade refuses a missing or unknown status before any write', async () => {
    for (const stripeStatus of [undefined, null, '', '   ', 'canceled', 'paused', 'incomplete', 'unpaid']) {
      let calls = 0;
      const writer = {
        from() {
          calls += 1;
          throw new Error('database write attempted');
        },
      };
      await assert.rejects(
        () =>
          persistPaidOrgUpgrade({
            writer: writer as never,
            organizationId: '42',
            userId: 'user-1',
            plan: 'premium',
            sku: 'premium_monthly',
            customerId: 'cus_paid',
            subscriptionId: 'sub_paid',
            stripeStatus: stripeStatus as never,
          }),
        /active or trialing/
      );
      assert.equal(calls, 0, `status ${String(stripeStatus)} touched the database`);
    }
  });

  test('applyPaidCheckoutSession does not default a missing or non-live status to active', async () => {
    const cases: { status: string | null; reason: string }[] = [
      { status: null, reason: 'missing_subscription_status' },
      { status: 'canceled', reason: 'subscription_not_live' },
      { status: 'paused', reason: 'subscription_not_live' },
      { status: 'incomplete', reason: 'subscription_not_live' },
      { status: 'past_due', reason: 'subscription_not_live' },
    ];
    for (const item of cases) {
      const result = await applyPaidCheckoutSession({
        writer: bombWriter() as never,
        session: sessionWithStatus(item.status),
        expectedOwner: { userId: 'user-1', organizationId: '42' },
      });
      assert.equal(result.ok, false, String(item.status));
      if (!result.ok) assert.equal(result.reason, item.reason, String(item.status));
    }
  });

  test('retrieveCheckoutSession expands the subscription and fetches by id when status is absent', async () => {
    const restoreEnv = useEnv();
    const urls: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(href);
      const url = new URL(href);
      if (url.pathname.includes('/checkout/sessions/')) {
        return jsonResponse({ id: SESSION_ID, subscription: 'sub_paid', status: 'complete' });
      }
      if (url.pathname.endsWith('/subscriptions/sub_paid')) {
        return jsonResponse({ id: 'sub_paid', status: 'canceled' });
      }
      throw new Error(href);
    };
    try {
      const session = await retrieveCheckoutSession(SESSION_ID);
      assert.equal(urls.length, 2);
      assert.match(urls[0], /expand\[\]=subscription/);
      assert.match(urls[0], /expand\[\]=invoice/);
      assert.match(urls[0], /expand\[\]=line_items/);
      assert.match(urls[1], /\/subscriptions\/sub_paid$/);
      const sub = session.subscription;
      assert.equal(sub && typeof sub === 'object' ? sub.status : null, 'canceled');
    } finally {
      globalThis.fetch = previous;
      restoreEnv();
    }
  });

  test('retrieveCheckoutSession keeps an expanded status and does not fetch the subscription again', async () => {
    const restoreEnv = useEnv();
    const urls: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(href);
      return jsonResponse({
        id: SESSION_ID,
        subscription: { id: 'sub_paid', status: 'trialing' },
      });
    };
    try {
      const session = await retrieveCheckoutSession(SESSION_ID);
      assert.equal(urls.length, 1);
      assert.match(urls[0], /expand\[\]=subscription/);
      const sub = session.subscription;
      assert.equal(sub && typeof sub === 'object' ? sub.status : null, 'trialing');
    } finally {
      globalThis.fetch = previous;
      restoreEnv();
    }
  });

  for (const path of ['sync', 'confirm', 'webhook'] as const) {
    for (const status of ['canceled', 'active', 'trialing', 'missing'] as const) {
      const upgrades = status === 'active' || status === 'trialing';
      test(`${path} ${upgrades ? 'upgrades' : 'does not upgrade'} when the subscription is ${status}`, async () => {
        const restoreEnv = useEnv();
        const db = emptyDb(false);
        const expanded = status !== 'active';
        const net = installFetch(db, status, expanded);
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
          warnings.push(args);
        };
        try {
          const res = await callPath(path);
          const body = (await res.json()) as {
            ok?: boolean;
            applied?: boolean;
            plan?: string;
            reason?: string;
            error?: string;
            ignored?: string;
          };
          const org = db.organizations[0];
          const sessionFetch = net.urls.find((url) => url.includes(`/checkout/sessions/${SESSION_ID}`));
          assert.ok(sessionFetch, `${path} did not retrieve the checkout session`);
          assert.match(sessionFetch, /expand\[\]=subscription/);
          if (status === 'active') {
            assert.ok(
              net.urls.some((url) => url.includes('/subscriptions/sub_paid')),
              `${path} did not fetch the subscription by id`
            );
          }

          if (upgrades) {
            assert.equal(res.status, 200, `${path} ${status} ${JSON.stringify(body)}`);
            assert.equal(body.plan, 'premium');
            if (path !== 'confirm') assert.equal(body.applied, true);
            assert.equal(org.is_premium, true);
            assert.equal(org.plan, 'premium');
            assert.equal(org.subscription_tier, 'premium');
          } else {
            assert.equal(org.is_premium, false, `${path} resurrected Premium`);
            assert.equal(org.plan, 'free');
            assert.equal(org.subscription_tier, 'free');
            const reason = status === 'missing' ? 'missing_subscription_status' : 'subscription_not_live';
            if (path === 'webhook') {
              assert.equal(res.status, 200, JSON.stringify(body));
              assert.equal(body.applied, false);
              assert.equal(body.ignored, reason);
              assert.ok(
                warnings.some((args) => String(args[0]).includes('checkout.session.completed ignored')),
                'webhook refusal was not logged'
              );
            } else {
              assert.equal(res.status, 409, `${path} ${status} ${JSON.stringify(body)}`);
              assert.equal(body.applied === true, false);
              assert.equal(body.reason, reason);
              assert.match(String(body.error), /not upgraded/);
            }
          }
        } finally {
          console.warn = originalWarn;
          net.restore();
          restoreEnv();
        }
      });
    }
  }

  test('sync still applies a different active subscription after an old canceled session', async () => {
    const restoreEnv = useEnv();
    const db = emptyDb(false);
    const live: StripeObject = {
      id: 'sub_live',
      status: 'active',
      customer: 'cus_paid',
      metadata: planMeta(),
    };
    const net = installFetch(db, 'canceled', true, [live]);
    try {
      const res = await syncPost(syncRequest());
      const body = (await res.json()) as { applied?: boolean; plan?: string };
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.applied, true);
      assert.equal(body.plan, 'premium');
      assert.equal(db.organizations[0].is_premium, true);
      assert.equal(db.subscriptions[0]?.stripe_subscription_id, 'sub_live');
    } finally {
      net.restore();
      restoreEnv();
    }
  });

  test('sync with no checkout session stays a free no-op', async () => {
    const restoreEnv = useEnv();
    const db = emptyDb(false);
    const net = installFetch(db, 'canceled', true);
    const previous = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(href);
      if (url.hostname === 'api.stripe.com' && url.pathname.includes('checkout/sessions')) {
        return jsonResponse({ object: 'list', data: [] });
      }
      return previous(input, init);
    };
    try {
      const res = await syncPost(syncRequest());
      const body = (await res.json()) as { applied?: boolean; plan?: string };
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.applied, false);
      assert.equal(body.plan, 'free');
      assert.equal(db.organizations[0].is_premium, false);
      assert.equal(db.organizations[0].plan, 'free');
    } finally {
      globalThis.fetch = previous;
      net.restore();
      restoreEnv();
    }
  });

  test('checkout.session.completed after customer.subscription.deleted does not resurrect Premium', async () => {
    const restoreEnv = useEnv();
    const db = emptyDb(true);
    const net = installFetch(db, 'canceled', true);
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const deleted = await webhookPost(
        webhookRequest({
          id: 'evt_deleted',
          type: 'customer.subscription.deleted',
          data: { object: { id: 'sub_paid' } },
        })
      );
      const deletedBody = (await deleted.json()) as { downgraded?: boolean; plan?: string; ignored?: string };
      assert.equal(deleted.status, 200, JSON.stringify(deletedBody));
      assert.equal(deletedBody.downgraded, true);
      assert.equal(deletedBody.plan, 'free');
      assert.equal(db.organizations[0].is_premium, false);
      assert.equal(db.organizations[0].plan, 'free');
      assert.equal(db.organizations[0].subscription_tier, 'free');

      const completed = await webhookPost(webhookRequest(completedPayload()));
      const completedBody = (await completed.json()) as { applied?: boolean; ignored?: string; plan?: string };
      assert.equal(completed.status, 200, JSON.stringify(completedBody));
      assert.equal(completedBody.applied, false);
      assert.equal(completedBody.ignored, 'subscription_not_live');
      assert.equal(completedBody.plan, undefined);
      assert.equal(db.organizations[0].is_premium, false);
      assert.equal(db.organizations[0].plan, 'free');
      assert.equal(db.organizations[0].subscription_tier, 'free');
      assert.notEqual(db.subscriptions[0]?.tier, 'premium');
      assert.ok(warnings.some((args) => String(args[0]).includes('checkout.session.completed ignored')));
      assert.ok(net.urls.some((url) => url.includes('expand[]=subscription')));
    } finally {
      console.warn = originalWarn;
      net.restore();
      restoreEnv();
    }
  });

  test('a canceled session does not undo a subscription.deleted downgrade in memory', async () => {
    const state = {
      orgs: [orgRow(true)],
      subs: [
        {
          id: 1,
          organization_id: ORG_ID,
          user_id: 'user-1',
          stripe_subscription_id: 'sub_paid',
          status: 'active',
          tier: 'premium',
          platform: 'stripe',
        },
      ],
      customers: [{ id: 'cus-row-1', user_id: 'user-1', stripe_customer_id: 'cus_paid', email: 'tech@example.com' }],
      profiles: [{ id: 'user-1', organization_id: ORG_ID }],
      memberships: [{ user_id: 'user-1', organization_id: ORG_ID }],
      orgWrites: [] as Record<string, unknown>[],
    };
    const filtersFor = () => {
      const filters: Record<string, unknown> = {};
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Record<string, unknown> | null = null;
      return { filters, get op() { return op; }, set op(next) { op = next; }, get payload() { return payload; }, set payload(next) { payload = next; } };
    };
    const writer = {
      from(table: string) {
        const bag = filtersFor();
        const matches = (row: Record<string, unknown>) =>
          Object.entries(bag.filters).every(([col, val]) => String(row[col]) === String(val));
        const run = () => {
          if (table === 'organizations') {
            const rows = state.orgs.filter((row) => matches(row));
            if (bag.op === 'update' && bag.payload) {
              for (const org of rows) {
                Object.assign(org, bag.payload);
                state.orgWrites.push({ ...bag.payload });
              }
            }
            return { data: rows.map((row) => ({ ...row })), error: null };
          }
          if (table === 'subscriptions') {
            const rows = state.subs.filter((row) => matches(row as unknown as Record<string, unknown>));
            if (bag.op === 'update' && bag.payload) {
              for (const sub of rows) Object.assign(sub, bag.payload);
            }
            return { data: rows.map((row) => ({ ...row })), error: null };
          }
          if (table === 'stripe_customers') {
            const rows = state.customers.filter((row) => matches(row as unknown as Record<string, unknown>));
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
            bag.op = 'update';
            bag.payload = next;
            return api;
          },
          insert(next: Record<string, unknown>) {
            bag.op = 'insert';
            bag.payload = next;
            return api;
          },
          eq(col: string, val: unknown) {
            bag.filters[col] = val;
            return api;
          },
          maybeSingle: async () => {
            const result = run();
            return { data: result.data[0] || null, error: result.error };
          },
          then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve(run()).then(onFulfilled, onRejected);
          },
        };
        return api;
      },
    };

    const deleted = await applyBillingSubscriptionEvent({
      writer: writer as never,
      event: { type: 'customer.subscription.deleted', data: { object: { id: 'sub_paid' } } },
      retrieveSubscription: async () =>
        ({
          id: 'sub_paid',
          status: 'canceled',
          customer: 'cus_paid',
          metadata: planMeta(),
        }) as never,
      listLiveSubscriptions: async () => [],
    });
    assert.equal(deleted.body.downgraded, true);
    assert.equal(state.orgs[0].plan, 'free');
    const writes = state.orgWrites.length;

    const replay = await applyPaidCheckoutSession({
      writer: writer as never,
      session: sessionWithStatus('canceled'),
      allowMissingUser: true,
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, 'subscription_not_live');
    assert.equal(state.orgs[0].is_premium, false);
    assert.equal(state.orgs[0].plan, 'free');
    assert.equal(state.orgs[0].subscription_tier, 'free');
    assert.equal(state.orgWrites.length, writes);
  });
});
