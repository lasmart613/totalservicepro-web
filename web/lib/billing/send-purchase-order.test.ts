import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { NextRequest } from 'next/server';
import { DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR, resetDocumentSendRateLimit } from './send-rate-limit.ts';
import { runSendPurchaseOrder } from '../../app/api/billing/send-purchase-order/route.ts';

const FORGED_HTML = '<div id="forged-body">WIRE-TRANSFER-NOW</div>';
const FORGED_SUBJECT = 'WIRE SUBJECT';
const FORGED_SHOP = 'Spoofed Shop LLC';
const FORGED_REPLY = 'spoofed-reply@evil.test';
const FORGED_TO = 'spoofed-to@evil.test';
const SHOP = 'Cedar Laser Service';
const SHOP_EMAIL = 'shop@cedar.test';
const VENDOR_EMAIL = 'vendor@acme.test';
const STORED_EMAIL = 'stored-supplier@parts.test';
const PART = 'Stored handpiece';

const shopOrg = {
  id: 7,
  name: SHOP,
  email: SHOP_EMAIL,
  type: 'laser_service',
  address: '1 Main',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  phone: '512-555-0100',
};

const vendorOrg = {
  id: 3,
  name: 'Acme Optics',
  email: VENDOR_EMAIL,
  type: 'parts_supplier',
};

const attackerOrg = {
  id: 999,
  name: FORGED_SHOP,
  email: FORGED_TO,
  type: 'parts_supplier',
};

const profile = {
  id: 'user-1',
  organization_id: 7,
  first_name: 'Ada',
  last_name: 'Lovelace',
};

function poRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    organization_id: 7,
    supplier_organization_id: 3,
    supplier_name: 'Acme Optics',
    supplier_email: STORED_EMAIL,
    po_number: 'PO-100',
    po_date: '2026-08-25',
    needed_by: '2026-09-01',
    description: 'Ship to the bench',
    subtotal: 20,
    tax: 0,
    total: 20,
    status: 'draft',
    po_data: {
      line_items: [{ part_number: 'HP-1', description: PART, qty: 2, unit_price: 10, ext: 20 }],
      shipTo: 'Cedar bench',
      supAddress: '9 Vendor Rd',
    },
    ...overrides,
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
  return new NextRequest('https://repairplanet.net/api/billing/send-purchase-order', {
    method: 'POST',
    headers: {
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const forgedBody = {
  purchase_order_id: 42,
  po_id: 99,
  html: FORGED_HTML,
  subject: FORGED_SUBJECT,
  company_name: FORGED_SHOP,
  replyTo: FORGED_REPLY,
  reply_to: FORGED_REPLY,
  supplier_organization_id: 999,
  recipient: FORGED_TO,
  to: FORGED_TO,
  supplier_email: FORGED_TO,
  supplier_name: FORGED_SHOP,
};

async function withResend<T>(run: (sent: Record<string, unknown>[]) => Promise<T>): Promise<T> {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'resend-test';
  const sent: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('api.resend.com')) {
      sent.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: 'msg-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as typeof fetch;
  try {
    return await run(sent);
  } finally {
    globalThis.fetch = original;
    if (previous == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
}

function assertServerMail(message: Record<string, unknown>, recipient: string) {
  const html = String(message.html || '');
  const text = String(message.text || '');
  const packed = `${message.subject}\n${html}\n${text}\n${message.reply_to}`;
  assert.deepEqual(message.to, [recipient]);
  assert.equal(message.subject, `Purchase Order PO-100 from ${SHOP}`);
  assert.equal(message.reply_to, SHOP_EMAIL);
  assert.match(html, new RegExp(PART));
  assert.match(html, new RegExp(SHOP));
  assert.match(html, /Vendor \/ Parts Supplier/);
  assert.match(text, new RegExp(PART));
  assert.match(text, new RegExp(SHOP));
  assert.equal(packed.includes(FORGED_HTML), false);
  assert.equal(packed.includes('WIRE-TRANSFER-NOW'), false);
  assert.equal(packed.includes(FORGED_SUBJECT), false);
  assert.equal(packed.includes(FORGED_SHOP), false);
  assert.equal(packed.includes(FORGED_REPLY), false);
  assert.equal(packed.includes(FORGED_TO), false);
}

describe('send purchase order', { concurrency: false }, () => {
  test('forged html, subject, company name, and reply-to are ignored', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg, attackerOrg],
      purchase_orders: [poRow(), poRow({ id: 99, organization_id: 8, po_number: 'PO-OTHER', supplier_email: 'victim@other.test' })],
    });
    await withResend(async (sent) => {
      const res = await runSendPurchaseOrder(request(forgedBody), {
        userClient: db as never,
        adminClient: null,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.emailSent, true);
      assert.equal(json.to, VENDOR_EMAIL);
      assert.equal(sent.length, 1);
      assertServerMail(sent[0], VENDOR_EMAIL);
      assert.equal(db.updates[0]?.patch.supplier_email, VENDOR_EMAIL);
      assert.equal(db.updates[0]?.patch.status, 'sent');
    });
  });

  test('forged supplier organization id and recipient are ignored', async () => {
    resetDocumentSendRateLimit();
    const linked = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg, attackerOrg],
      purchase_orders: [poRow()],
    });
    const storedOnly = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, email: '' }, attackerOrg],
      purchase_orders: [poRow({ supplier_email: STORED_EMAIL })],
    });
    const clinicOrg = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: 'customer', email: 'clinic@victim.test' }, attackerOrg],
      purchase_orders: [poRow()],
    });
    await withResend(async (sent) => {
      const linkedRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: linked as never,
        adminClient: null,
      });
      assert.equal(linkedRes.status, 200);
      assert.equal((await linkedRes.json()).to, VENDOR_EMAIL);

      const storedRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: storedOnly as never,
        adminClient: null,
      });
      assert.equal(storedRes.status, 200);
      assert.equal((await storedRes.json()).to, STORED_EMAIL);

      const clinicRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: clinicOrg as never,
        adminClient: null,
      });
      assert.equal(clinicRes.status, 200);
      assert.equal((await clinicRes.json()).to, STORED_EMAIL);

      assert.deepEqual(
        sent.map((message) => message.to),
        [[VENDOR_EMAIL], [STORED_EMAIL], [STORED_EMAIL]]
      );
      for (const message of sent) {
        const packed = JSON.stringify(message);
        assert.equal(packed.includes(FORGED_TO), false);
        assert.equal(packed.includes('clinic@victim.test'), false);
      }
    });
  });

  test("another organization's purchase order returns 403, same as a missing one", async () => {
    resetDocumentSendRateLimit();
    const foreign = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      purchase_orders: [
        poRow({
          id: 99,
          organization_id: 8,
          supplier_email: 'victim@other.test',
          supplier_name: 'Other Org Supplier',
        }),
      ],
    });
    const missing = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      purchase_orders: [],
    });
    await withResend(async (sent) => {
      const foreignRes = await runSendPurchaseOrder(request({ purchase_order_id: 99, html: FORGED_HTML }), {
        userClient: foreign as never,
        adminClient: null,
      });
      const missingRes = await runSendPurchaseOrder(request({ purchase_order_id: 77, html: FORGED_HTML }), {
        userClient: missing as never,
        adminClient: null,
      });
      const foreignJson = await foreignRes.json();
      const missingJson = await missingRes.json();
      assert.equal(foreignRes.status, 403);
      assert.equal(missingRes.status, 403);
      assert.deepEqual(foreignJson, missingJson);
      assert.equal(foreignJson.error, 'Purchase order not found.');
      assert.equal(JSON.stringify(foreignJson).includes('victim@other.test'), false);
      assert.equal(JSON.stringify(foreignJson).includes('another organization'), false);
      assert.equal(sent.length, 0);
      assert.equal(foreign.updates.length, 0);
    });
  });

  test('the document send cap returns 429', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow()],
    });
    await withResend(async (sent) => {
      for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
        const res = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
          userClient: db as never,
          adminClient: null,
        });
        assert.equal(res.status, 200, `send ${n + 1}`);
      }
      const blocked = await runSendPurchaseOrder(
        request({ purchase_order_id: 42, html: FORGED_HTML, recipient: FORGED_TO }),
        { userClient: db as never, adminClient: null }
      );
      const json = await blocked.json();
      assert.equal(blocked.status, 429);
      assert.equal(json.rateLimited, true);
      assert.match(json.error, /5 emails per hour/);
      assert.equal(sent.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
      assert.equal(sent.some((message) => JSON.stringify(message).includes(FORGED_HTML)), false);
    });
  });

  test('an invalid or missing supplier email returns 400', async () => {
    resetDocumentSendRateLimit();
    const invalid = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, email: 'not-an-email' }],
      purchase_orders: [poRow({ supplier_email: 'also-not-an-email' })],
    });
    const missingEmail = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg],
      purchase_orders: [poRow({ supplier_organization_id: null, supplier_email: null })],
    });
    await withResend(async (sent) => {
      const invalidRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: invalid as never,
        adminClient: null,
      });
      const missingRes = await runSendPurchaseOrder(request({ purchase_order_id: 42, recipient: FORGED_TO }), {
        userClient: missingEmail as never,
        adminClient: null,
      });
      assert.equal(invalidRes.status, 400);
      assert.equal(missingRes.status, 400);
      assert.match((await invalidRes.json()).error, /No valid supplier email/);
      assert.match((await missingRes.json()).error, /No valid supplier email/);
      assert.equal(sent.length, 0);
      assert.equal(invalid.updates.length, 0);
      assert.equal(missingEmail.updates.length, 0);
    });
  });

  test('a stored purchase order still sends', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow()],
    });
    await withResend(async (sent) => {
      const res = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: db as never,
        adminClient: null,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.emailSent, true);
      assert.equal(json.to, VENDOR_EMAIL);
      assert.equal(json.purchaseOrderId, 42);
      assert.equal(sent.length, 1);
      assertServerMail(sent[0], VENDOR_EMAIL);
      assert.equal(db.updates.length, 1);
      assert.equal(db.updates[0].table, 'purchase_orders');
      assert.equal(db.updates[0].patch.status, 'sent');
      assert.equal(db.updates[0].patch.supplier_email, VENDOR_EMAIL);
    });
  });
});
