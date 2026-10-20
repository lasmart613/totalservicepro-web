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
  for (const bad of [0, -1, 6, 2.5, 'abc', NaN, Infinity]) {
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
