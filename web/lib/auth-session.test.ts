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

test('/plans reads the current org plan and can sync a missed Checkout', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(source, /currentOrgPlan/);
  assert.match(source, /loadOrgPlanRow/);
  assert.match(source, /\/api\/billing\/upgrade\/sync/);
  assert.doesNotMatch(source, /organizations\(name, is_premium/);
});

test('Upgrade chrome goes to /plans and never starts Stripe Checkout', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const link = readFileSync(join(here, '../components/UpgradePlanLink.tsx'), 'utf8');
  assert.match(link, /href=\{UPGRADE_HREF\}/);
  assert.match(link, /export const UPGRADE_HREF = '\/plans'/);
  assert.doesNotMatch(link, /startClientUpgradeCheckout|team_monthly|preventDefault/);
  for (const rel of ['../app/page.tsx', '../app/company/page.tsx', '../app/admin/layout.tsx', '../components/Header.tsx']) {
    const source = readFileSync(join(here, rel), 'utf8');
    assert.match(source, /UpgradePlanLink/);
    assert.doesNotMatch(source, /startClientUpgradeCheckout|team_monthly/);
  }
  const plans = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(plans, /startClientUpgradeCheckout/);
  assert.match(plans, /Upgrade to Premium/);
  assert.match(plans, /Upgrade to Team/);
});

test('webhook and sync routes persist the existing org and never sign up', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const webhook = readFileSync(join(here, '../app/api/billing/upgrade/webhook/route.ts'), 'utf8');
  const sync = readFileSync(join(here, '../app/api/billing/upgrade/sync/route.ts'), 'utf8');
  assert.match(webhook, /verifyStripeWebhookSignature/);
  assert.match(webhook, /applyPaidCheckoutSession/);
  assert.doesNotMatch(webhook, /signUp|createUser|from\('organizations'\)\.insert/);
  assert.match(sync, /pickLatestPaidUpgradeSession/);
  assert.doesNotMatch(sync, /signUp|createUser|from\('organizations'\)\.insert/);
});
