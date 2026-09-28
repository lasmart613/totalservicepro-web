import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceDataForSave, mergeFormInvoiceData } from './invoice-form-data.ts';

const here = dirname(fileURLToPath(import.meta.url));

const formFields = {
  line_items: [{ description: 'Flashlamp', qty: 1, unit_price: 250, ext: 250 }],
  deposit: 0,
  manufacturer: 'Candela',
  model: 'GentleMax',
  serial: 'SN-100',
  custEmail: 'clinic@example.com',
};

test('form save merges over stored invoice_data and keeps Stripe session keys', () => {
  const merged = mergeFormInvoiceData(
    {
      line_items: [{ description: 'old' }],
      deposit: 10,
      payment_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
      stripe_checkout_session_id: 'cs_test_abc',
      stripe_checkout_session_ids: ['cs_test_abc'],
      payment_amount: 250,
      payment_kind: 'deposit',
    },
    formFields
  );
  assert.equal(merged.payment_url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  assert.equal(merged.stripe_checkout_session_id, 'cs_test_abc');
  assert.deepEqual(merged.stripe_checkout_session_ids, ['cs_test_abc']);
  assert.equal(merged.payment_amount, 250);
  assert.equal(merged.payment_kind, 'deposit');
  assert.deepEqual(merged.line_items, formFields.line_items);
  assert.equal(merged.deposit, 0);
  assert.equal(merged.manufacturer, 'Candela');
  assert.equal(merged.custEmail, 'clinic@example.com');
});

test('string invoice_data is parsed before the form overlay', () => {
  const merged = mergeFormInvoiceData(
    JSON.stringify({
      stripe_checkout_session_id: 'cs_live_1',
      payment_url: 'https://checkout.stripe.com/c/pay/cs_live_1',
      line_items: [],
    }),
    formFields
  );
  assert.equal(merged.stripe_checkout_session_id, 'cs_live_1');
  assert.equal(merged.payment_url, 'https://checkout.stripe.com/c/pay/cs_live_1');
  assert.deepEqual(merged.line_items, formFields.line_items);
});

test('re-save after send reads the stored session id instead of replacing invoice_data', async () => {
  const stored = {
    line_items: [{ description: 'draft' }],
    payment_url: 'https://checkout.stripe.com/c/pay/cs_test_resend',
    stripe_checkout_session_id: 'cs_test_resend',
    payment_amount: 180,
    payment_kind: 'deposit',
  };
  const client = {
    from(table: string) {
      assert.equal(table, 'service_invoices');
      return {
        select(cols: string) {
          assert.equal(cols, 'invoice_data');
          return {
            eq(column: string, id: string | number) {
              assert.equal(column, 'id');
              assert.equal(id, 41);
              return {
                maybeSingle: async () => ({ data: { invoice_data: stored }, error: null }),
              };
            },
          };
        },
      };
    },
  };

  const merged = await invoiceDataForSave(client, 41, formFields);
  assert.equal(merged.stripe_checkout_session_id, 'cs_test_resend');
  assert.equal(merged.payment_url, stored.payment_url);
  assert.equal(merged.payment_amount, 180);
  assert.deepEqual(merged.line_items, formFields.line_items);

  const created = await invoiceDataForSave(client, null, formFields);
  assert.equal(created.stripe_checkout_session_id, undefined);
  assert.deepEqual(created.line_items, formFields.line_items);
});

test('invoice form saves through invoiceDataForSave before the post-send status update', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  assert.match(src, /invoiceDataForSave/);
  assert.match(src, /savedIdRef/);
  assert.match(src, /await saveInvoice\('sent'/);
  const saveStart = src.indexOf('async function saveInvoice');
  const saveEnd = src.indexOf('function buildInvoiceEmailHtml');
  const saveFn = src.slice(saveStart, saveEnd);
  assert.match(saveFn, /invoiceDataForSave\(supabase,\s*existingId,/);
  assert.match(saveFn, /invoice_data:\s*await invoiceDataForSave/);
  assert.doesNotMatch(saveFn, /invoice_data:\s*\{\s*line_items/);
});
