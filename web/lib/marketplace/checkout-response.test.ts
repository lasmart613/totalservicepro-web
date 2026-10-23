import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicCatalogFields } from './checkout-response.ts';

const here = dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(join(here, '../../app/api/marketplace/parts/[id]/checkout/route.ts'), 'utf8');

test('publicCatalogFields drops Stripe ids', () => {
  const out = publicCatalogFields({
    productId: 'prod_x', priceId: 'price_x', stripe_price_cents: 100, stripePriceId: 'p',
    amountCents: 1200, currency: 'usd',
  });
  assert.deepEqual(out, { amountCents: 1200, currency: 'usd' });
  assert.deepEqual(publicCatalogFields(null), {});
  assert.deepEqual(publicCatalogFields('x'), {});
});

test('checkout route never returns productId / priceId (session or syncOnly)', () => {
  const post = routeSrc.slice(routeSrc.indexOf('export async function POST'));
  assert.doesNotMatch(post, /productId|priceId/);
  assert.match(post, /\.\.\.publicCatalogFields\(catalog\)/);
  assert.doesNotMatch(post, /\.\.\.catalog\b/);
});

test('pause gate (503) precedes body parse, DB load and the syncOnly branch', () => {
  const post = routeSrc.slice(routeSrc.indexOf('export async function POST'));
  const gate = post.indexOf('isMarketplaceCheckoutEnabled()');
  assert.ok(gate > 0);
  const status503 = post.indexOf('status: 503');
  assert.ok(status503 > gate);
  for (const later of ['req.json(', 'loadMarketplaceListing(', 'body?.syncOnly', 'syncPartStripeCatalog(', 'createPartCheckoutSession(']) {
    const at = post.indexOf(later);
    assert.ok(at > status503, `${later} must come after the 503 return`);
  }
});
