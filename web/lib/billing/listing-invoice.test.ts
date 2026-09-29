import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendListingLine,
  buildNewListingInvoicePayload,
  canAddListingToInvoice,
  draftInvoiceOptionLabel,
  invoiceEditPath,
  isDraftInvoiceStatus,
  isPlaceholderInvoiceLine,
  lineItemFromStored,
  listingToInvoiceLine,
  mergeListingOntoDraft,
  parseInvoiceQty,
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
