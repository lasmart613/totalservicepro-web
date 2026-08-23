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

test('/plans tiles: Premium 15, Team 50, Free does not claim a full library', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tiles = readFileSync(join(here, './billing/plan-tiles.ts'), 'utf8');
  assert.match(tiles, /export const TEAM_MANUALS_LINE = '50 service manuals'/);
  assert.doesNotMatch(tiles, /Unlimited service manuals/);
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  const premiumHits = source.match(/PREMIUM_MANUALS_LINE|15 service manuals/g) || [];
  const teamHits = source.match(/TEAM_MANUALS_LINE|50 service manuals/g) || [];
  assert.ok(premiumHits.length >= 3, 'Premium tile line used on both views');
  assert.ok(teamHits.length >= 3, 'Team tile line used on both views');
  assert.doesNotMatch(source, /Unlimited service manuals/i);
  assert.doesNotMatch(source, /Full manual library/i);
  assert.doesNotMatch(source, /full digital bookshelf/i);
  const freeBlocks = source.split(/<h[23][^>]*>Free/).slice(1);
  assert.equal(freeBlocks.length, 2);
  for (const block of freeBlocks) {
    const tile = block.slice(0, block.search(/<h[23][^>]*>|<\/article>/) || block.length);
    assert.doesNotMatch(tile, /unlimited/i);
    assert.doesNotMatch(tile, /50 service manuals/);
    assert.doesNotMatch(tile, /15 service manuals/);
    assert.doesNotMatch(tile, /full (manual|library)/i);
    assert.match(tile, /SHARED_SERVICE_HISTORY_LINE/);
    assert.match(tile, /FREE_AI_LINE/);
  }
});

test('/plans tiles show shared history and per-member AI caps on both views', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tiles = readFileSync(join(here, './billing/plan-tiles.ts'), 'utf8');
  assert.match(tiles, /export const SHARED_SERVICE_HISTORY_LINE = 'Shared service history'/);
  assert.match(tiles, /5 text queries\/day and 5 voice queries\/day per team member/);
  assert.match(tiles, /50 text queries\/day and 50 voice queries\/day per team member/);
  assert.match(tiles, /250 text queries\/day and 250 voice queries\/day per team member/);
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(source, /SHARED_SERVICE_HISTORY_LINE/);
  assert.match(source, /FREE_AI_LINE/);
  assert.match(source, /PREMIUM_AI_LINE/);
  assert.match(source, /TEAM_AI_LINE/);
  const historyHits = source.match(/SHARED_SERVICE_HISTORY_LINE/g) || [];
  assert.ok(historyHits.length >= 6, 'history line on all three tiles in both views');
  assert.doesNotMatch(source, /AI troubleshooting assistant/);
});

test('manuals add and library API use the same slot gate (Team 50, not unlimited)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const manuals = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const api = readFileSync(join(here, '../app/api/manuals/library/route.ts'), 'utf8');
  assert.match(manuals, /manualSlotLimit/);
  assert.match(manuals, /isUnlimitedManualSlots/);
  assert.match(api, /manualSlotLimit/);
  assert.match(api, /owned\.size >= limit/);
  assert.doesNotMatch(api, /Team \/ Enterprise are unlimited/);
});

test('web AI client posts through the quota-enforcing API, not grok-assistant directly', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, './ai/grok-client.ts'), 'utf8');
  assert.match(source, /\/api\/ai\/assistant/);
  assert.doesNotMatch(source, /functions\/v1\/grok-assistant/);
  const route = readFileSync(join(here, '../app/api/ai/assistant/route.ts'), 'utf8');
  assert.match(route, /isDailyLimitReached/);
  assert.match(route, /api_usage/);
  assert.match(route, /aiDailyLimitsForOrg/);
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
