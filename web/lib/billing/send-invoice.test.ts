import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { NextRequest } from 'next/server';
import { DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR, resetDocumentSendRateLimit } from './send-rate-limit.ts';
import { runSendInvoice } from '../../app/api/billing/send-invoice/route.ts';

const CLINIC = 'clinic@cedar.test';
const SHOP = 'Cedar Laser Service';

const shopOrg = {
  id: 7,
  name: SHOP,
  email: 'shop@cedar.test',
  type: 'laser_service',
  address: '1 Main',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  phone: '512-555-0100',
};

const profile = {
  id: 'user-1',
  organization_id: 7,
  first_name: 'Ada',
  last_name: 'Lovelace',
};

function invoiceRow() {
  return {
    id: 42,
    organization_id: 7,
    customer_name: 'Cedar Clinic',
    invoice_number: 'INV-100',
    total: 120,
    amount_paid: 0,
    status: 'draft',
    invoice_data: {
      custEmail: CLINIC,
      line_items: [{ description: 'Handpiece service', qty: 1, unit_price: 120, ext: 120 }],
    },
  };
}

function memoryClient(tables: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const client = {
    updates,
    from(table: string) {
      const filters: { col: string; val: unknown }[] = [];
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return api;
        },
        maybeSingle: async () => {
          const found = (tables[table] || []).find((row) =>
            filters.every((f) => row[f.col] != null && String(row[f.col]) === String(f.val))
          );
          return { data: found || null, error: null };
        },
        update(patch: Record<string, unknown>) {
          updates.push({ table, patch });
          const upd = {
            eq() {
              return upd;
            },
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
            },
          };
          return upd;
        },
      };
      return api;
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
  };
  return client;
}

function request(body: unknown) {
  return new NextRequest('https://repairplanet.net/api/billing/send-invoice', {
    method: 'POST',
    headers: {
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function checkoutSpy() {
  const calls: Record<string, unknown>[] = [];
  const createCheckout = async (input: Record<string, unknown>) => {
    calls.push(input);
    return {
      ok: true as const,
      url: 'https://pay.example/session-1',
      sessionId: `session-${calls.length}`,
      livemode: null,
    };
  };
  return { calls, createCheckout };
}

async function withEnv<T>(
  env: { resend?: string | null; stripe?: string | null },
  run: () => Promise<T>
): Promise<T> {
  const previousResend = process.env.RESEND_API_KEY;
  const previousStripe = process.env.STRIPE_SECRET_KEY;
  if (env.resend === null) delete process.env.RESEND_API_KEY;
  else if (env.resend != null) process.env.RESEND_API_KEY = env.resend;
  if (env.stripe === null) delete process.env.STRIPE_SECRET_KEY;
  else if (env.stripe != null) process.env.STRIPE_SECRET_KEY = env.stripe;
  try {
    return await run();
  } finally {
    if (previousResend == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousStripe == null) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousStripe;
  }
}

function installFetch(handler: (url: string, call: number) => Response | Promise<Response> | 'throw') {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: unknown) => {
    const target = String(url);
    if (!target.includes('api.resend.com')) throw new Error(`unexpected fetch ${target}`);
    calls += 1;
    const outcome = await handler(target, calls);
    if (outcome === 'throw') throw new Error('provider threw');
    return outcome;
  }) as typeof fetch;
  return {
    restore() {
      globalThis.fetch = original;
    },
    get calls() {
      return calls;
    },
  };
}

describe('send invoice', { concurrency: false }, () => {
  test('a missing Resend key returns 503 and does not create a Checkout session', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [invoiceRow()],
    });
    const checkout = checkoutSpy();
    const fetchLog = installFetch(() => {
      throw new Error('resend should not be called');
    });
    try {
      await withEnv({ resend: null, stripe: 'unit-stripe' }, async () => {
        const res = await runSendInvoice(request({ invoice_id: 42, include_payment_link: true }), {
          userClient: db as never,
          adminClient: null,
          createCheckout: checkout.createCheckout as never,
        });
        const json = await res.json();
        assert.equal(res.status, 503);
        assert.equal(json.ok, false);
        assert.equal(json.emailSent, false);
        assert.equal(json.needsConfig, true);
        assert.match(json.error, /RESEND_API_KEY/);
        assert.equal(checkout.calls.length, 0);
        assert.equal(db.updates.length, 0);
        assert.equal(fetchLog.calls, 0);
      });
    } finally {
      fetchLog.restore();
    }
  });

  test('a provider failure after Checkout keeps the slot so the next sends hit 429', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [invoiceRow()],
    });
    const checkout = checkoutSpy();
    const fetchLog = installFetch((_url, call) => {
      if (call < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) {
        return new Response(JSON.stringify({ message: 'provider down' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (call === DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) return 'throw';
      return new Response(JSON.stringify({ id: 'msg-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      await withEnv({ resend: 'resend-test', stripe: 'unit-stripe' }, async () => {
        for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR - 1; n++) {
          const res = await runSendInvoice(request({ invoice_id: 42 }), {
            userClient: db as never,
            adminClient: null,
            createCheckout: checkout.createCheckout as never,
          });
          assert.equal(res.status, 502, `provider failure ${n + 1}`);
        }
        const thrown = await runSendInvoice(request({ invoice_id: 42 }), {
          userClient: db as never,
          adminClient: null,
          createCheckout: checkout.createCheckout as never,
        });
        assert.equal(thrown.status, 500);
        assert.equal(checkout.calls.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        assert.equal(db.updates.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);

        for (let n = 0; n < 2; n++) {
          const blocked = await runSendInvoice(request({ invoice_id: 42 }), {
            userClient: db as never,
            adminClient: null,
            createCheckout: checkout.createCheckout as never,
          });
          const json = await blocked.json();
          assert.equal(blocked.status, 429, `send past the cap ${n + 1}`);
          assert.equal(json.rateLimited, true);
          assert.match(json.error, /5 emails per hour/);
        }
        assert.equal(checkout.calls.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        assert.equal(db.updates.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        assert.equal(fetchLog.calls, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
      });
    } finally {
      fetchLog.restore();
    }
  });

  test('a failure before Checkout still releases the slot', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [invoiceRow()],
    });
    const calls: Record<string, unknown>[] = [];
    let checkoutMode: 'fail' | 'throw' | 'ok' = 'fail';
    const createCheckout = async (input: Record<string, unknown>) => {
      calls.push(input);
      if (checkoutMode === 'throw') throw new Error('checkout threw');
      if (checkoutMode === 'fail') {
        return { ok: false as const, code: 'stripe_error', message: 'no session', prompt: null };
      }
      return {
        ok: true as const,
        url: 'https://pay.example/session-1',
        sessionId: 'session-1',
        livemode: null,
      };
    };
    let mode: 'throw' | 'fail' | 'ok' = 'throw';
    const fetchLog = installFetch(() => {
      if (mode === 'throw') return 'throw';
      if (mode === 'fail') {
        return new Response(JSON.stringify({ message: 'provider down' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'msg-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      await withEnv({ resend: 'resend-test', stripe: 'unit-stripe' }, async () => {
        const deps = {
          userClient: db as never,
          adminClient: null,
          createCheckout: createCheckout as never,
        };
        const thrown = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
        assert.equal(thrown.status, 500);
        mode = 'fail';
        const failed = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
        assert.equal(failed.status, 502);
        assert.equal(calls.length, 0);
        assert.equal(db.updates.length, 0);

        mode = 'fail';
        checkoutMode = 'fail';
        const noSession = await runSendInvoice(request({ invoice_id: 42, include_payment_link: true }), deps);
        assert.equal(noSession.status, 502);
        checkoutMode = 'throw';
        const checkoutThrew = await runSendInvoice(request({ invoice_id: 42, include_payment_link: true }), deps);
        assert.equal(checkoutThrew.status, 500);
        assert.equal(calls.length, 2);
        assert.equal(db.updates.length, 0);

        mode = 'ok';
        checkoutMode = 'ok';
        for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
          const res = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
          assert.equal(res.status, 200, `retry ${n + 1}`);
        }
        const blocked = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
        const json = await blocked.json();
        assert.equal(blocked.status, 429);
        assert.equal(json.rateLimited, true);
        assert.equal(calls.length, 2);
        assert.equal(db.updates.length, 0);
      });
    } finally {
      fetchLog.restore();
    }
  });
});
