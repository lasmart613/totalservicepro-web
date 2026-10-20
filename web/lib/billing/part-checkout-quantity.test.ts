import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  StripeMarketplaceError,
  buildPartCheckoutSessionFields,
  validatedPartQuantity,
} from './stripe-marketplace.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');

test('C: part checkout never offers adjustable quantity (fee would stay at 1 unit)', () => {
  const fields = buildPartCheckoutSessionFields({
    site: 'https://repairplanet.net',
    listingId: 'l1',
    priceId: 'price_1',
    quantity: 3,
    maxQuantity: 10,
    charge: { mode: 'destination', fields: { 'payment_intent_data[application_fee_amount]': 450 }, applicationFeeCents: 450 },
  });
  assert.equal(fields['line_items[0][quantity]'], 3);
  assert.equal(fields['metadata[quantity]'], 3);
  assert.ok(!Object.keys(fields).some((k) => k.includes('adjustable_quantity')));
});

test('C: quantity is validated server-side: whole number from 1 to stock', () => {
  assert.equal(validatedPartQuantity(undefined, 5), 1);
  assert.equal(validatedPartQuantity(null, null), 1);
  assert.equal(validatedPartQuantity(3, 5), 3);
  assert.equal(validatedPartQuantity('2', 5), 2);
  assert.equal(validatedPartQuantity(5, 5), 5);
  for (const bad of [0, -1, 6, 2.5, 'abc', NaN, Infinity, '', true, false, [2], ['2'], { n: 2 }, '0x2', '1e1', '2.0', ' 2', '2 ', '02', '+2', '-1', '0', 2n, 2 ** 53]) {
    assert.throws(() => validatedPartQuantity(bad, 5), (e: unknown) => e instanceof StripeMarketplaceError && e.status === 400, String(bad));
  }
  // Unknown stock: 1 only.
  assert.throws(() => validatedPartQuantity(2, null), StripeMarketplaceError);
});

test('C: application fee base is unit price x the fixed quantity', () => {
  const src = read('lib/billing/stripe-marketplace.ts');
  assert.match(src, /const qty = validatedPartQuantity\(input\.quantity, maxQty\);/);
  assert.match(src, /const feeBaseCents = catalog\.amountCents \* qty;/);
  assert.doesNotMatch(src, /adjustable \? catalog\.amountCents/);
  assert.doesNotMatch(src, /adjustable_quantity\]\[enabled\]/);
});

test('C: the detail page sends the chosen quantity; the route does not coerce it', () => {
  const page = read('app/marketplace/parts/[id]/page.tsx');
  assert.match(page, /quantity: buyQty/);
  assert.doesNotMatch(page, /quantity: 1 \}/);
  const route = read('app/api/marketplace/parts/[id]/checkout/route.ts');
  assert.match(route, /const quantity: unknown = body\?\.quantity;/);
});

test('C: strict coercion accepts only integers and plain digit strings', () => {
  assert.equal(validatedPartQuantity('1', 5), 1);
  assert.equal(validatedPartQuantity('10', 10), 10);
  assert.equal(validatedPartQuantity(4, 5), 4);
  assert.throws(() => validatedPartQuantity(true, 5), StripeMarketplaceError);
  assert.throws(() => validatedPartQuantity([2], 5), StripeMarketplaceError);
  assert.throws(() => validatedPartQuantity('0x2', 5), StripeMarketplaceError);
  assert.throws(() => validatedPartQuantity('1e1', 50), StripeMarketplaceError);
});

test('C: quantity is validated before any Stripe catalog sync', () => {
  const src = read('lib/billing/stripe-marketplace.ts');
  const body = src.slice(src.indexOf('export async function createPartCheckoutSession('));
  const v = body.indexOf('validatedPartQuantity(input.quantity');
  const sync = body.indexOf('syncPartStripeCatalog(');
  assert.ok(v > 0 && sync > 0 && v < sync, 'validation must come before syncPartStripeCatalog');
});
