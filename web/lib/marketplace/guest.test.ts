import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUEST_SIGNUP_HREF, displayListingPrice, listingHref } from './guest.ts';

test('logged-out listing clicks go to register, not the product page', () => {
  assert.equal(listingHref(false, '/marketplace/parts/abc'), GUEST_SIGNUP_HREF);
  assert.equal(listingHref(true, '/marketplace/parts/abc'), '/marketplace/parts/abc');
});

test('logged-out prices are replaced so the amount is not readable', () => {
  assert.equal(displayListingPrice(false, '$1,175'), '$••••');
  assert.equal(displayListingPrice(true, '$1,175'), '$1,175');
});

test('marketplace catalog pages blur guest prices and send clicks to signup', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    '../../app/marketplace/parts/page.tsx',
    '../../app/marketplace/consumables/page.tsx',
    '../../app/marketplace/used-systems/page.tsx',
  ]) {
    const source = readFileSync(join(here, rel), 'utf8');
    assert.match(source, /GuestAwarePrice/);
    assert.match(source, /listingHref/);
  }
});
