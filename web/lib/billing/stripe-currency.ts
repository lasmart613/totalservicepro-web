/**
 * Stripe Checkout amounts are minor units of the invoice organization's currency.
 * USD is only used when that organization has no currency_code. An unknown code
 * is refused. There is no silent substitution of usd.
 *
 * Stripe presentment rules (docs.stripe.com/currencies):
 * - Most currencies are two-decimal (10.99 USD → 1099).
 * - Zero-decimal currencies use the major unit (500 JPY → 500).
 * - ISK and UGX are zero-decimal but Stripe still expects a two-decimal amount
 *   whose decimals are 00 (5 ISK → 500).
 * - BHD, JOD, KWD, OMR, and TND are three-decimal, and the last digit must be 0
 *   (1.230 KWD → 1230).
 */

import { parseCurrencyCode } from '../money-format.ts';

const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/** Zero-decimal ISO currencies that Stripe still stores with a factor of 100. */
const ZERO_DECIMAL_FACTOR_100 = new Set(['isk', 'ugx']);

const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

const COLUMN_MISSING = /column|schema cache|does not exist|PGRST204/i;

type ChargeCurrencyQuery = {
  select(columns: string): {
    eq(column: string, value: unknown): {
      maybeSingle(): PromiseLike<{
        data: { currency_code?: unknown } | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

type CurrencyClient = {
  from(table: string): unknown;
};

export type ChargeCurrency =
  | { ok: true; currency: string }
  | { ok: false; reason: 'missing_org' | 'unsupported_currency' | 'currency_unavailable' };

/** Lowercase ISO code, or null when the value is missing or not on the org allowlist. */
export function checkoutCurrencyCode(value: unknown): string | null {
  if (value == null || String(value).trim() === '') return null;
  const code = parseCurrencyCode(value);
  if (!code) return null;
  return code.toLowerCase();
}

export function stripeMinorExponent(currency: string): 0 | 2 | 3 {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Major units the claim function stores. Zero-decimal and ISK/UGX are whole
 * units. BHD, JOD, KWD, OMR, and TND keep 3 decimals. Everything else keeps 2.
 */
export function currencyMajorScale(currency: string): 0 | 2 | 3 {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code) || ZERO_DECIMAL_FACTOR_100.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

function scaledInteger(major: number, factor: number): number | null {
  if (!Number.isFinite(major)) return null;
  const scaled = major * factor;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) return null;
  return rounded;
}

/**
 * Stripe minor units for an amount that is already exact at the currency's
 * precision. Returns null instead of rounding: a fractional yen, a fractional
 * ISK/UGX, a sub-cent USD amount, or a KWD amount Stripe cannot charge
 * (the last thousandth must be 0) does not get a pay link.
 */
export function toStripeMinorUnits(major: number, currency: string): number | null {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL_FACTOR_100.has(code)) {
    const whole = scaledInteger(major, 1);
    if (whole == null) return null;
    return whole * 100;
  }
  if (ZERO_DECIMAL.has(code)) return scaledInteger(major, 1);
  if (THREE_DECIMAL.has(code)) {
    const thousandths = scaledInteger(major, 1000);
    if (thousandths == null || thousandths % 10 !== 0) return null;
    // total, amount_paid, and service_invoice_stripe_payments.amount are numeric(12,2).
    const cents = scaledInteger(major, 100);
    if (cents == null || thousandths !== cents * 10) return null;
    return thousandths;
  }
  return scaledInteger(major, 100);
}

export const exactStripeMinorUnits = toStripeMinorUnits;

/**
 * Stripe's published minimum charge by presentment currency, in major units.
 * https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 * Currencies absent from that table use 0.50 (two-decimal), 50 (zero-decimal),
 * or 0.500 (three-decimal).
 */
const STRIPE_MINIMUM_MAJOR: Record<string, number> = {
  aed: 2,
  ars: 0.5,
  aud: 0.5,
  brl: 0.5,
  cad: 0.5,
  chf: 0.5,
  cop: 0.5,
  czk: 15,
  dkk: 2.5,
  eur: 0.5,
  gbp: 0.3,
  hkd: 4,
  huf: 175,
  idr: 0.5,
  ils: 0.5,
  inr: 0.5,
  jpy: 50,
  krw: 50,
  mxn: 10,
  myr: 2,
  nok: 3,
  nzd: 0.5,
  php: 0.5,
  pln: 2,
  ron: 2,
  rub: 0.5,
  sek: 3,
  sgd: 0.5,
  thb: 10,
  usd: 0.5,
  zar: 0.5,
};

export function stripeMinimumMajor(currency: string): number {
  const code = currency.toLowerCase();
  const listed = STRIPE_MINIMUM_MAJOR[code];
  if (listed != null) return listed;
  const scale = currencyMajorScale(code);
  if (scale === 0) return 50;
  if (scale === 3) return 0.5;
  return 0.5;
}

export function minorUnitsMeetMinimum(minor: number, currency: string): boolean {
  if (!Number.isInteger(minor) || minor <= 0) return false;
  return fromStripeMinorUnits(minor, currency) + 1e-9 >= stripeMinimumMajor(currency);
}

export function amountMeetsStripeMinimum(major: number, currency: string): boolean {
  if (!Number.isFinite(major)) return false;
  return major + 1e-9 >= stripeMinimumMajor(currency);
}

/** Stripe amount → major units for the invoice balance. */
export function fromStripeMinorUnits(minor: number, currency: string): number {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return minor;
  if (THREE_DECIMAL.has(code)) return minor / 1000;
  return minor / 100;
}

/**
 * Currency a Checkout Session for this organization must use.
 * An empty currency_code is the product default (usd). A stored code that is
 * not on the allowlist is unsupported and must not fall back to usd.
 * A missing currency_code column (migration not applied) is the same default.
 */
export async function loadChargeCurrency(
  client: CurrencyClient,
  orgId: string | number | null | undefined
): Promise<ChargeCurrency> {
  if (orgId == null || orgId === '') return { ok: false, reason: 'missing_org' };
  try {
    const { data, error } = await (client.from('organizations') as ChargeCurrencyQuery)
      .select('currency_code')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      if (COLUMN_MISSING.test(error.message || '')) return { ok: true, currency: 'usd' };
      return { ok: false, reason: 'currency_unavailable' };
    }
    if (!data) return { ok: false, reason: 'currency_unavailable' };
    if (data.currency_code == null || String(data.currency_code).trim() === '') {
      return { ok: true, currency: 'usd' };
    }
    const currency = checkoutCurrencyCode(data.currency_code);
    if (!currency) return { ok: false, reason: 'unsupported_currency' };
    return { ok: true, currency };
  } catch {
    return { ok: false, reason: 'currency_unavailable' };
  }
}
