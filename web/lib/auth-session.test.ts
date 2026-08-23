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

test('/plans Premium is 15 manuals and Team is unlimited', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(source, /15 service manuals/);
  assert.match(source, /Unlimited service manuals/);
  assert.doesNotMatch(source, /Full manual library/);
});

test('/plans does not claim success after checkout', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /toast\.success/);
  assert.doesNotMatch(source, /\/api\/billing\/upgrade\/confirm/);
  assert.match(source, /\/checkout\/receipt/);
});
