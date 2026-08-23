import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('/plans never imports sign-out helpers', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /prepareFreshSignup|signOutAndClearIdentity|signOut\(/);
});

test('receipt page never imports sign-out helpers', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/checkout/receipt/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /prepareFreshSignup|signOutAndClearIdentity|signOut\(/);
});

test('checkout success lands on the receipt page, cancel stays on /plans', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, './billing/stripe-subscription.ts'), 'utf8');
  assert.match(source, /\/checkout\/receipt\?session_id=/);
  assert.match(source, /\/plans\?paid=0/);
  assert.doesNotMatch(source, /\/plans\?upgraded=1/);
});

test('manuals page does not treat Premium or pro as unlimited slots', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  assert.match(source, /manualSlotLimit/);
  assert.doesNotMatch(source, /premium\|team\|enterprise\|pro/);
});

test('/plans tiles: Premium 15, Team unlimited, Free does not claim a full library', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  const premiumHits = source.match(/PREMIUM_MANUALS_LINE|15 service manuals/g) || [];
  const teamHits = source.match(/TEAM_MANUALS_LINE|Unlimited service manuals/g) || [];
  assert.ok(premiumHits.length >= 3, 'Premium tile line used on both views');
  assert.ok(teamHits.length >= 3, 'Team tile line used on both views');
  assert.doesNotMatch(source, /Full manual library/i);
  assert.doesNotMatch(source, /full digital bookshelf/i);
  const freeBlocks = source.split(/<h[23][^>]*>Free/).slice(1);
  assert.equal(freeBlocks.length, 2);
  for (const block of freeBlocks) {
    const tile = block.slice(0, block.search(/<h[23][^>]*>|<\/article>/) || block.length);
    assert.doesNotMatch(tile, /unlimited/i);
    assert.doesNotMatch(tile, /full (manual|library)/i);
  }
});

test('/plans does not claim success after checkout', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /toast\.success/);
  assert.doesNotMatch(source, /\/api\/billing\/upgrade\/confirm/);
  assert.match(source, /\/checkout\/receipt/);
});
