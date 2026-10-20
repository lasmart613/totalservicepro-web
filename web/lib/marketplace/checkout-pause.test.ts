import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKETPLACE_CHECKOUT_PAUSED_MESSAGE,
  isMarketplaceCheckoutEnabled,
  marketplaceCheckoutPausedBody,
  parseCheckoutStatus,
} from './checkout-pause.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('part checkout is paused by default and only opens on exact "true"', () => {
  assert.equal(isMarketplaceCheckoutEnabled({}), false);
  for (const v of ['', 'false', '1', 'TRUE', 'yes', ' true']) {
    assert.equal(isMarketplaceCheckoutEnabled({ MARKETPLACE_CHECKOUT_ENABLED: v }), false, v);
  }
  assert.equal(isMarketplaceCheckoutEnabled({ MARKETPLACE_CHECKOUT_ENABLED: 'true' }), true);
});

test('paused body carries the friendly message', () => {
  const b = marketplaceCheckoutPausedBody();
  assert.equal(b.error, MARKETPLACE_CHECKOUT_PAUSED_MESSAGE);
  assert.equal(b.error, 'Checkout is temporarily unavailable. Please contact the seller.');
  assert.equal(b.checkoutEnabled, false);
});

test('client status parse fails closed', () => {
  for (const j of [null, undefined, {}, { checkoutEnabled: 'true' }, { checkoutEnabled: 1 }, 'x']) {
    assert.equal(parseCheckoutStatus(j), false);
  }
  assert.equal(parseCheckoutStatus({ checkoutEnabled: true }), true);
});

test('checkout route checks the kill switch before any DB or Stripe call', () => {
  const src = readFileSync(join(here, '../../app/api/marketplace/parts/[id]/checkout/route.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function POST'));
  const gate = body.indexOf('isMarketplaceCheckoutEnabled()');
  assert.ok(gate > 0);
  for (const call of ['loadMarketplaceListing(', 'syncPartStripeCatalog(', 'createPartCheckoutSession(']) {
    assert.ok(body.indexOf(call) > gate, call);
  }
  assert.match(body.slice(gate, gate + 300), /status: 503/);
});

test('part detail page swaps Buy for the paused label', () => {
  const src = readFileSync(join(here, '../../app/marketplace/parts/[id]/page.tsx'), 'utf8');
  assert.match(src, /MARKETPLACE_CHECKOUT_PAUSED_LABEL/);
  assert.match(src, /useState\(false\)/);
  assert.match(src, /\/api\/marketplace\/checkout-status/);
});

test('premium billing does not read the marketplace kill switch', () => {
  const src = readFileSync(join(here, '../../app/api/billing/upgrade/checkout/route.ts'), 'utf8');
  assert.doesNotMatch(src, /MARKETPLACE_CHECKOUT_ENABLED|checkout-pause/);
});
