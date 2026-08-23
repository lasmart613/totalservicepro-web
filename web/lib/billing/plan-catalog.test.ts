import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatStripeInterval,
  formatStripeMoney,
  isMarketplaceStripeMeta,
  isStripePriceId,
  livePlanFromStripePrice,
} from './plan-catalog.ts';

test('only real Stripe price ids are accepted', () => {
  assert.equal(isStripePriceId('price_1ABC'), true);
  assert.equal(isStripePriceId('prod_1ABC'), false);
  assert.equal(isStripePriceId('premium_monthly'), false);
  assert.equal(isStripePriceId(''), false);
});

test('marketplace metadata is not an org plan', () => {
  assert.equal(isMarketplaceStripeMeta({ marketplace_listing_id: 'x' }), true);
  assert.equal(isMarketplaceStripeMeta({ source: 'repairplanet_marketplace' }), true);
  assert.equal(isMarketplaceStripeMeta({}), false);
});

test('money formatting uses the Stripe amount, not a hardcoded catalog', () => {
  assert.equal(formatStripeMoney(1234, 'usd'), '$12.34');
  assert.equal(formatStripeInterval('month'), '/ month');
  assert.equal(formatStripeInterval('year'), '/ year');
});

test('source files do not invent Android Play dollar amounts', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ['plan-catalog.ts', 'upgrade-session.ts', '../../app/plans/page.tsx']) {
    const source = readFileSync(join(here, rel), 'utf8');
    assert.doesNotMatch(source, /\$9\.99|\$39\.99|\$6\.66|\$24\.99|\$119\.88|\$479\.88/);
    assert.doesNotMatch(source, /premium_monthly|team_annual/);
  }
});
