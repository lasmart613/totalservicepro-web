import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amountMeetsStripeMinimum,
  exactStripeMinorUnits,
  fromStripeMinorUnits,
  stripeMinimumMajor,
  toStripeMinorUnits,
} from './stripe-currency.ts';
import {
  buildInvoiceCheckoutParams,
  buildLegacyInvoiceCheckoutParams,
  createInvoiceCheckoutSession,
} from './stripe-pay.ts';
import { invoiceCheckoutWebhookResult } from './persist-invoice-payment.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('minor units are exact for USD, JPY, ISK, and KWD', () => {
  assert.equal(toStripeMinorUnits(10.5, 'usd'), 1050);
  assert.equal(toStripeMinorUnits(10.5, 'eur'), 1050);
  assert.equal(toStripeMinorUnits(10.505, 'usd'), null);
  assert.equal(toStripeMinorUnits(1234, 'jpy'), 1234);
  assert.equal(toStripeMinorUnits(1234.4, 'jpy'), null);
  assert.equal(toStripeMinorUnits(5, 'isk'), 500);
  assert.equal(toStripeMinorUnits(5.2, 'isk'), null);
  assert.equal(toStripeMinorUnits(5, 'ugx'), 500);
  assert.equal(exactStripeMinorUnits(1.23, 'kwd'), 1230);
  assert.equal(exactStripeMinorUnits(1.230, 'kwd'), 1230);
  assert.equal(exactStripeMinorUnits(1.231, 'kwd'), null);
  assert.equal(exactStripeMinorUnits(1.234, 'kwd'), null);
  assert.equal(fromStripeMinorUnits(1050, 'usd'), 10.5);
  assert.equal(fromStripeMinorUnits(1234, 'jpy'), 1234);
  assert.equal(fromStripeMinorUnits(500, 'isk'), 5);
  assert.equal(fromStripeMinorUnits(1230, 'kwd'), 1.23);
});

test('Stripe minimums replace the flat 50 minor-unit floor', () => {
  assert.equal(stripeMinimumMajor('usd'), 0.5);
  assert.equal(stripeMinimumMajor('huf'), 175);
  assert.equal(stripeMinimumMajor('mxn'), 10);
  assert.equal(stripeMinimumMajor('gbp'), 0.3);
  assert.equal(amountMeetsStripeMinimum(0.49, 'usd'), false);
  assert.equal(amountMeetsStripeMinimum(0.5, 'usd'), true);
  assert.equal(amountMeetsStripeMinimum(174, 'huf'), false);
  assert.equal(amountMeetsStripeMinimum(175, 'huf'), true);
  assert.equal(amountMeetsStripeMinimum(9, 'mxn'), false);
  assert.equal(amountMeetsStripeMinimum(10, 'mxn'), true);
  assert.equal(amountMeetsStripeMinimum(0.3, 'gbp'), true);
  assert.equal(amountMeetsStripeMinimum(49, 'jpy'), false);
  assert.equal(amountMeetsStripeMinimum(50, 'jpy'), true);
});

test('checkout stores the charge currency and minor amount and refuses an inexact amount', async () => {
  const usd = buildLegacyInvoiceCheckoutParams({
    amountCents: 1050,
    currency: 'usd',
    description: 'Invoice INV-1',
  });
  assert.equal(usd?.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(usd?.get('line_items[0][price_data][unit_amount]'), '1050');
  assert.equal(usd?.get('metadata[charge_currency]'), 'usd');
  assert.equal(usd?.get('metadata[charge_amount_minor]'), '1050');

  const yen = buildLegacyInvoiceCheckoutParams({
    amountCents: 1500,
    currency: 'jpy',
    description: 'Invoice INV-3',
  });
  assert.equal(yen?.get('line_items[0][price_data][currency]'), 'jpy');
  assert.equal(yen?.get('line_items[0][price_data][unit_amount]'), '1500');
  assert.equal(yen?.get('payment_intent_data[metadata][charge_amount_minor]'), '1500');

  const kwd = buildInvoiceCheckoutParams({
    amountCents: 1230,
    currency: 'kwd',
    description: 'Invoice INV-4',
    destinationAccountId: 'acct_shop123',
    payoutStatus: 'transferred',
  });
  assert.equal(kwd?.get('line_items[0][price_data][currency]'), 'kwd');
  assert.equal(kwd?.get('metadata[charge_amount_minor]'), '1230');

  assert.equal(buildLegacyInvoiceCheckoutParams({ amountCents: 40, currency: 'usd', description: 'small' }), null);
  assert.equal(buildLegacyInvoiceCheckoutParams({ amountCents: 30, currency: 'gbp', description: 'gbp' })?.get('line_items[0][price_data][unit_amount]'), '30');

  let fetched = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched = true;
    throw new Error('Stripe must not be called');
  }) as typeof fetch;
  try {
    const missing = await createInvoiceCheckoutSession({
      amountCents: 2500,
      description: 'Invoice',
      invoiceId: 1,
      legacyPlatformCharge: true,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, 'unsupported_currency');
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('a stored-charge mismatch is a review result, not an ignored webhook', () => {
  for (const reason of ['currency_mismatch', 'amount_mismatch'] as const) {
    const result = invoiceCheckoutWebhookResult(reason);
    assert.equal(result?.status, 200);
    assert.equal(result?.body.review, reason);
    assert.equal(result?.body.ignored, undefined);
    assert.equal(result?.body.kind, 'invoice');
  }
  const sql = readFileSync(
    join(here, '../../supabase/migrations/20261122_000971_invoice_claim_currency.sql'),
    'utf8'
  );
  const rollback = readFileSync(
    join(here, '../../supabase/migrations/20261122_000971_invoice_claim_currency_rollback.sql'),
    'utf8'
  );
  const original = readFileSync(
    join(here, '../../supabase/migrations/20261118_000963_service_invoice_stripe_payments.sql'),
    'utf8'
  );
  assert.doesNotMatch(sql, /lower\(btrim\(p_currency\)\) <> 'usd'/);
  assert.match(sql, /'bhd', 'jod', 'kwd', 'omr', 'tnd'/);
  assert.match(sql, /numeric\(12,2\)/);
  assert.match(sql, /FROM public\.organizations/);
  assert.ok(sql.indexOf('IF FOUND THEN') < sql.indexOf("reason', 'bad_amount'"));
  assert.match(sql, /SET search_path = public, pg_temp/);
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.doesNotMatch(fn, /SECURITY DEFINER/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_service_invoice_stripe_payment/);
  const originalFn = original.slice(original.indexOf('CREATE OR REPLACE FUNCTION public.apply_service_invoice_stripe_payment'));
  const rollbackFn = rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION public.apply_service_invoice_stripe_payment'));
  assert.equal(rollbackFn.trim(), originalFn.trim());
});
