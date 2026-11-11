import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { NextRequest } from 'next/server';
import { DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR, resetDocumentSendRateLimit } from './send-rate-limit.ts';
import { runSendInvoice } from '../../app/api/billing/send-invoice/route.ts';
import { DEFAULT_OPS_BCC_EMAIL } from '../mail/outgoing-mail.ts';

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

  test('checkout keeps the database slot and a failure before checkout releases it', async () => {
    resetDocumentSendRateLimit();
    const rows: { id: number; documentType: string }[] = [];
    const calls: string[] = [];
    let next = 1;
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [invoiceRow()],
    });
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      calls.push(fn);
      if (fn === 'take_document_send_slot') {
        const same = rows.filter((row) => row.documentType === String(args.p_document_type));
        if (same.length >= DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) {
          return {
            data: {
              ok: false,
              scope: 'document',
              message: 'This document has reached the limit of 5 emails per hour. Try again later.',
            },
            error: null,
          };
        }
        const id = next++;
        rows.push({ id, documentType: String(args.p_document_type) });
        return { data: { ok: true, id, stamp: id }, error: null };
      }
      if (fn === 'release_document_send_slot') {
        const id = Number(args.p_slot_id);
        const index = rows.findIndex((row) => row.id === id);
        if (index >= 0) rows.splice(index, 1);
        return { data: null, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    };
    Object.assign(db, { rpc });
    const checkout = checkoutSpy();
    let providerStatus = 502;
    const fetchLog = installFetch(() => {
      return new Response(JSON.stringify(providerStatus === 200 ? { id: 'msg-1' } : { message: 'provider down' }), {
        status: providerStatus,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      await withEnv({ resend: 'resend-test', stripe: 'unit-stripe' }, async () => {
        const deps = {
          userClient: db as never,
          adminClient: db as never,
          createCheckout: checkout.createCheckout as never,
        };
        for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
          const res = await runSendInvoice(request({ invoice_id: 42, include_payment_link: true }), deps);
          assert.equal(res.status, 502, `checkout kept ${n + 1}`);
        }
        assert.equal(rows.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        assert.equal(calls.filter((fn) => fn === 'release_document_send_slot').length, 0);
        assert.equal(checkout.calls.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        const blocked = await runSendInvoice(request({ invoice_id: 42, include_payment_link: true }), deps);
        const blockedJson = await blocked.json();
        assert.equal(blocked.status, 429);
        assert.equal(blockedJson.rateLimited, true);
        assert.equal(checkout.calls.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
        assert.equal(fetchLog.calls, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);

        rows.splice(0, rows.length);
        calls.length = 0;
        providerStatus = 502;
        const released = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
        assert.equal(released.status, 502);
        assert.equal(calls.filter((fn) => fn === 'release_document_send_slot').length, 1);
        assert.equal(rows.length, 0);
        providerStatus = 200;
        for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
          const res = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
          assert.equal(res.status, 200, `released retry ${n + 1}`);
        }
        const capped = await runSendInvoice(request({ invoice_id: 42, include_payment_link: false }), deps);
        assert.equal(capped.status, 429);
      });
    } finally {
      fetchLog.restore();
    }
  });

  test('personal payee changes the check line and not the shop name or Stripe destination', async () => {
    resetDocumentSendRateLimit();
    const personal = invoiceRow();
    personal.invoice_data = {
      custEmail: CLINIC,
      line_items: [{ description: 'Handpiece service', qty: 1, unit_price: 120, ext: 120 }],
      payee_kind: 'personal',
      payee_name: 'Priya Shah',
    };
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [personal],
    });
    const checkout = checkoutSpy();
    const original = globalThis.fetch;
    const previousBcc = process.env.APP_MAIL_BCC;
    delete process.env.APP_MAIL_BCC;
    let mailed: {
      from?: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      html?: string;
      reply_to?: string;
    } | null = null;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (!target.includes('api.resend.com')) throw new Error(`unexpected fetch ${target}`);
      mailed = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({ id: 'msg-personal' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await withEnv({ resend: 'resend-test', stripe: 'unit-stripe' }, async () => {
        const res = await runSendInvoice(
          request({
            invoice_id: 42,
            include_payment_link: true,
            company_name: 'Forged Shop',
            html: '<p>Forged body</p>',
          }),
          {
            userClient: db as never,
            adminClient: null,
            createCheckout: checkout.createCheckout as never,
          }
        );
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.emailSent, true);
        assert.equal(checkout.calls.length, 1);
        assert.equal(checkout.calls[0].companyName, 'Priya Shah');
        assert.equal(checkout.calls[0].destinationAccountId, undefined);
        assert.equal(checkout.calls[0].legacyPlatformCharge, true);
        assert.equal(checkout.calls[0].organizationId, undefined);
        assert.ok(mailed);
        assert.equal(mailed.subject, 'Invoice INV-100 from Cedar Laser Service');
        assert.match(mailed.from || '', /Total Service Pro|contact@medicalrepairnetwork.com/);
        assert.deepEqual(mailed.to, [CLINIC]);
        assert.equal(mailed.cc, undefined);
        assert.deepEqual(mailed.bcc, [DEFAULT_OPS_BCC_EMAIL]);
        assert.equal(mailed.reply_to, 'shop@cedar.test');
        const html = mailed.html || '';
        const header = html.slice(0, html.indexOf('Customer / Bill To'));
        const thanks = html.slice(html.lastIndexOf('<!--tsp-thanks-->'));
        assert.match(header, /Cedar Laser Service/);
        assert.doesNotMatch(header, /Priya Shah|Ada Lovelace/);
        assert.match(html, /Make checks payable to Priya Shah\./);
        assert.match(thanks, /Thank you for choosing Cedar Laser Service!/);
        assert.doesNotMatch(thanks, /Priya Shah|Ada Lovelace/);
        assert.match(html, /1 Main/);
        assert.match(html, /Prepared by/);
        assert.match(html, /Ada Lovelace/);
        assert.doesNotMatch(html, /Forged Shop|Forged body|Larry Smart/);
        assert.equal(db.updates.length, 1);
        const data = db.updates[0].patch.invoice_data as Record<string, unknown>;
        assert.equal(data.payee_kind, 'personal');
        assert.equal(data.payee_name, 'Priya Shah');
      });
    } finally {
      globalThis.fetch = original;
      if (previousBcc == null) delete process.env.APP_MAIL_BCC;
      else process.env.APP_MAIL_BCC = previousBcc;
    }
  });

  test('cc is sent and stored without changing the To recipient, status, amounts, or payee', async () => {
    resetDocumentSendRateLimit();
    const row = invoiceRow();
    row.invoice_data = {
      ...(row.invoice_data as Record<string, unknown>),
      payee_kind: 'personal',
      payee_name: 'Priya Shah',
    };
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      service_invoices: [row],
    });
    const sent: Record<string, unknown>[] = [];
    const original = globalThis.fetch;
    const previousBcc = process.env.APP_MAIL_BCC;
    delete process.env.APP_MAIL_BCC;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      if (!String(url).includes('api.resend.com')) throw new Error(`unexpected fetch ${String(url)}`);
      sent.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'msg-cc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await withEnv({ resend: 'resend-test', stripe: null }, async () => {
        const bad = await runSendInvoice(
          request({ invoice_id: 42, include_payment_link: false, cc: ['not-an-email', 'office@clinic.test'], to_email: 'attacker@evil.test' }),
          { userClient: db as never, adminClient: null }
        );
        const badJson = await bad.json();
        assert.equal(bad.status, 400);
        assert.match(badJson.error, /valid CC email/);
        assert.equal(sent.length, 0);
        assert.equal(db.updates.length, 0);

        const res = await runSendInvoice(
          request({
            invoice_id: 42,
            include_payment_link: false,
            cc: [' Office@Clinic.test ', CLINIC, 'boss@clinic.test', 'office@clinic.test'],
            to: 'attacker@evil.test',
            reply_to: 'attacker@evil.test',
          }),
          { userClient: db as never, adminClient: null }
        );
        const json = await res.json();
        assert.equal(res.status, 200);
        assert.equal(json.emailSent, true);
        assert.equal(json.to, CLINIC);
        assert.deepEqual(json.cc, ['Office@Clinic.test', 'boss@clinic.test']);
        assert.equal(JSON.stringify(json).includes(DEFAULT_OPS_BCC_EMAIL), false);
        assert.equal(sent.length, 1);
        const message = sent[0];
        assert.deepEqual(message.to, [CLINIC]);
        assert.deepEqual(message.cc, ['Office@Clinic.test', 'boss@clinic.test']);
        assert.deepEqual(message.bcc, [DEFAULT_OPS_BCC_EMAIL]);
        assert.equal(message.reply_to, 'shop@cedar.test');
        assert.equal(String(message.from).includes(DEFAULT_OPS_BCC_EMAIL), false);
        assert.equal(db.updates.length, 1);
        const patch = db.updates[0].patch;
        assert.deepEqual(Object.keys(patch), ['invoice_data']);
        const data = patch.invoice_data as Record<string, unknown>;
        assert.deepEqual(data.cc_emails, ['Office@Clinic.test', 'boss@clinic.test']);
        assert.equal(data.custEmail, CLINIC);
        assert.equal(data.payee_kind, 'personal');
        assert.equal(data.payee_name, 'Priya Shah');
        assert.equal(patch.status, undefined);
        assert.equal(patch.total, undefined);
        assert.equal(patch.amount_paid, undefined);
        assert.equal(patch.sent_at, undefined);
        assert.equal(patch.payee_kind, undefined);
        assert.equal(patch.payee_name, undefined);
      });
    } finally {
      globalThis.fetch = original;
      if (previousBcc == null) delete process.env.APP_MAIL_BCC;
      else process.env.APP_MAIL_BCC = previousBcc;
    }
  });
});
