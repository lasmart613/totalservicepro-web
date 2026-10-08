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

function assertNoMailbox(body: unknown) {
  const packed = JSON.stringify(body);
  assert.equal(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(packed), false, packed);
  assert.equal(packed.includes(VENDOR_EMAIL), false);
  assert.equal(packed.includes(STORED_EMAIL), false);
  assert.equal(packed.includes(FORGED_TO), false);
  assert.equal(packed.includes(SHOP_EMAIL), false);
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
        adminClient: db as never,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.emailSent, true);
      assert.equal(json.supplierName, 'Acme Optics');
      assert.equal(typeof json.sent_at, 'string');
      assertNoMailbox(json);
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
      const linkedJson = await linkedRes.json();
      assert.equal(linkedRes.status, 200);
      assert.equal(linkedJson.supplierName, 'Acme Optics');
      assertNoMailbox(linkedJson);

      const storedRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: storedOnly as never,
        adminClient: null,
      });
      const storedJson = await storedRes.json();
      assert.equal(storedRes.status, 200);
      assertNoMailbox(storedJson);

      const clinicRes = await runSendPurchaseOrder(request(forgedBody), {
        userClient: clinicOrg as never,
        adminClient: null,
      });
      const clinicJson = await clinicRes.json();
      assert.equal(clinicRes.status, 200);
      assert.equal(clinicJson.supplierName, 'Acme Optics');
      assertNoMailbox(clinicJson);
      assert.equal(JSON.stringify(clinicJson).includes('clinic@victim.test'), false);

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

  test('an email provider failure releases the document send slot', async () => {
    resetDocumentSendRateLimit();
    const db = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow()],
    });
    const previous = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 'resend-test';
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      if (!String(url).includes('api.resend.com')) throw new Error(`unexpected fetch ${String(url)}`);
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'provider down' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'msg-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const failed = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: db as never,
        adminClient: db as never,
      });
      const failedJson = await failed.json();
      assert.equal(failed.status, 502);
      assert.equal(failedJson.emailSent, false);
      assert.equal(db.updates.length, 0);

      for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
        const res = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
          userClient: db as never,
          adminClient: db as never,
        });
        assert.equal(res.status, 200, `send ${n + 1}`);
      }
      const blocked = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: db as never,
        adminClient: db as never,
      });
      const blockedJson = await blocked.json();
      assert.equal(blocked.status, 429);
      assert.equal(blockedJson.rateLimited, true);
      assert.equal(db.updates.length, DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR);
    } finally {
      globalThis.fetch = original;
      if (previous == null) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous;
    }
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
      const invalidJson = await invalidRes.json();
      const missingJson = await missingRes.json();
      assert.equal(invalidRes.status, 400);
      assert.equal(missingRes.status, 400);
      assert.match(invalidJson.error, /No valid supplier email/);
      assert.match(missingJson.error, /No valid supplier email/);
      assertNoMailbox(invalidJson);
      assertNoMailbox(missingJson);
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
        adminClient: db as never,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.emailSent, true);
      assert.equal(json.supplierName, 'Acme Optics');
      assert.equal(typeof json.sent_at, 'string');
      assert.equal(json.to, undefined);
      assert.equal(json.purchaseOrderId, undefined);
      assertNoMailbox(json);
      assert.equal(sent.length, 1);
      assertServerMail(sent[0], VENDOR_EMAIL);
      assert.equal(db.updates.length, 1);
      assert.equal(db.updates[0].table, 'purchase_orders');
      assert.equal(db.updates[0].patch.status, 'sent');
      assert.equal(db.updates[0].patch.supplier_email, VENDOR_EMAIL);
      assert.equal(db.updates[0].patch.sent_at, json.sent_at);
    });
  });

  test('a non-supplier organization falls back to supplier_email, or 400 when that address is missing', async () => {
    resetDocumentSendRateLimit();
    const clinicEmail = 'clinic@victim.test';
    const fallback = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: 'customer', email: clinicEmail, name: 'Clinic Victim' }],
      purchase_orders: [poRow({ supplier_email: STORED_EMAIL, supplier_name: 'Acme Optics' })],
    });
    const noFallback = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: 'laser_clinic', email: clinicEmail, name: 'Clinic Victim' }],
      purchase_orders: [poRow({ supplier_email: 'not-an-email', supplier_name: 'Acme Optics' })],
    });
    const emptyType = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: '', email: clinicEmail, name: 'Untitled Org' }],
      purchase_orders: [poRow({ supplier_email: null, supplier_name: 'Acme Optics' })],
    });
    await withResend(async (sent) => {
      const fallbackRes = await runSendPurchaseOrder(request({ purchase_order_id: 42, recipient: FORGED_TO }), {
        userClient: fallback as never,
        adminClient: null,
      });
      const fallbackJson = await fallbackRes.json();
      assert.equal(fallbackRes.status, 200);
      assert.equal(fallbackJson.ok, true);
      assert.equal(fallbackJson.supplierName, 'Acme Optics');
      assertNoMailbox(fallbackJson);
      assert.equal(sent.length, 1);
      assert.deepEqual(sent[0].to, [STORED_EMAIL]);
      assert.equal(JSON.stringify(sent[0]).includes(clinicEmail), false);

      const denied = await runSendPurchaseOrder(request({ purchase_order_id: 42, to: FORGED_TO }), {
        userClient: noFallback as never,
        adminClient: null,
      });
      const deniedJson = await denied.json();
      assert.equal(denied.status, 400);
      assert.match(deniedJson.error, /No valid supplier email/);
      assertNoMailbox(deniedJson);
      assert.equal(JSON.stringify(deniedJson).includes(clinicEmail), false);
      assert.equal(noFallback.updates.length, 0);

      const blankType = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: emptyType as never,
        adminClient: null,
      });
      const blankJson = await blankType.json();
      assert.equal(blankType.status, 400);
      assertNoMailbox(blankJson);
      assert.equal(JSON.stringify(blankJson).includes(clinicEmail), false);
      assert.equal(sent.length, 1);
      assert.equal(emptyType.updates.length, 0);
    });
  });

  test('vendor and supplier organization types send, and the response has no recipient address', async () => {
    resetDocumentSendRateLimit();
    const vendorTyped = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: 'vendor', name: 'Vendor Desk' }],
      purchase_orders: [poRow({ supplier_name: 'Stored label' })],
    });
    const supplierTyped = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, { ...vendorOrg, type: 'supplier', name: 'Supplier Desk', email: 'desk@supplier.test' }],
      purchase_orders: [poRow({ supplier_email: null, supplier_name: 'Stored label' })],
    });
    await withResend(async (sent) => {
      const vendorRes = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: vendorTyped as never,
        adminClient: vendorTyped as never,
      });
      const vendorJson = await vendorRes.json();
      assert.equal(vendorRes.status, 200);
      assert.equal(vendorJson.supplierName, 'Vendor Desk');
      assert.equal(typeof vendorJson.sent_at, 'string');
      assertNoMailbox(vendorJson);

      const supplierRes = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: supplierTyped as never,
        adminClient: supplierTyped as never,
      });
      const supplierJson = await supplierRes.json();
      assert.equal(supplierRes.status, 200);
      assert.equal(supplierJson.supplierName, 'Supplier Desk');
      assertNoMailbox(supplierJson);
      assert.equal(JSON.stringify(supplierJson).includes('desk@supplier.test'), false);

      assert.deepEqual(
        sent.map((message) => message.to),
        [[VENDOR_EMAIL], ['desk@supplier.test']]
      );
    });
  });

  test('the first send and a re-send stamp status and sent_at with the service role client', async () => {
    resetDocumentSendRateLimit();
    const firstUser = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow()],
    });
    const firstAdmin = memoryClient({});
    const originalSentAt = '2026-08-01T00:00:00.000Z';
    const againUser = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow({ status: 'sent', sent_at: originalSentAt })],
    });
    const againAdmin = memoryClient({});
    await withResend(async (sent) => {
      const first = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: firstUser as never,
        adminClient: firstAdmin as never,
      });
      const firstJson = await first.json();
      assert.equal(first.status, 200);
      assert.equal(firstJson.ok, true);
      assert.equal(firstJson.emailSent, true);
      assert.equal(typeof firstJson.sent_at, 'string');
      assert.equal(firstUser.updates.length, 0);
      assert.equal(firstAdmin.updates.length, 1);
      assert.equal(firstAdmin.updates[0].table, 'purchase_orders');
      assert.equal(firstAdmin.updates[0].patch.status, 'sent');
      assert.equal(firstAdmin.updates[0].patch.sent_at, firstJson.sent_at);
      assert.equal(firstAdmin.updates[0].patch.supplier_email, VENDOR_EMAIL);

      const again = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: againUser as never,
        adminClient: againAdmin as never,
      });
      const againJson = await again.json();
      assert.equal(again.status, 200);
      assert.equal(againJson.ok, true);
      assert.equal(againJson.emailSent, true);
      assert.equal(typeof againJson.sent_at, 'string');
      assert.notEqual(againJson.sent_at, originalSentAt);
      assert.equal(againUser.updates.length, 0);
      assert.equal(againAdmin.updates.length, 1);
      assert.equal(againAdmin.updates[0].patch.status, 'sent');
      assert.equal(againAdmin.updates[0].patch.sent_at, againJson.sent_at);
      assert.equal(sent.length, 2);
    });
  });

  test('a re-send without the service role client does not change sent_at', async () => {
    resetDocumentSendRateLimit();
    const originalSentAt = '2026-08-01T00:00:00.000Z';
    const user = memoryClient({
      user_profiles: [profile],
      organizations: [shopOrg, vendorOrg],
      purchase_orders: [poRow({ status: 'sent', sent_at: originalSentAt, supplier_email: VENDOR_EMAIL })],
    });
    await withResend(async (sent) => {
      const res = await runSendPurchaseOrder(request({ purchase_order_id: 42 }), {
        userClient: user as never,
        adminClient: null,
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.emailSent, true);
      assert.equal(json.sent_at, null);
      assert.equal(user.updates.length, 0);
      assert.equal(
        user.updates.some((update) => Object.prototype.hasOwnProperty.call(update.patch, 'sent_at')),
        false
      );
      assert.equal(sent.length, 1);
      assertNoMailbox(json);
    });
  });
});
