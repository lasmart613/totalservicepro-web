import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('admin portal loads role without embedding organizations from user_profiles', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const layout = readFileSync(join(here, '../app/admin/layout.tsx'), 'utf8');
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  const helper = readFileSync(join(here, '../lib/profile-nav.ts'), 'utf8');
  assert.match(layout, /loadOwnNavProfile/);
  assert.doesNotMatch(layout, /organizations\(/);
  assert.match(header, /loadOwnNavProfile/);
  assert.doesNotMatch(helper, /\.select\([^)]*organizations/);
});

test('home page does not flash marketing while a session is in localStorage', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/page.tsx'), 'utf8');
  assert.match(source, /hasBrowserAuthHint/);
  assert.match(source, /getSession/);
  assert.match(source, /showDashboardSplash/);
  assert.match(source, /authPending/);
});

test('landing Free Plan CTAs pass role into /plans', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.match(source, /plansHrefForAudience/);
  assert.match(source, /shop: 'company'/);
  assert.match(source, /clinic: 'owner'/);
  assert.match(source, /parts: 'supplier'/);
});

test('logged-out landing gives Free Plan a gold outline without making it primary', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  assert.match(page, /Start on the free plan/);
  assert.match(page, /A free plan is included\. Upgrade when you need more\./);
  assert.match(page, /lp-btn-outline/);
  assert.match(page, /Register for Total Service Pro/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Start on the free plan/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Register for a Free Plan/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Free Plan/);
  assert.match(css, /\.lp-btn-outline\s*\{[^}]*border:\s*1px solid #FBBF24/);
  assert.match(css, /\.lp-btn-primary\s*\{[^}]*background:\s*#FBBF24/);
});

test('logged-out landing shows schedule, assign-FSE, and test-equipment shots', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.match(source, /\/landing\/schedule\.webp/);
  assert.match(source, /\/landing\/ticket-assign\.webp/);
  assert.match(source, /\/landing\/team-equipment\.webp/);
  assert.match(source, /Color-coded shop calendar/);
  assert.match(source, /Assign an FSE and email them the ticket/);
  assert.match(source, /Assign shop test equipment to an FSE/);
});

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
  const companyBlock = tiles.split('const COMPANY_TILES')[1].split('const OWNER_TILES')[0];
  const ownerBlock = tiles.split('const OWNER_TILES')[1].split('const SUPPLIER_TILES')[0];
  const supplierBlock = tiles.split('const SUPPLIER_TILES')[1].split('export const PLAN_TILE_COPY')[0];
  assert.match(companyBlock, /PREMIUM_MANUALS_LINE/);
  assert.match(companyBlock, /TEAM_MANUALS_LINE/);
  assert.doesNotMatch(ownerBlock, /PREMIUM_MANUALS_LINE|TEAM_MANUALS_LINE|service manuals/i);
  assert.doesNotMatch(supplierBlock, /PREMIUM_MANUALS_LINE|TEAM_MANUALS_LINE|service manuals/i);
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(source, /planTileLines/);
  assert.match(source, /PlanAudienceSelector/);
  assert.doesNotMatch(source, /Unlimited service manuals/i);
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

test('/plans tiles list the same weekly-updates perk on every tier', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tiles = readFileSync(join(here, './billing/plan-tiles.ts'), 'utf8');
  assert.match(tiles, /export const WEEKLY_UPDATES_LINE = 'New features added weekly'/);
  assert.match(tiles, /WEEKLY_UPDATES_LINE/);
  const source = readFileSync(join(here, '../app/plans/page.tsx'), 'utf8');
  assert.match(source, /planTileLines/);
  const paywall = readFileSync(join(here, '../../app/src/main/assets/paywall.html'), 'utf8');
  const paywallWeekly = paywall.match(/New features added weekly/g) || [];
  assert.ok(paywallWeekly.length >= 2, 'Android paywall Premium and Team use the same weekly line');
  assert.match(paywall, /50 service manuals/);
  assert.doesNotMatch(paywall, /Unlimited service manuals/);
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
