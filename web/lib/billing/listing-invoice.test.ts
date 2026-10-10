import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendListingLine,
  buildNewListingInvoicePayload,
  canAddListingToInvoice,
  canShowAddListingToInvoice,
  draftInvoiceOptionLabel,
  invoiceEditPath,
  isDraftInvoiceStatus,
  isPlaceholderInvoiceLine,
  lineItemFromStored,
  listingOrgIdVisibleToViewer,
  listingToInvoiceLine,
  mergeListingOntoDraft,
  listingInvoiceBlockReason,
  parseInvoiceQty,
  runAddListingToInvoice,
  type ListingInvoiceIo,
  type ListingInvoiceSource,
} from './listing-invoice.ts';

const here = dirname(fileURLToPath(import.meta.url));

const flashlamp = {
  id: 'lst_flash',
  title: 'Candela GentleMax flashlamp',
  part_number: 'FL-100',
  price: 250,
  manufacturer: 'Candela',
  model: 'GentleMax',
};

const ownListing: ListingInvoiceSource = { ...flashlamp, organization_id: 7 };
const foreignListing: ListingInvoiceSource = {
  id: 'lst_other',
  title: 'Someone else flashlamp',
  part_number: 'FL-9',
  price: 80,
  organization_id: 99,
};

test('service-company orgs can add a listing to an invoice', () => {
  assert.equal(canAddListingToInvoice('service_company'), true);
  assert.equal(canAddListingToInvoice('service'), true);
  assert.equal(canAddListingToInvoice('customer'), false);
  assert.equal(canAddListingToInvoice('laser_clinic'), false);
  assert.equal(canAddListingToInvoice('laser_rental'), false);
  assert.equal(canAddListingToInvoice('laser_reseller'), false);
  assert.equal(canAddListingToInvoice('parts_supplier'), false);
  assert.equal(canAddListingToInvoice('vendor'), false);
  assert.equal(canAddListingToInvoice(null), false);
});

test('listing line uses title, part number, qty, and list price', () => {
  const line = listingToInvoiceLine(flashlamp, 1, 'line1');
  assert.equal(line.id, 'line1');
  assert.equal(line.description, 'Candela GentleMax flashlamp');
  assert.equal(line.part_number, 'FL-100');
  assert.equal(line.qty, 1);
  assert.equal(line.unit_price, 250);
  assert.equal(line.ext, 250);
  assert.equal(line.marketplace_listing_id, 'lst_flash');
});

test('quantity is editable and sku fills a missing part number', () => {
  const line = listingToInvoiceLine(
    { id: 42, title: 'Tip', price: '12.5', details: { sku: 'TIP-9' } },
    3,
    'line2'
  );
  assert.equal(line.part_number, 'TIP-9');
  assert.equal(line.qty, 3);
  assert.equal(line.unit_price, 12.5);
  assert.equal(line.ext, 37.5);
  assert.equal(line.marketplace_listing_id, '42');
});

test('contact-for-price listings start at zero and still keep the listing id', () => {
  const line = listingToInvoiceLine(
    { id: 'lst_ask', title: 'Used system', price_type: 'contact', price: 9999 },
    1,
    'line3'
  );
  assert.equal(line.unit_price, 0);
  assert.equal(line.ext, 0);
  assert.equal(line.description, 'Used system');
  assert.equal(line.marketplace_listing_id, 'lst_ask');
});

test('stored lines keep the listing reference through a form round trip', () => {
  const stored = lineItemFromStored(
    {
      id: 'line1',
      description: 'Candela GentleMax flashlamp',
      part_number: 'FL-100',
      qty: 2,
      unit_price: 250,
      ext: 500,
      marketplace_listing_id: 'lst_flash',
    },
    0
  );
  assert.equal(stored.marketplace_listing_id, 'lst_flash');
  assert.equal(stored.ext, 500);
  const again = lineItemFromStored(stored, 0);
  assert.equal(again.marketplace_listing_id, 'lst_flash');
});

test('append replaces a blank starter line and keeps real lines and Stripe keys', () => {
  const line = listingToInvoiceLine(flashlamp, 1, 'line-new');
  const patch = mergeListingOntoDraft(
    {
      tax: 10,
      amount_paid: 0,
      invoice_data: {
        line_items: [
          { id: 'old', description: 'Labor', qty: 1, unit_price: 100, ext: 100 },
          { id: 'blank', description: '', part_number: '', qty: 1, unit_price: 0, ext: 0 },
        ],
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        stripe_checkout_session_id: 'cs_test_abc',
        dueNow: 50,
        deferred: 60,
        partsDeposit: 50,
        deposit: 0,
      },
    },
    line
  );
  assert.deepEqual(Object.keys(patch).sort(), ['invoice_data', 'subtotal', 'total']);
  const lines = patch.invoice_data.line_items as Array<Record<string, unknown>>;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].description, 'Labor');
  assert.equal(lines[1].marketplace_listing_id, 'lst_flash');
  assert.equal(patch.subtotal, 350);
  assert.equal(patch.total, 360);
  assert.equal(patch.invoice_data.payment_url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  assert.equal(patch.invoice_data.stripe_checkout_session_id, 'cs_test_abc');
  assert.equal(patch.invoice_data.dueNow, 50);
  assert.equal(patch.invoice_data.deferred, 310);
  assert.equal(patch.invoice_data.status, undefined);
});

test('a full-charge draft stays fully due after the listing is added', () => {
  const line = listingToInvoiceLine(flashlamp, 1, 'line-new');
  const patch = mergeListingOntoDraft(
    {
      total: 100,
      tax: 0,
      amount_paid: 0,
      invoice_data: {
        line_items: [{ id: 'old', description: 'Labor', qty: 1, unit_price: 100, ext: 100 }],
        dueNow: 100,
        deferred: 0,
        partsDeposit: 0,
        deferredReleased: false,
        payment_url: 'https://checkout.stripe.com/c/pay/cs_test_keep',
      },
    },
    line
  );
  assert.equal(patch.total, 350);
  assert.equal(patch.invoice_data.dueNow, 350);
  assert.equal(patch.invoice_data.deferred, 0);
  assert.equal(patch.invoice_data.partsDeposit, 0);
  assert.equal(patch.invoice_data.payment_url, 'https://checkout.stripe.com/c/pay/cs_test_keep');
});

test('placeholder detection ignores qty on an empty row', () => {
  assert.equal(
    isPlaceholderInvoiceLine({ description: '', part_number: '', qty: 1, unit_price: 0, ext: 0 }),
    true
  );
  assert.equal(
    isPlaceholderInvoiceLine({
      description: '',
      qty: 1,
      unit_price: 0,
      ext: 0,
      marketplace_listing_id: 'lst_flash',
    }),
    false
  );
  const only = appendListingLine(
    [{ description: '', qty: 1, unit_price: 0, ext: 0 }],
    listingToInvoiceLine(flashlamp, 1, 'only')
  );
  assert.equal(only.length, 1);
  assert.equal(only[0].id, 'only');
});

test('new invoice is a draft and does not invent a payment link', () => {
  const now = new Date('2026-09-29T15:04:05.000Z');
  const payload = buildNewListingInvoicePayload({
    orgId: 7,
    userId: 'user-1',
    customer: {
      id: 99,
      name: 'North Clinic',
      city: 'Austin',
      state: 'TX',
      email: 'billing@north.example',
    },
    listing: flashlamp,
    qty: 2,
    invoiceNumber: 'LPX-INV-20260929-01',
    now,
  });
  assert.equal(payload.status, 'draft');
  assert.equal(payload.customer_name, 'North Clinic');
  assert.equal(payload.organization_id, 7);
  assert.equal(payload.customer_organization_id, 99);
  assert.equal(payload.invoice_number, 'LPX-INV-20260929-01');
  assert.equal(payload.subtotal, 500);
  assert.equal(payload.total, 500);
  assert.equal(payload.tax, 0);
  assert.equal(payload.amount_paid, 0);
  assert.equal('payment_url' in payload, false);
  const data = payload.invoice_data as {
    line_items: Array<Record<string, unknown>>;
    payment_url?: string;
    custEmail?: string;
    manufacturer?: string;
    dueNow?: number;
    deferred?: number;
  };
  assert.equal(data.payment_url, undefined);
  assert.equal(data.line_items.length, 1);
  assert.equal(data.line_items[0].qty, 2);
  assert.equal(data.line_items[0].marketplace_listing_id, 'lst_flash');
  assert.equal(data.custEmail, 'billing@north.example');
  assert.equal(data.manufacturer, 'Candela');
  assert.equal(data.dueNow, 500);
  assert.equal(data.deferred, 0);
  assert.equal(invoiceEditPath(15), '/invoices/new?id=15');
});

test('draft labels and qty parsing', () => {
  assert.equal(isDraftInvoiceStatus('draft'), true);
  assert.equal(isDraftInvoiceStatus(null), true);
  assert.equal(isDraftInvoiceStatus('sent'), false);
  assert.equal(
    draftInvoiceOptionLabel({
      invoice_number: 'LPX-INV-20260929-01',
      customer_name: 'North Clinic',
      total: 250,
    }),
    'LPX-INV-20260929-01 · North Clinic · $250.00'
  );
  assert.equal(parseInvoiceQty('2'), 2);
  assert.equal(parseInvoiceQty('0'), null);
  assert.equal(parseInvoiceQty('-1'), null);
  assert.equal(parseInvoiceQty(''), null);
});

test('Add to invoice shows only when the listing organization is the active org', () => {
  assert.equal(canShowAddListingToInvoice('service_company', ownListing, 7), true);
  assert.equal(canShowAddListingToInvoice('service', ownListing, '7'), true);
  assert.equal(canShowAddListingToInvoice('service_company', foreignListing, 7), false);
  assert.equal(canShowAddListingToInvoice('service_company', { organization_id: 42 }, 7), false);
  assert.equal(canShowAddListingToInvoice('service_company', { organization_id: null }, 7), false);
  assert.equal(canShowAddListingToInvoice('service_company', ownListing, null), false);
  assert.equal(canShowAddListingToInvoice('laser_clinic', ownListing, 7), false);
  assert.equal(canShowAddListingToInvoice('parts_supplier', ownListing, 7), false);
  assert.equal(listingOrgIdVisibleToViewer(7, 7), 7);
  assert.equal(listingOrgIdVisibleToViewer(99, 7), undefined);
});

test('own listing invoice write succeeds and stores the listing id', async () => {
  const writes: Array<{ payload: Record<string, unknown>; existingId: string | number | null }> = [];
  const io: ListingInvoiceIo = {
    loadListing: async (id) => ({ ...ownListing, id }),
    loadDraft: async () => {
      throw new Error('draft should not load for a new invoice');
    },
    loadCustomer: async () => ({ id: 99, name: 'North Clinic', email: 'billing@north.example' }),
    allocateInvoiceNumber: async () => 'LPX-INV-20260929-01',
    writeInvoice: async (payload, existingId) => {
      writes.push({ payload, existingId });
      return { id: 15, error: null };
    },
  };
  const result = await runAddListingToInvoice(
    { userId: 'user-1', activeOrgId: 7, orgType: 'service_company' },
    { listingId: 'lst_flash', qty: 1, mode: 'new', customerId: 99 },
    io,
    new Date('2026-09-29T15:04:05.000Z')
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.id, 15);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].existingId, null);
  assert.equal(writes[0].payload.organization_id, 7);
  assert.equal(writes[0].payload.status, 'draft');
  const data = writes[0].payload.invoice_data as { line_items: Array<Record<string, unknown>>; dueNow?: number };
  assert.equal(data.line_items[0].marketplace_listing_id, 'lst_flash');
  assert.equal(data.line_items[0].description, 'Candela GentleMax flashlamp');
  assert.equal(data.line_items[0].unit_price, 250);
  assert.equal(data.line_items[0].qty, 1);
  assert.equal(data.dueNow, 250);
});

test('another organization listing is hidden from the action and the server rejects it', async () => {
  assert.equal(canShowAddListingToInvoice('service_company', foreignListing, 7), false);
  let writes = 0;
  let drafts = 0;
  const io: ListingInvoiceIo = {
    loadListing: async () => foreignListing,
    loadDraft: async () => {
      drafts += 1;
      return null;
    },
    loadCustomer: async () => {
      throw new Error('customer should not load');
    },
    allocateInvoiceNumber: async () => {
      throw new Error('number should not allocate');
    },
    writeInvoice: async () => {
      writes += 1;
      return { id: 1, error: null };
    },
  };
  const result = await runAddListingToInvoice(
    { userId: 'user-1', activeOrgId: 7, orgType: 'service_company' },
    { listingId: 'lst_other', qty: 1, mode: 'new', customerId: 99 },
    io
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
  assert.equal(result.error, 'Listing not found');
  assert.equal(writes, 0);
  assert.equal(drafts, 0);
});

test('updating a draft also rejects a foreign listing before the invoice is touched', async () => {
  let writes = 0;
  const result = await runAddListingToInvoice(
    { userId: 'user-1', activeOrgId: 7, orgType: 'service_company' },
    { listingId: 'lst_other', qty: 2, mode: 'existing', invoiceId: 4 },
    {
      loadListing: async () => ({ ...foreignListing, organization_id: '99' }),
      loadDraft: async () => {
        throw new Error('draft should not load');
      },
      loadCustomer: async () => null,
      allocateInvoiceNumber: async () => null,
      writeInvoice: async () => {
        writes += 1;
        return { id: 4, error: null };
      },
    }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 404);
  assert.equal(result.error, 'Listing not found');
  assert.equal(writes, 0);
});

test('a missing listing and another organization listing are the same not-found', () => {
  const actor = { activeOrgId: 7, orgType: 'service_company' };
  const missing = listingInvoiceBlockReason(actor, null);
  const blank = listingInvoiceBlockReason(actor, { id: '  ', organization_id: 7 });
  const foreign = listingInvoiceBlockReason(actor, foreignListing);
  assert.deepEqual(missing, foreign);
  assert.deepEqual(blank, foreign);
  assert.deepEqual(foreign, { ok: false, status: 404, error: 'Listing not found' });
});

test('a missing draft and another organization draft are the same not-found', async () => {
  const actor = { userId: 'user-1', activeOrgId: 7, orgType: 'service_company' };
  const request = { listingId: 'lst_flash', qty: 1, mode: 'existing', invoiceId: 4 };
  const io = (draft: { id: number; organization_id: number; status: string } | null): ListingInvoiceIo => ({
    loadListing: async () => ownListing,
    loadDraft: async () => draft,
    loadCustomer: async () => {
      throw new Error('customer should not load');
    },
    allocateInvoiceNumber: async () => {
      throw new Error('number should not allocate');
    },
    writeInvoice: async () => {
      throw new Error('invoice should not be written');
    },
  });
  const missing = await runAddListingToInvoice(actor, request, io(null));
  const foreign = await runAddListingToInvoice(
    actor,
    request,
    io({ id: 4, organization_id: 99, status: 'draft' })
  );
  assert.deepEqual(missing, foreign);
  assert.deepEqual(missing, { ok: false, status: 404, error: 'Invoice not found' });
});

test('own listing can be appended to an existing draft and keeps the deposit split', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const result = await runAddListingToInvoice(
    { userId: 'user-1', activeOrgId: 7, orgType: 'service' },
    { listingId: 'lst_flash', qty: 1, mode: 'existing', invoiceId: 4 },
    {
      loadListing: async () => ownListing,
      loadDraft: async () => ({
        id: 4,
        status: 'draft',
        organization_id: 7,
        tax: 0,
        amount_paid: 0,
        total: 100,
        invoice_data: {
          line_items: [{ id: 'old', description: 'Labor', qty: 1, unit_price: 100, ext: 100 }],
          dueNow: 40,
          deferred: 60,
          partsDeposit: 40,
        },
      }),
      loadCustomer: async () => null,
      allocateInvoiceNumber: async () => null,
      writeInvoice: async (payload) => {
        writes.push(payload);
        return { id: 4, error: null };
      },
    }
  );
  assert.equal(result.ok, true);
  const data = writes[0].invoice_data as {
    line_items: Array<Record<string, unknown>>;
    dueNow?: number;
    deferred?: number;
  };
  assert.equal(data.line_items[1].marketplace_listing_id, 'lst_flash');
  assert.equal(data.dueNow, 40);
  assert.equal(data.deferred, 310);
  assert.equal(writes[0].total, 350);
});

test('listing invoice route compares the stored organization and ignores the client', () => {
  const route = readFileSync(join(here, '../../app/api/billing/listing-invoice/route.ts'), 'utf8');
  const button = readFileSync(join(here, '../../components/marketplace/AddListingToInvoice.tsx'), 'utf8');
  assert.match(route, /from\('user_profiles'\)/);
  assert.match(route, /organization_id/);
  assert.match(route, /from\('marketplace_listings'\)/);
  assert.match(route, /runAddListingToInvoice/);
  assert.doesNotMatch(route, /body\.organization_id/);
  assert.match(route, /if \(!result\.ok\)/);
  assert.match(route, /status: result\.status/);
  assert.match(button, /if \(!canShowAddListingToInvoice\([\s\S]*?\)\) return null;/);
  assert.match(button, /\/api\/billing\/listing-invoice/);
  assert.doesNotMatch(button, /writeWithColumnRetry/);
  assert.doesNotMatch(button, /disabled=\{!canShowAddListingToInvoice/);
});

test('detail and storefront cards pass the listing organization into Add to invoice', () => {
  for (const rel of [
    '../../app/marketplace/listing/[id]/page.tsx',
    '../../app/marketplace/parts/[id]/page.tsx',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /organization_id: listing\.organization_id/);
  }
  const storefront = readFileSync(join(here, '../../app/marketplace/sellers/[slug]/page.tsx'), 'utf8');
  assert.match(storefront, /organization_id: l\.organization_id/);
});

test('invoice edit page reloads listing ids instead of dropping them', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  assert.match(src, /lineItemFromStored/);
  assert.match(src, /marketplace_listing_id/);
  const loadStart = src.indexOf('const lines = idata.line_items');
  const loadEnd = src.indexOf('const prefillFromEstimate');
  const loadFn = src.slice(loadStart, loadEnd);
  assert.match(loadFn, /lineItemFromStored/);
  assert.doesNotMatch(loadFn, /part_number: li\.part_number/);
});
