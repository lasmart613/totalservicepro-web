import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paymentStatusFromAmounts } from './apply-invoice-payment.ts';
import { resolveInvoiceCollectable } from './invoice-collectable.ts';
import { ORG_READABLE_COLUMNS } from '../org-columns.ts';
import {
  applyLaborRateFields,
  chargeTotalIncludingLabor,
  emptyLabor,
  invoiceMoney,
  isMissingLaborColumnError,
  laborColumnPayload,
  laborFromEstimate,
  laborFromInvoiceRow,
  laborFromQuantities,
  laborIsZero,
  laborLineAmounts,
  laborSubtotalOf,
  ORG_LABOR_RATE_COLUMNS,
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

test('a stored labor dollar amount snaps the hourly rate when hours times rate disagree', () => {
  const carried = laborFromEstimate({ laborHours: 2, labor: 100, pricing: { laborRate: 40 } });
  assert.ok(carried);
  assert.equal(carried.hourlyRate, 50);
  assert.equal(carried.subtotal, 100);
  assert.equal(carried.halfDays, 0);
  assert.equal(carried.fullDays, 0);
});

test('charge total adds labor only when the stored total left it out', () => {
  assert.equal(
    chargeTotalIncludingLabor({ storedTotal: 108, partsSubtotal: 100, laborSubtotal: 50, tax: 8 }),
    158
  );
  assert.equal(
    chargeTotalIncludingLabor({ storedTotal: 158, partsSubtotal: 100, laborSubtotal: 50, tax: 8 }),
    158
  );
  assert.equal(
    chargeTotalIncludingLabor({ storedTotal: 200, partsSubtotal: 100, laborSubtotal: 50, tax: 8 }),
    200
  );
  assert.equal(
    chargeTotalIncludingLabor({ storedTotal: 108, partsSubtotal: 100, laborSubtotal: 0, tax: 8 }),
    108
  );
  assert.equal(
    chargeTotalIncludingLabor({ storedTotal: 108, partsSubtotal: 0, laborSubtotal: 50, tax: 8 }),
    108
  );
});

test('partial and paid follow the total that includes labor', () => {
  const total = chargeTotalIncludingLabor({
    storedTotal: 108,
    partsSubtotal: 100,
    laborSubtotal: 50,
    tax: 8,
  });
  assert.equal(total, 158);
  const open = resolveInvoiceCollectable({ total, amountPaid: 0, invoice_data: {} });
  assert.equal(open.stripeAmount, 158);
  assert.equal(open.remainingOwed, 158);
  assert.equal(paymentStatusFromAmounts(total, 0), 'sent');
  const partial = resolveInvoiceCollectable({ total, amountPaid: 50, invoice_data: {} });
  assert.equal(partial.stripeAmount, 108);
  assert.equal(partial.remainingOwed, 108);
  assert.equal(paymentStatusFromAmounts(total, 50), 'partially_paid');
  assert.equal(paymentStatusFromAmounts(total, 158), 'paid');
  const deposit = resolveInvoiceCollectable({
    total,
    amountPaid: 0,
    invoice_data: { dueNow: 40, deferred: 118, partsDeposit: 40 },
  });
  assert.equal(deposit.stripeAmount, 40);
  assert.equal(deposit.remainingOwed, 158);
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
  assert.equal(laborSubtotalOf({ labor_subtotal: 0, labor_hours: 4, labor_hourly_rate: 100 }), 0);
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
  assert.match(sql, /GRANT SELECT \(labor_hourly_rate, labor_half_day_rate, labor_full_day_rate\)/);
  assert.doesNotMatch(sql, /CREATE POLICY|DROP POLICY/);
  assert.doesNotMatch(sql, /service_estimates/);
  assert.doesNotMatch(sql, /\b1005\b/);
  assert.match(rollback, /DROP COLUMN IF EXISTS labor_subtotal/);
  assert.match(rollback, /DELETE FROM supabase_migrations\.schema_migrations WHERE version = '20261025_000948'/);
  assert.doesNotMatch(rollback, /DROP COLUMN IF EXISTS (subtotal|tax|total|amount_paid)/);
  assert.doesNotMatch(sql + rollback, /\b1005\b/);
});

test('the app hides labor until the columns exist and checkout uses the labor total', () => {
  const company = readFileSync(join(web, 'app/company/page.tsx'), 'utf8');
  const profile = readFileSync(join(web, 'app/api/org/profile/route.ts'), 'utf8');
  const form = readFileSync(join(web, 'app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const send = readFileSync(join(web, 'app/api/billing/send-invoice/route.ts'), 'utf8');
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
  assert.match(send, /chargeTotalIncludingLabor/);
  assert.doesNotMatch(form, /labor_half_days:\s*ed\.|labor_full_days:\s*ed\./);
});
