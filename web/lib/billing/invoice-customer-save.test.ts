import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  invoiceCustomerDraftFromHit,
  invoiceCustomerWrite,
  invoiceSaveToast,
  sameInvoiceCustomer,
} from './invoice-customer-save.ts';

test('a search hit becomes the customer id and clinic fields the save writes', () => {
  const draft = invoiceCustomerDraftFromHit({
    id: 88,
    name: ' Oak Park Dermatology ',
    address: '1 Main',
    city: 'Oak Park',
    state: 'IL',
    zip: '60302',
    phone: '555',
    email: 'a@b.c',
    contact: 'Pat',
  });
  const write = invoiceCustomerWrite(draft);
  assert.equal(write.customer_name, 'Oak Park Dermatology');
  assert.equal(write.customer_organization_id, 88);
  assert.equal(write.invoiceData.address, '1 Main');
  assert.equal(write.invoiceData.city, 'Oak Park');
  assert.equal(write.invoiceData.phone, '555');
  assert.equal(write.invoiceData.email, 'a@b.c');
  assert.equal(write.invoiceData.contact, 'Pat');
  assert.equal(sameInvoiceCustomer(draft, { ...draft, name: 'Oak Park Dermatology' }), true);
  assert.equal(sameInvoiceCustomer(draft, { ...draft, orgId: 89 }), false);
});

test('the success toast is only for a write that returned a row', () => {
  assert.equal(invoiceSaveToast({ unchanged: false, persisted: true }), 'saved');
  assert.equal(invoiceSaveToast({ unchanged: true, persisted: false }), 'unchanged');
  assert.equal(invoiceSaveToast({ unchanged: false, persisted: false }), 'failed');
});

test('the invoice editor does not load the org customer list, and save reads the picked customer', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../app/invoices/new/InvoiceFormClient.tsx'),
    'utf8'
  );
  const init = src.slice(src.indexOf('useEffect(() => {'), src.indexOf('function updateLine'));
  assert.doesNotMatch(init, /refreshCustomers\([^)]*''\)/);
  assert.match(src, /showCustomer\(invoiceCustomerDraftFromHit\(c\)\)/);
  assert.match(src, /invoiceCustomerWrite\(customerRef\.current\)/);
  assert.match(src, /invoiceSaveToast/);
  assert.match(src, /formTouchedRef\.current/);
  const noticeAt = src.indexOf('invoiceSaveToast(');
  const savedToastAt = src.indexOf("toast.success('Invoice draft saved!')");
  assert.ok(noticeAt > 0 && savedToastAt > noticeAt);
});
