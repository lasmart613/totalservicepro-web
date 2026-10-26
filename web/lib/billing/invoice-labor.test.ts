import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoicePaymentPatch, paymentStatusFromAmounts } from './apply-invoice-payment.ts';
import { invoiceSavedCollectable, STRIPE_INVOICE_MAX } from './invoice-collectable.ts';
import { ORG_READABLE_COLUMNS } from '../org-columns.ts';
import {
  applyLaborRateFields,
  emptyLabor,
  invoiceMoney,
  isMissingLaborColumnError,
  laborColumnPayload,
  laborForInvoiceEdit,
  laborFromEstimate,
  laborFromInvoiceRow,
  laborFromQuantities,
  LABOR_INPUT_MAX,
  laborIsZero,
  laborLineAmounts,
  laborSubtotalOf,
  ORG_LABOR_RATE_COLUMNS,
  partsSubtotalFromLines,
  stripMovedEstimateLaborLines,
  withOrgRateDefaults,
} from './invoice-labor.ts';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../..');

test('labor line totals and invoice money include labor without changing the tax dollars', () => {
  const labor = laborFromQuantities({
    hours: 2,
    halfDays: 1,
    fullDays: 0.5,
    hourlyRate: 150,
    halfDayRate: 500,
    fullDayRate: 900,
  });
  assert.deepEqual(laborLineAmounts(labor), {
    hourly: 300,
    halfDay: 500,
    fullDay: 450,
    subtotal: 1250,
  });
  assert.equal(labor.subtotal, 1250);
  const money = invoiceMoney(100, labor, 8);
  assert.deepEqual(money, {
    partsSubtotal: 100,
    laborSubtotal: 1250,
    subtotal: 1350,
    tax: 8,
    total: 1358,
  });
});

test('zero labor leaves parts plus the entered tax unchanged', () => {
  const labor = laborFromQuantities({ hours: 0, halfDays: 0, fullDays: 0, hourlyRate: 150 });
  assert.equal(laborIsZero(labor), true);
  assert.deepEqual(invoiceMoney(100, labor, 8), {
    partsSubtotal: 100,
    laborSubtotal: 0,
    subtotal: 100,
    tax: 8,
    total: 108,
  });
  assert.deepEqual(invoiceMoney(100, emptyLabor(), 8).total, 108);
});

test('a null rate is kept and a negative quantity is treated as zero', () => {
  const labor = laborFromQuantities({
    hours: -3,
    halfDays: 1,
    hourlyRate: null,
    halfDayRate: '',
  });
  assert.equal(labor.hours, 0);
  assert.equal(labor.halfDays, 1);
  assert.equal(labor.hourlyRate, null);
  assert.equal(labor.halfDayRate, null);
  assert.equal(labor.subtotal, 0);
});

test('org rates fill only snapshots the invoice has not set', () => {
  const filled = withOrgRateDefaults(emptyLabor(), { hourly: 150, halfDay: 500, fullDay: 900 });
  assert.equal(filled.hourlyRate, 150);
  assert.equal(filled.halfDayRate, 500);
  assert.equal(filled.fullDayRate, 900);
  assert.equal(filled.subtotal, 0);
  const kept = withOrgRateDefaults(
    laborFromQuantities({ hours: 1, hourlyRate: 40, halfDayRate: 10 }),
    { hourly: 150, halfDay: 500, fullDay: 900 }
  );
  assert.equal(kept.hourlyRate, 40);
  assert.equal(kept.halfDayRate, 10);
  assert.equal(kept.fullDayRate, 900);
  assert.equal(kept.subtotal, 40);
});

test('estimate conversion carries hourly labor only', () => {
  const carried = laborFromEstimate(
    {
      laborHours: 2,
      labor: 370,
      pricing: { laborRate: 185 },
      line_items: [
        { id: 'labor', description: 'Labor', qty: 1, unit_price: 370, ext: 370 },
        { id: 'p1', description: 'Tip', qty: 1, unit_price: 10, ext: 10 },
      ],
    },
    { hourly: 999, halfDay: 500, fullDay: 900 }
  );
  assert.ok(carried);
  assert.equal(carried.hours, 2);
  assert.equal(carried.halfDays, 0);
  assert.equal(carried.fullDays, 0);
  assert.equal(carried.hourlyRate, 185);
  assert.equal(carried.halfDayRate, 500);
  assert.equal(carried.fullDayRate, 900);
  assert.equal(carried.subtotal, 370);
  const lines = stripMovedEstimateLaborLines(
    [
      { id: 'labor', description: 'Labor' },
      { id: 'p1', description: 'Tip' },
    ],
    carried
  );
  assert.deepEqual(
    lines.map((line) => line.id),
    ['p1']
  );
});

test('an estimate with no labor does not invent a labor section', () => {
  assert.equal(laborFromEstimate({ partsTotal: 40, line_items: [] }), null);
  assert.equal(laborFromEstimate({ laborHours: 0, labor: 0 }), null);
  const lines = stripMovedEstimateLaborLines([{ id: 'labor', description: 'Labor' }], null);
  assert.equal(lines.length, 1);
});

test('a legacy estimate labor amount of zero carries zero hours', () => {
  const carried = laborFromEstimate(
    { laborHours: 4, labor: 0, pricing: { laborRate: 185 } },
    { hourly: 999, halfDay: 500, fullDay: 900 }
  );
  assert.ok(carried);
  assert.equal(carried.hours, 0);
  assert.equal(carried.subtotal, 0);
  assert.equal(carried.hourlyRate, 185);
  const lines = stripMovedEstimateLaborLines(
    [
      { id: 'labor', description: 'Labor' },
      { id: 'p1', description: 'Tip' },
    ],
    carried
  );
  assert.deepEqual(
    lines.map((line) => line.id),
    ['p1']
  );
});

test('a stored labor dollar amount snaps the hourly rate when hours times rate disagree', () => {
  const carried = laborFromEstimate({ laborHours: 2, labor: 100, pricing: { laborRate: 40 } });
  assert.ok(carried);
  assert.equal(carried.hourlyRate, 50);
  assert.equal(carried.subtotal, 100);
  assert.equal(carried.halfDays, 0);
  assert.equal(carried.fullDays, 0);
});

test('a manual total of $108 is the amount due even when labor is $100', () => {
  const row = {
    total: 108,
    amount_paid: 0,
    labor_subtotal: 100,
    subtotal: 100,
    tax: 8,
    invoice_data: {},
  };
  const open = invoiceSavedCollectable(row);
  assert.ok(open);
  assert.equal(open.total, 108);
  assert.equal(open.stripeAmount, 108);
  assert.equal(open.remainingOwed, 108);
  assert.equal(paymentStatusFromAmounts(open.total, 0), 'sent');
  const partial = invoiceSavedCollectable({ ...row, amount_paid: 40 });
  assert.ok(partial);
  assert.equal(partial.stripeAmount, 68);
  assert.equal(partial.remainingOwed, 68);
  assert.equal(paymentStatusFromAmounts(partial.total, 40), 'partially_paid');
  const recorded = buildInvoicePaymentPatch({
    invoice: { id: 1, total: 108, amount_paid: 40, invoice_data: {} },
    addAmount: 20,
    method: 'Check',
  });
  assert.equal(recorded.status, 'partially_paid');
  assert.equal(recorded.amount_paid, 60);
  assert.equal(recorded.invoice_data.balanceDue, 48);
  const settled = buildInvoicePaymentPatch({
    invoice: { id: 1, total: 108, amount_paid: 40, invoice_data: {} },
    addAmount: 68,
    method: 'Stripe',
  });
  assert.equal(settled.status, 'paid');
  assert.equal(settled.amount_paid, 108);
  assert.equal(settled.invoice_data.balanceDue, 0);
});

test('labor quantities, rates, and the subtotal cannot grow without a cap', () => {
  const huge = laborFromQuantities({
    hours: 1e15,
    halfDays: 1e15,
    fullDays: 1e15,
    hourlyRate: 1e15,
    halfDayRate: 1e15,
    fullDayRate: 1e15,
  });
  assert.equal(huge.hours, LABOR_INPUT_MAX);
  assert.equal(huge.halfDays, LABOR_INPUT_MAX);
  assert.equal(huge.fullDays, LABOR_INPUT_MAX);
  assert.equal(huge.hourlyRate, LABOR_INPUT_MAX);
  assert.equal(huge.halfDayRate, LABOR_INPUT_MAX);
  assert.equal(huge.fullDayRate, LABOR_INPUT_MAX);
  assert.equal(huge.subtotal, STRIPE_INVOICE_MAX);
  assert.equal(laborSubtotalOf({ labor_subtotal: 1e15, labor_hours: 1, labor_hourly_rate: 1 }), STRIPE_INVOICE_MAX);
});

test('reopening a saved labor invoice leaves its totals unchanged', () => {
  const org = { hourly: 150, halfDay: 500, fullDay: 900 };
  const saved = {
    labor_hours: 2,
    labor_half_days: 0,
    labor_full_days: 1,
    labor_hourly_rate: null,
    labor_half_day_rate: null,
    labor_full_day_rate: 400,
    labor_subtotal: 100,
    tax: 8,
  };
  const opened = laborForInvoiceEdit(saved, org);
  assert.equal(opened.hours, 2);
  assert.equal(opened.fullDays, 1);
  assert.equal(opened.hourlyRate, null);
  assert.equal(opened.halfDayRate, null);
  assert.equal(opened.fullDayRate, 400);
  assert.equal(opened.subtotal, 100);
  assert.equal(invoiceMoney(0, opened, 8).total, 108);
  const filled = withOrgRateDefaults(laborFromInvoiceRow(saved), org);
  assert.notEqual(filled.subtotal, opened.subtotal);

  const hoursOnly = laborForInvoiceEdit(
    { labor_hours: 4, labor_hourly_rate: null, labor_subtotal: 0 },
    org
  );
  assert.equal(hoursOnly.hourlyRate, null);
  assert.equal(hoursOnly.subtotal, 0);
  assert.equal(invoiceMoney(100, hoursOnly, 8).total, 108);

  const blank = laborForInvoiceEdit(
    { labor_hours: 0, labor_half_days: 0, labor_full_days: 0, labor_hourly_rate: null, labor_subtotal: 0 },
    org
  );
  assert.equal(blank.hourlyRate, 150);
  assert.equal(blank.halfDayRate, 500);
  assert.equal(blank.fullDayRate, 900);
  assert.equal(blank.subtotal, 0);
  assert.equal(invoiceMoney(100, blank, 8).total, 108);
});

test('a null total is not a zero charge', () => {
  assert.equal(invoiceSavedCollectable({ total: null, amount_paid: 0, invoice_data: {} }), null);
  assert.equal(invoiceSavedCollectable({ total: '', invoice_data: {} }), null);
  assert.equal(invoiceSavedCollectable({ total: '   ', invoice_data: {} }), null);
  assert.equal(invoiceSavedCollectable({ total: 'NaN', invoice_data: {} }), null);
  assert.equal(invoiceSavedCollectable({ total: 0, invoice_data: {} })?.stripeAmount, 0);
  assert.throws(
    () =>
      buildInvoicePaymentPatch({
        invoice: { id: 1, total: null, invoice_data: {} },
        addAmount: 10,
        method: 'Cash',
      }),
    /no total/
  );
});

test('a saved row round-trips and a missing labor column is detected', () => {
  const labor = laborFromInvoiceRow({
    labor_hours: '1.5',
    labor_half_days: 0,
    labor_full_days: 1,
    labor_hourly_rate: 80,
    labor_half_day_rate: null,
    labor_full_day_rate: 600,
    labor_subtotal: 720,
  });
  assert.equal(labor.hours, 1.5);
  assert.equal(labor.subtotal, 720);
  const storedWins = laborFromInvoiceRow({
    labor_hours: 2,
    labor_hourly_rate: 25,
    labor_subtotal: 40,
  });
  assert.equal(storedWins.subtotal, 40);
  assert.equal(laborFromInvoiceRow({ labor_hours: 4, labor_hourly_rate: 100, labor_subtotal: 0 }).subtotal, 0);
  assert.equal(laborSubtotalOf({ labor_subtotal: 0, labor_hours: 4, labor_hourly_rate: 100 }), 0);
  assert.equal(partsSubtotalFromLines([{ qty: 2, unit_price: 10 }]), 20);
  assert.equal(partsSubtotalFromLines([{ qty: 2, unit_price: 10, ext: 0 }]), 0);
  assert.equal(partsSubtotalFromLines([{ qty: 3, unit_price: 5, ext: 'NaN' }]), 15);
  assert.deepEqual(laborColumnPayload(labor).labor_subtotal, 720);
  assert.equal(
    isMissingLaborColumnError({
      code: 'PGRST204',
      message: "Could not find the 'labor_hours' column of 'service_invoices' in the schema cache",
    }),
    true
  );
  assert.equal(
    isMissingLaborColumnError({ code: '42703', message: 'column labor_subtotal does not exist' }),
    true
  );
  assert.equal(
    isMissingLaborColumnError({
      code: 'PGRST204',
      message: "Could not find the 'invoice_number' column of 'service_invoices' in the schema cache",
    }),
    false
  );
  assert.equal(isMissingLaborColumnError({ message: 'permission denied' }), false);
});

test('org labor rates reject negatives and stay off the shared readable select', () => {
  const payload: Record<string, unknown> = { labor_hourly_rate: '150.5', labor_half_day_rate: '', name: 'Shop' };
  assert.deepEqual(applyLaborRateFields(payload), { ok: true });
  assert.equal(payload.labor_hourly_rate, 150.5);
  assert.equal(payload.labor_half_day_rate, null);
  assert.equal(applyLaborRateFields({ labor_full_day_rate: -1 }).ok, false);
  const readable = ORG_READABLE_COLUMNS.split(',').map((col) => col.trim());
  for (const col of ORG_LABOR_RATE_COLUMNS) {
    assert.equal(readable.includes(col), false, col);
  }
});

test('migration 000948 adds only the new labor columns and records its version', () => {
  const sql = readFileSync(join(web, 'supabase/migrations/20261025_000948_invoice_labor.sql'), 'utf8');
  const rollback = readFileSync(
    join(web, 'supabase/migrations/20261025_000948_invoice_labor_rollback.sql'),
    'utf8'
  );
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /20261025_000948/);
  assert.match(sql, /invoice_labor/);
  assert.match(sql, /numeric\(10,2\)/);
  assert.match(sql, /labor_subtotal numeric\(12,2\) NOT NULL DEFAULT 0/);
  assert.match(sql, /labor_hours >= 0 AND labor_hours <> 'NaN'/);
  assert.match(sql, /labor_hourly_rate IS NULL OR \(labor_hourly_rate >= 0 AND labor_hourly_rate <> 'NaN'\)/);
  assert.match(sql, /labor_subtotal >= 0 AND labor_subtotal <> 'NaN'/);
  assert.match(sql, /GRANT SELECT \(labor_hourly_rate, labor_half_day_rate, labor_full_day_rate\)/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY/);
  assert.doesNotMatch(sql, /service_estimates/);
  assert.doesNotMatch(sql, /\b1005\b/);
  assert.match(rollback, /DROP COLUMN IF EXISTS labor_subtotal/);
  assert.match(rollback, /DELETE FROM supabase_migrations\.schema_migrations WHERE version = '20261025_000948'/);
  assert.doesNotMatch(rollback, /DROP COLUMN IF EXISTS (subtotal|tax|total|amount_paid)/);
  assert.doesNotMatch(sql + rollback, /\b1005\b/);
});

test('the app hides labor until the columns exist and every charge uses the saved total', () => {
  const company = readFileSync(join(web, 'app/company/page.tsx'), 'utf8');
  const profile = readFileSync(join(web, 'app/api/org/profile/route.ts'), 'utf8');
  const form = readFileSync(join(web, 'app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const send = readFileSync(join(web, 'app/api/billing/send-invoice/route.ts'), 'utf8');
  const page = readFileSync(join(web, 'app/invoices/page.tsx'), 'utf8');
  const mail = readFileSync(join(web, 'lib/billing/owned-doc-mail.ts'), 'utf8');
  const proof = readFileSync(join(web, 'supabase/tests/20261025_invoice_labor.sql'), 'utf8');
  assert.match(company, /select\(ORG_LABOR_RATE_SELECT\)/);
  assert.match(company, /isMissingLaborColumnError/);
  assert.match(company, /setLaborRatesReady\(false\)/);
  assert.match(company, /showLaborRates/);
  assert.match(profile, /'labor_hourly_rate'/);
  assert.match(profile, /applyLaborRateFields/);
  assert.match(form, /select\('labor_hours'\)/);
  assert.match(form, /laborColumnPayload\(labor\)/);
  assert.match(form, /laborFromEstimate/);
  assert.match(form, /stripMovedEstimateLaborLines/);
  assert.match(form, /laborForInvoiceEdit\(data, orgRates\)/);
  assert.doesNotMatch(form, /withOrgRateDefaults\(laborFromInvoiceRow/);
  assert.match(form, /setTotalOverride\(null\);\s*setTax/);
  assert.match(form, /LABOR_INPUT_MAX/);
  assert.match(form, /STRIPE_INVOICE_MAX/);
  assert.doesNotMatch(form, /labor_half_days:\s*ed\.|labor_full_days:\s*ed\./);
  for (const src of [send, page, mail]) {
    assert.match(src, /invoiceSavedCollectable/);
    assert.doesNotMatch(src, /chargeTotalIncludingLabor/);
  }
  assert.match(send, /This invoice has no total, so it was not sent/);
  assert.match(send, /if \(!collectable\)/);
  const payments = readFileSync(join(web, 'lib/billing/apply-invoice-payment.ts'), 'utf8');
  assert.match(payments, /STRIPE_INVOICE_MAX/);
  assert.match(page, /buildInvoicePaymentPatch/);
  assert.match(proof, /\\ir \.\.\/migrations\/20261025_000948_invoice_labor\.sql/);
  assert.doesNotMatch(proof, /\\i web\//);
});
