import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVOICE_ROW_SELECTS,
  loadInvoiceRow,
  mergePaymentFieldsIntoInvoiceData,
  type StripeLinkFields,
} from './invoice-row-load.ts';

const here = dirname(fileURLToPath(import.meta.url));

const link: StripeLinkFields = {
  payment_url: 'https://checkout.stripe.com/c/pay/cs_test_new',
  stripe_checkout_session_id: 'cs_test_new',
  payment_amount: 250,
  payment_kind: 'deposit',
};

const lineItems = [
  { part_number: 'FL-1', description: 'Flashlamp', qty: 2, unit_price: 125, ext: 250 },
];

test('every invoice fallback select includes invoice_data', () => {
  assert.ok(INVOICE_ROW_SELECTS.length >= 2);
  for (const cols of INVOICE_ROW_SELECTS) {
    assert.match(cols, /\binvoice_data\b/, cols);
  }
  assert.equal(
    INVOICE_ROW_SELECTS.some((cols) => cols.trim() === 'id, created_by, organization_id, total'),
    false
  );
  const last = INVOICE_ROW_SELECTS[INVOICE_ROW_SELECTS.length - 1];
  assert.match(last, /\bcustomer_organization_id\b/);
  assert.match(last, /\bstatus\b/);
  assert.match(last, /\binvoice_data\b/);
});

test('column-missing selects fall through and still return invoice_data', async () => {
  const [full, core, min, last] = INVOICE_ROW_SELECTS;
  const stored = {
    id: 41,
    created_by: 'user-1',
    organization_id: 7,
    total: 400,
    invoice_data: { line_items: lineItems, custEmail: 'clinic@example.com' },
  };
  const selects: string[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'service_invoices');
      return {
        select(cols: string) {
          selects.push(cols);
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  if (cols === full) {
                    return {
                      data: null,
                      error: {
                        message:
                          "Could not find the 'invoice_number' column of 'service_invoices' in the schema cache",
                      },
                    };
                  }
                  if (cols === core || cols === min) {
                    return {
                      data: null,
                      error: {
                        message: "Could not find the 'amount_paid' column of 'service_invoices' in the schema cache",
                      },
                    };
                  }
                  if (cols === last) return { data: stored, error: null };
                  return { data: null, error: { message: `unexpected select ${cols}` } };
                },
              };
            },
          };
        },
      };
    },
  };

  const loaded = await loadInvoiceRow(client, 41);
  assert.deepEqual(selects, [...INVOICE_ROW_SELECTS]);
  assert.deepEqual(loaded.row.invoice_data.line_items, lineItems);
  assert.equal(loaded.errorMsg, null);
});

test('a non-schema error stops the fallback reads', async () => {
  let selects = 0;
  const client = {
    from() {
      return {
        select() {
          selects += 1;
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: { message: 'permission denied' } }),
              };
            },
          };
        },
      };
    },
  };
  const loaded = await loadInvoiceRow(client, 9);
  assert.equal(selects, 1);
  assert.equal(loaded.row, null);
  assert.equal(loaded.errorMsg, 'permission denied');
});

test('payment fields merge into existing invoice_data and keep line items', () => {
  const merged = mergePaymentFieldsIntoInvoiceData(
    {
      id: 41,
      invoice_data: {
        line_items: lineItems,
        custEmail: 'clinic@example.com',
        payment_url: 'https://checkout.stripe.com/c/pay/cs_old',
        stripe_checkout_session_id: 'cs_old',
      },
    },
    link
  );
  assert.ok(merged);
  assert.deepEqual(merged.line_items, lineItems);
  assert.equal(merged.custEmail, 'clinic@example.com');
  assert.equal(merged.payment_url, link.payment_url);
  assert.equal(merged.stripe_checkout_session_id, link.stripe_checkout_session_id);
  assert.equal(merged.payment_amount, 250);
  assert.equal(merged.payment_kind, 'deposit');
});

test('string invoice_data is parsed and merged, not replaced', () => {
  const merged = mergePaymentFieldsIntoInvoiceData(
    {
      invoice_data: JSON.stringify({
        line_items: lineItems,
        manufacturer: 'Candela',
        model: 'GentleMax',
      }),
    },
    link
  );
  assert.ok(merged);
  assert.deepEqual(merged.line_items, lineItems);
  assert.equal(merged.manufacturer, 'Candela');
  assert.equal(merged.model, 'GentleMax');
  assert.equal(merged.payment_url, link.payment_url);
});

test('null invoice_data can store a payment link because there is nothing to keep', () => {
  const merged = mergePaymentFieldsIntoInvoiceData({ invoice_data: null }, link);
  assert.deepEqual(merged, { ...link });
});

test('unreadable invoice_data is not written', () => {
  assert.equal(
    mergePaymentFieldsIntoInvoiceData({ invoice_data: '{not json' }, link),
    null
  );
  assert.equal(
    mergePaymentFieldsIntoInvoiceData({ invoice_data: '["line"]' }, link),
    null
  );
  assert.equal(mergePaymentFieldsIntoInvoiceData({ id: 1, total: 10 }, link), null);
  assert.equal(mergePaymentFieldsIntoInvoiceData(null, link), null);
});

test('send-invoice merges payment fields and does not select a row without invoice_data', () => {
  const src = readFileSync(join(here, '../../app/api/billing/send-invoice/route.ts'), 'utf8');
  assert.match(src, /mergePaymentFieldsIntoInvoiceData/);
  assert.match(src, /loadInvoiceRow/);
  assert.match(src, /if \(merged\)/);
  assert.doesNotMatch(src, /id, created_by, organization_id, total'/);
  assert.doesNotMatch(src, /invoice_data:\s*\{[^}]*payment_url/);
});

test('service_invoices payment migration is rerunnable and reloads the schema cache', () => {
  const migration = readFileSync(
    join(here, '../../supabase/migrations/20260927_000000_service_invoice_payment_columns.sql'),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS invoice_number text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS amount_paid numeric\(12,2\) DEFAULT 0/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS paid_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS payment_method text/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  assert.match(migration, /APPLY ON LIVE/);
});
