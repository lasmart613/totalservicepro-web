/**
 * Invoice labor, separate from parts line items.
 *
 * Organizations store three nullable rates (hourly, half-day, full-day).
 * Each invoice snapshots those rates and stores quantities plus labor_subtotal.
 * No earlier organizations or service_invoices column holds these rates:
 * labor_log.hourly_rate prices job-costing time entries, and
 * estimate_data.pricing.laborRate is one hourly rate on a quote. Neither is
 * reused.
 *
 * Tax: service_invoices.tax is a dollar amount the user enters. Parts are not
 * taxed by a rate, and labor is not either. An estimate taxes a subtotal that
 * already includes its hourly labor; converting copies that tax amount, so the
 * tax result stays the same. There is no organization "labor is taxable" flag.
 * Adding one would change invoices that exist today.
 *
 * Estimates have hourly labor only (laborHours × pricing.laborRate). They do
 * not have half-day or full-day quantities, so conversion copies hours and the
 * hourly rate and leaves the other quantities at 0.
 *
 * Before migration 000948 the labor columns are absent. Callers detect that
 * and hide the labor UI. Existing invoices then total exactly as they do now.
 */

import { parseJsonField } from './save-helpers.ts';

export const ORG_LABOR_RATE_COLUMNS = [
  'labor_hourly_rate',
  'labor_half_day_rate',
  'labor_full_day_rate',
] as const;

export const INVOICE_LABOR_COLUMNS = [
  'labor_hours',
  'labor_half_days',
  'labor_full_days',
  'labor_hourly_rate',
  'labor_half_day_rate',
  'labor_full_day_rate',
  'labor_subtotal',
] as const;

export const ORG_LABOR_RATE_SELECT = ORG_LABOR_RATE_COLUMNS.join(', ');

const LABOR_COLUMN_NAME =
  /labor_(hours|half_days|full_days|hourly_rate|half_day_rate|full_day_rate|subtotal)/i;

export type OrgLaborRates = {
  hourly: number | null;
  halfDay: number | null;
  fullDay: number | null;
};

export type InvoiceLabor = {
  hours: number;
  halfDays: number;
  fullDays: number;
  hourlyRate: number | null;
  halfDayRate: number | null;
  fullDayRate: number | null;
  subtotal: number;
};

export type LaborLineAmounts = {
  hourly: number;
  halfDay: number;
  fullDay: number;
  subtotal: number;
};

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function emptyLabor(): InvoiceLabor {
  return {
    hours: 0,
    halfDays: 0,
    fullDays: 0,
    hourlyRate: null,
    halfDayRate: null,
    fullDayRate: null,
    subtotal: 0,
  };
}

export function emptyOrgLaborRates(): OrgLaborRates {
  return { hourly: null, halfDay: null, fullDay: null };
}

function qty(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundMoney(n);
}

function rateOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

export function laborFromQuantities(input: {
  hours?: unknown;
  halfDays?: unknown;
  fullDays?: unknown;
  hourlyRate?: unknown;
  halfDayRate?: unknown;
  fullDayRate?: unknown;
}): InvoiceLabor {
  const hours = qty(input.hours);
  const halfDays = qty(input.halfDays);
  const fullDays = qty(input.fullDays);
  const hourlyRate = rateOrNull(input.hourlyRate);
  const halfDayRate = rateOrNull(input.halfDayRate);
  const fullDayRate = rateOrNull(input.fullDayRate);
  const amounts = lineAmounts(hours, halfDays, fullDays, hourlyRate, halfDayRate, fullDayRate);
  return {
    hours,
    halfDays,
    fullDays,
    hourlyRate,
    halfDayRate,
    fullDayRate,
    subtotal: amounts.subtotal,
  };
}

function lineAmounts(
  hours: number,
  halfDays: number,
  fullDays: number,
  hourlyRate: number | null,
  halfDayRate: number | null,
  fullDayRate: number | null
): LaborLineAmounts {
  const hourly = roundMoney(hours * (hourlyRate ?? 0));
  const halfDay = roundMoney(halfDays * (halfDayRate ?? 0));
  const fullDay = roundMoney(fullDays * (fullDayRate ?? 0));
  return {
    hourly,
    halfDay,
    fullDay,
    subtotal: roundMoney(hourly + halfDay + fullDay),
  };
}

export function laborLineAmounts(labor: InvoiceLabor): LaborLineAmounts {
  return lineAmounts(
    labor.hours,
    labor.halfDays,
    labor.fullDays,
    labor.hourlyRate,
    labor.halfDayRate,
    labor.fullDayRate
  );
}

/** Customer-facing labor block is omitted when the labor subtotal is zero. */
export function laborIsZero(labor: InvoiceLabor | null | undefined): boolean {
  return !labor || !(labor.subtotal > 0.004);
}

export function laborFromInvoiceRow(row: Record<string, unknown> | null | undefined): InvoiceLabor {
  if (!row) return emptyLabor();
  return laborFromQuantities({
    hours: row.labor_hours,
    halfDays: row.labor_half_days,
    fullDays: row.labor_full_days,
    hourlyRate: row.labor_hourly_rate,
    halfDayRate: row.labor_half_day_rate,
    fullDayRate: row.labor_full_day_rate,
  });
}

export function laborColumnPayload(labor: InvoiceLabor): Record<string, number | null> {
  return {
    labor_hours: labor.hours,
    labor_half_days: labor.halfDays,
    labor_full_days: labor.fullDays,
    labor_hourly_rate: labor.hourlyRate,
    labor_half_day_rate: labor.halfDayRate,
    labor_full_day_rate: labor.fullDayRate,
    labor_subtotal: labor.subtotal,
  };
}

export function orgLaborRatesFromRow(row: Record<string, unknown> | null | undefined): OrgLaborRates {
  if (!row) return emptyOrgLaborRates();
  return {
    hourly: rateOrNull(row.labor_hourly_rate),
    halfDay: rateOrNull(row.labor_half_day_rate),
    fullDay: rateOrNull(row.labor_full_day_rate),
  };
}

/**
 * Fill only rates the invoice has not already snapshotted.
 * Quantities are left alone, so a zero-quantity invoice stays at $0.
 */
export function withOrgRateDefaults(
  labor: InvoiceLabor,
  rates: OrgLaborRates | null | undefined,
  opts?: { fillHourly?: boolean }
): InvoiceLabor {
  const org = rates || emptyOrgLaborRates();
  const fillHourly = opts?.fillHourly !== false;
  return laborFromQuantities({
    hours: labor.hours,
    halfDays: labor.halfDays,
    fullDays: labor.fullDays,
    hourlyRate: labor.hourlyRate != null ? labor.hourlyRate : fillHourly ? org.hourly : null,
    halfDayRate: labor.halfDayRate != null ? labor.halfDayRate : org.halfDay,
    fullDayRate: labor.fullDayRate != null ? labor.fullDayRate : org.fullDay,
  });
}

export function invoiceMoney(partsSubtotal: number, labor: InvoiceLabor, tax: number): {
  partsSubtotal: number;
  laborSubtotal: number;
  subtotal: number;
  tax: number;
  total: number;
} {
  const parts = roundMoney(Math.max(0, Number(partsSubtotal) || 0));
  const laborSubtotal = roundMoney(Math.max(0, labor.subtotal || 0));
  const subtotal = roundMoney(parts + laborSubtotal);
  const taxN = roundMoney(Math.max(0, Number(tax) || 0));
  return {
    partsSubtotal: parts,
    laborSubtotal,
    subtotal,
    tax: taxN,
    total: roundMoney(subtotal + taxN),
  };
}

/**
 * Estimates store hourly labor only. Returns null when the quote has no labor
 * dollars and no hours, so conversion does not invent a labor section.
 * Half-day and full-day quantities stay 0. Optional org rates prefill those
 * rate snapshots without changing the amount.
 */
export function laborFromEstimate(
  estimateData: unknown,
  orgRates?: OrgLaborRates | null
): InvoiceLabor | null {
  const ed = parseJsonField(estimateData);
  const pricing =
    ed.pricing && typeof ed.pricing === 'object' ? (ed.pricing as Record<string, unknown>) : {};
  const hoursRaw = qty(ed.laborHours);
  const amount = roundMoney(Math.max(0, Number(ed.labor) || 0));
  if (hoursRaw <= 0 && amount <= 0) return null;

  let hourly = rateOrNull(pricing.laborRate);
  let hours = hoursRaw;
  if (hours <= 0 && amount > 0) {
    const derived = hourly && hourly > 0 ? qty(amount / hourly) : 1;
    hours = derived > 0 ? derived : 1;
  }
  if ((hourly == null || hourly <= 0) && hours > 0 && amount > 0) {
    hourly = roundMoney(amount / hours);
  }

  const rates = orgRates || emptyOrgLaborRates();
  let labor = laborFromQuantities({
    hours,
    halfDays: 0,
    fullDays: 0,
    hourlyRate: hourly,
    halfDayRate: rates.halfDay,
    fullDayRate: rates.fullDay,
  });
  if (amount > 0 && hours > 0 && Math.abs(labor.subtotal - amount) > 0.02) {
    labor = laborFromQuantities({
      hours,
      halfDays: 0,
      fullDays: 0,
      hourlyRate: roundMoney(amount / hours),
      halfDayRate: rates.halfDay,
      fullDayRate: rates.fullDay,
    });
  }
  return labor;
}

/** Drop the synthetic estimate labor line once that amount lives in the labor section. */
export function stripMovedEstimateLaborLines<T extends { id?: unknown }>(
  lines: T[],
  carried: InvoiceLabor | null
): T[] {
  if (!carried || laborIsZero(carried)) return lines;
  return lines.filter((line) => String(line.id || '') !== 'labor');
}

export function partsSubtotalFromLines(lines: unknown): number {
  if (!Array.isArray(lines)) return 0;
  const sum = lines.reduce((total, line) => {
    if (!line || typeof line !== 'object') return total;
    const row = line as { ext?: unknown; qty?: unknown; unit_price?: unknown };
    const ext = Number(row.ext);
    if (Number.isFinite(ext)) return total + ext;
    const qtyN = Number(row.qty);
    const price = Number(row.unit_price);
    return total + (Number.isFinite(qtyN) ? qtyN : 0) * (Number.isFinite(price) ? price : 0);
  }, 0);
  return roundMoney(sum);
}

export function laborSubtotalOf(
  row: {
    labor_subtotal?: unknown;
    labor_hours?: unknown;
    labor_half_days?: unknown;
    labor_full_days?: unknown;
    labor_hourly_rate?: unknown;
    labor_half_day_rate?: unknown;
    labor_full_day_rate?: unknown;
  } | null
  | undefined
): number {
  if (!row) return 0;
  if (row.labor_subtotal != null && row.labor_subtotal !== '') {
    const stored = Number(row.labor_subtotal);
    if (Number.isFinite(stored)) return roundMoney(Math.max(0, stored));
  }
  return laborFromInvoiceRow(row).subtotal;
}

/**
 * Stripe charges the stored invoice total, which already includes labor when
 * the editor saved it. If that total equals parts + tax and labor_subtotal is
 * positive, labor was left out and is added. A different stored total is a
 * manual override and is kept. Zero labor leaves the stored total unchanged.
 */
export function chargeTotalIncludingLabor(input: {
  storedTotal?: unknown;
  partsSubtotal?: unknown;
  laborSubtotal?: unknown;
  tax?: unknown;
}): number {
  const storedRaw = Number(input.storedTotal);
  const stored = Number.isFinite(storedRaw) ? roundMoney(storedRaw) : null;
  const parts = roundMoney(Math.max(0, Number(input.partsSubtotal) || 0));
  const labor = roundMoney(Math.max(0, Number(input.laborSubtotal) || 0));
  const tax = roundMoney(Math.max(0, Number(input.tax) || 0));
  const computed = roundMoney(parts + labor + tax);
  if (stored == null) return computed;
  const withoutLabor = roundMoney(parts + tax);
  if (labor > 0.004 && Math.abs(stored - withoutLabor) <= 0.02 && computed > stored + 0.02) {
    return computed;
  }
  return stored;
}

const RATE_MAX = 99_999_999.99;

export function parseLaborRateInput(
  value: unknown
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, value: null };
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return { ok: false, error: 'Labor rate must be a number.' };
  if (n < 0) return { ok: false, error: 'Labor rate cannot be negative.' };
  if (n > RATE_MAX) return { ok: false, error: 'Labor rate is too large.' };
  return { ok: true, value: roundMoney(n) };
}

export function applyLaborRateFields(
  payload: Record<string, unknown>
): { ok: true } | { ok: false; error: string } {
  for (const key of ORG_LABOR_RATE_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    const parsed = parseLaborRateInput(payload[key]);
    if (!parsed.ok) return parsed;
    payload[key] = parsed.value;
  }
  return { ok: true };
}

/** True only when PostgREST or Postgres says a labor column is not there yet. */
export function isMissingLaborColumnError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  const message = String(error.message || '');
  const code = String(error.code || '');
  const missing =
    code === '42703' ||
    code === 'PGRST204' ||
    /schema cache|does not exist|could not find the/i.test(message);
  if (!missing) return false;
  return LABOR_COLUMN_NAME.test(message);
}
