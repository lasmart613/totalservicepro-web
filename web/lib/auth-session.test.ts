import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  const dash = readFileSync(join(here, '../components/home/HomeDashboard.tsx'), 'utf8');
  assert.match(source, /hasBrowserAuthHint/);
  assert.match(source, /showDashboardSplash/);
  assert.match(source, /shouldShowHomeDashboardSplash/);
  assert.match(source, /return <LandingPage \/>/);
  assert.match(source, /import\('@\/components\/home\/HomeDashboard'\)/);
  assert.match(source, /HomeDashboard/);
  assert.doesNotMatch(source, /from '@\/components\/home\/HomeDashboard'/);
  assert.doesNotMatch(source, /from '@\/components\/Header'/);
  assert.doesNotMatch(source, /from 'lucide-react'/);
  assert.doesNotMatch(source, /from 'next\/dynamic'/);
  assert.match(dash, /getSession/);
  assert.match(dash, /authPending/);
  assert.doesNotMatch(source, /authHintReady/);
});

test('landing Free Plan CTAs pass role into /plans', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.match(source, /plansHrefForAudience/);
  assert.match(source, /shop: 'company'/);
  assert.match(source, /clinic: 'owner'/);
  assert.match(source, /parts: 'supplier'/);
});

test('logged-out hero has a unique subtitle on every slide and no trial phrasing', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  const heroBlock = page.split('const HERO_SLIDES')[1].split('const HERO_AUTO_MS')[0];
  const titles = [...heroBlock.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  const subs = [...heroBlock.matchAll(/sub: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(titles.length, 9);
  assert.equal(subs.length, 9);
  assert.equal(new Set(subs).size, 9, 'each hero slide needs its own subtitle');
  assert.deepEqual(subs, [
    'Color-coded jobs for the whole shop.',
    'Match lasers, lithotriptors, and C-arms with shops that can work on them.',
    'Get found when a shop needs a part that’s on your shelf.',
    'Assign each call to a field engineer.',
    'Track work and maintenance costs on every system.',
    'They get the job details when you assign it.',
    'Keep meters and tools with the tech who needs them.',
    'Fluence, irradiance, and power in the field.',
    'Bid jobs and find parts from one shop account.',
  ]);
  assert.match(page, /See Open Tickets and Upcoming Calls/);
  assert.match(page, /Connecting Medical Equipment Owners to Top Service Professionals/);
  assert.doesNotMatch(page, /RepairPlanet is a biomedical equipment service network/);
  assert.match(page, /Start on the free plan/);
  assert.match(page, /A free plan is included\./);
  assert.match(page, /lp-hero-subhead/);
  assert.match(page, /lp-hero-tagline/);
  assert.match(css, /\.lp-hero-subhead\s*\{/);
  assert.match(css, /\.lp-hero-tagline\s*\{/);
  assert.match(css, /--lp-fluke-green:\s*#8BC53F/);
  assert.match(css, /color:\s*var\(--lp-fluke-green\)/);
  assert.doesNotMatch(page, /Free to start/);
  assert.doesNotMatch(page, /Tickets, parts, and the marketplace in one shop/);
  assert.doesNotMatch(page, /lp-hero-benefits|lp-mini-carousel|hero-cards/);
  const clinicChunks = heroBlock.split(/\{/).filter((chunk) => chunk.includes("audience: 'Clinics'"));
  assert.equal(clinicChunks.length, 2);
  for (const chunk of clinicChunks) {
    assert.doesNotMatch(chunk, /marketplace/i);
    assert.doesNotMatch(chunk, /\bparts\b/i);
    assert.doesNotMatch(chunk, /\btickets?\b/i);
  }
});

test('logged-out landing gives Free Plan a gold outline without making it primary', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  assert.match(page, /Start on the free plan/);
  assert.match(page, /A free plan is included\. Upgrade when you need more\./);
  assert.match(page, /lp-btn-outline/);
  assert.match(page, /Find a service rep near me/);
  assert.match(page, /Register for Total Service Pro/);
  assert.doesNotMatch(page, /Free to start/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Start on the free plan/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Register for a Free Plan/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Free Plan/);
  assert.match(css, /\.lp-btn-outline\s*\{[^}]*border:\s*1px solid #FBBF24/);
  assert.match(css, /\.lp-btn-primary\s*\{[^}]*background:\s*#FBBF24/);
});

test('logged-out landing pairs each hero title with a unique matching still', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const heroBlock = source.split('const HERO_SLIDES')[1].split('const HERO_AUTO_MS')[0];
  const titles = [...heroBlock.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  const srcs = [...heroBlock.matchAll(/src: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(titles.length, srcs.length);
  assert.equal(new Set(srcs).size, srcs.length, 'hero stills must be unique');
  const byTitle = Object.fromEntries(titles.map((t, i) => [t, srcs[i]]));
  assert.equal(titles.length, 9);
  assert.deepEqual(
    titles,
    [
      'See Open Tickets and Upcoming Calls',
      'Find a Repair Company',
      'Connect with Repair Companies and Clinics',
      'Schedule and Assign Service Calls',
      'View Service History',
      'Assign a Field Engineer and Email Them the Ticket',
      'Assign Shop Test Equipment to a Field Engineer',
      'Photometry Tools on the Job',
      'Marketplace — Parts, Used Systems, and Service Needs',
    ],
  );
  assert.equal(byTitle['See Open Tickets and Upcoming Calls'], '/landing/dashboard.webp');
  assert.equal(byTitle['Schedule and Assign Service Calls'], '/landing/schedule.webp');
  assert.equal(byTitle['Assign a Field Engineer and Email Them the Ticket'], '/landing/ticket-assign.webp');
  assert.equal(byTitle['Assign Shop Test Equipment to a Field Engineer'], '/landing/team-equipment.webp');
  assert.equal(byTitle['Photometry Tools on the Job'], '/landing/app-calcs.webp');
  assert.equal(byTitle['Marketplace — Parts, Used Systems, and Service Needs'], '/landing/marketplace.webp');
  assert.equal(byTitle['Find a Repair Company'], '/landing/directory.webp');
  assert.equal(byTitle['View Service History'], '/landing/reports.webp');
  assert.equal(byTitle['Connect with Repair Companies and Clinics'], '/landing/parts.webp');
  assert.match(source, /caption: 'Shop dashboard'/);
  assert.match(source, /caption: 'Photometry tools'/);
  assert.doesNotMatch(heroBlock, /Bid on open service requests/);
  assert.doesNotMatch(heroBlock, /Receive multiple bids on service requests/);
  assert.doesNotMatch(heroBlock, /\/landing\/login\.webp|\/landing\/signup\.webp|\/landing\/app-reports\.webp|\/landing\/app-hub\.webp/);
  const galleryBlock = source.split('aria-label="Product screens"')[1].split('id="features"')[0];
  assert.match(galleryBlock, /\/landing\/dashboard\.webp/);
  assert.doesNotMatch(galleryBlock, /\/landing\/app-calcs\.webp/);
  assert.match(source, /What you get/);
  assert.match(source, /Color-coded shop calendar — assign calls by field engineer/);
  assert.match(source, /id: 'clinic'[\s\S]*?src: '\/landing\/directory\.webp'/);
  assert.match(source, /\/landing\/directory\.webp/);
  assert.match(source, /Same account in the field/);
  assert.doesNotMatch(source, /id="join"|lp-paths/);
  assert.doesNotMatch(source, /Email the report on the jobsite/);
  assert.doesNotMatch(source, /Cut the next call/);
  assert.doesNotMatch(source, /Maximize uptime on every box/);
  assert.doesNotMatch(source, /List what is on the shelf/);
  assert.doesNotMatch(source, /\bFSE\b/);
  const shell = readFileSync(join(here, '../components/landing/LandingShell.tsx'), 'utf8');
  assert.doesNotMatch(shell, /\bFSE\b/);
});

test('logged-out hero paints a darkened role cover behind left copy', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  assert.match(page, /'Repair companies': '\/landing\/hero-bg-shop\.webp'/);
  assert.match(page, /Clinics: '\/landing\/hero-bg-clinic\.webp'/);
  assert.match(page, /'Parts sellers': '\/landing\/hero-bg-parts\.webp'/);
  assert.match(page, /--lp-hero-cover/);
  assert.match(page, /data-cover=\{HERO_COVER_ID\[s\.audience\]\}/);
  assert.match(css, /\.lp-hero-copy::before/);
  assert.match(css, /\[data-cover='clinic'\]::before/);
  assert.match(css, /\[data-cover='parts'\]::before/);
  assert.match(css, /\[data-cover='clinic'\]\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(css, /\[data-cover='clinic'\]\s*\{[^}]*background-position:\s*12% 72%/);
  assert.match(css, /rgba\(17,\s*24,\s*39/);
  assert.doesNotMatch(page, /lp-hero-benefits|lp-mini-carousel|hero-cards/);
  for (const name of ['hero-bg-shop.webp', 'hero-bg-clinic.webp', 'hero-bg-parts.webp']) {
    const file = join(here, '../public/landing', name);
    assert.ok(existsSync(file), name);
    const bytes = statSync(file).size;
    assert.ok(bytes > 8_000, `${name} should be a real photo`);
    assert.ok(bytes < 250_000, `${name} should stay reasonable`);
  }
  for (const name of ['hero-bg-shop-640.webp', 'hero-bg-clinic-640.webp', 'hero-bg-parts-640.webp']) {
    const file = join(here, '../public/landing', name);
    assert.ok(existsSync(file), name);
    assert.ok(statSync(file).size < 80_000, `${name} should be the mobile cover`);
  }
  assert.match(page, /HERO_COVER_SM/);
  assert.match(page, /is-cover-on/);
  assert.match(css, /\.lp-hero-copy\.is-cover-on/);
});

test('logged-out field section shows coming-soon store badges, not live listings', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  const field = page.split('id="app"')[1];
  assert.match(field, /Same account in the field/);
  assert.match(field, /View or edit Schedule, find parts, search service manuals, and create service reports on Android or IOS\./);
  assert.match(field, /Coming soon/);
  assert.match(field, /lp-kicker/);
  assert.match(field, /Google Play — coming soon/);
  assert.match(field, /App Store — coming soon/);
  assert.match(field, /Android and iOS/);
  assert.match(field, /\/landing\/app-hub\.webp/);
  assert.match(field, /\/landing\/app-calcs\.webp/);
  assert.match(field, /\/landing\/badge-google-play\.png/);
  assert.match(field, /width=\{646\}/);
  assert.match(field, /height=\{250\}/);
  assert.match(field, /\/landing\/badge-app-store\.svg/);
  assert.match(css, /aspect-ratio:\s*646\s*\/\s*250/);
  assert.match(field, /Mobile apps coming soon/);
  assert.doesNotMatch(field, /play\.google\.com\/store/);
  assert.doesNotMatch(field, /apps\.apple\.com/);
  assert.doesNotMatch(field, /href=["']https?:\/\//);
  assert.match(css, /\.lp-store-badges\s*\{/);
  assert.match(css, /\.lp-phones-copy \.lp-kicker\s*\{/);
  assert.match(css, /\.lp-store-platforms\s*\{[^}]*#9CA3AF/);
  const play = join(here, '../public/landing/badge-google-play.png');
  const apple = join(here, '../public/landing/badge-app-store.svg');
  assert.ok(existsSync(play), 'official Google Play badge');
  assert.ok(existsSync(apple), 'official App Store badge');
  assert.ok(statSync(play).size > 2000, 'Play badge should be the official PNG');
  const appleSvg = readFileSync(apple, 'utf8');
  assert.match(appleSvg, /Download_on_the_App_Store_Badge_US-UK_RGB_blk/);
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
  for (const rel of ['../components/home/HomeDashboard.tsx', '../app/company/page.tsx', '../app/admin/layout.tsx', '../components/Header.tsx']) {
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
