import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landingHalfSrc, landingSrcSet, LANDING_SHOT_SIZE, localizedLandingSrc } from './landing-images.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('desktop landing stills have a 700w variant and phone shots do not', () => {
  assert.equal(landingHalfSrc('/landing/parts.webp'), '/landing/parts-700.webp');
  assert.equal(landingSrcSet('/landing/dashboard.webp'), '/landing/dashboard-700.webp 700w, /landing/dashboard.webp 1400w');
  assert.equal(landingHalfSrc('/landing/app-hub.webp'), null);
  assert.equal(landingHalfSrc('/landing/hero-bg-parts.webp'), null);

  for (const src of [
    '/landing/dashboard.webp',
    '/landing/schedule.webp',
    '/landing/marketplace.webp',
    '/landing/parts.webp',
    '/landing/reports.webp',
    '/landing/ticket-assign.webp',
    '/landing/team-equipment.webp',
    '/landing/directory.webp',
  ]) {
    const half = landingHalfSrc(src);
    assert.ok(half);
    const file = join(here, '../public', half.replace(/^\//, ''));
    assert.ok(existsSync(file), half);
    assert.ok(statSync(file).size < statSync(join(here, '../public', src.replace(/^\//, ''))).size);
    assert.ok(LANDING_SHOT_SIZE[src], src);
  }
});

test('Farsi, Spanish, and French stills sit beside the English files', () => {
  assert.equal(localizedLandingSrc('/landing/dashboard.webp', 'en'), '/landing/dashboard.webp');
  assert.equal(localizedLandingSrc('/landing/dashboard.webp', 'fa'), '/landing/fa/dashboard.webp');
  assert.equal(localizedLandingSrc('/landing/parts.webp', 'es'), '/landing/es/parts.webp');
  assert.equal(localizedLandingSrc('/landing/app-hub.webp', 'fr'), '/landing/fr/app-hub.webp');
  assert.equal(localizedLandingSrc('/landing/hero-bg-shop.webp', 'fa'), '/landing/hero-bg-shop.webp');
  assert.equal(localizedLandingSrc('/landing/badge-google-play.png', 'es'), '/landing/badge-google-play.png');
  assert.equal(localizedLandingSrc('/landing/app-reports.webp', 'fa'), '/landing/app-reports.webp');
  for (const locale of ['he', 'it', 'de', 'pt', 'ar']) {
    assert.equal(localizedLandingSrc('/landing/dashboard.webp', locale), '/landing/dashboard.webp');
  }
  assert.equal(landingHalfSrc('/landing/fa/dashboard.webp'), '/landing/fa/dashboard-700.webp');
  assert.equal(landingHalfSrc('/landing/es/app-calcs.webp'), null);

  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.match(page, /localizedLandingSrc/);
  assert.match(page, /usePublicLocale\(\)/);
  assert.match(page, /prefixLocaleHref/);
  assert.doesNotMatch(page, /useFa\(/);
  assert.doesNotMatch(page, /src: '\/landing\/fa\//);

  for (const locale of ['fa', 'es', 'fr']) {
    for (const name of [
      'dashboard.webp',
      'dashboard-700.webp',
      'schedule.webp',
      'schedule-700.webp',
      'ticket-assign.webp',
      'team-equipment.webp',
      'directory.webp',
      'reports.webp',
      'parts.webp',
      'marketplace.webp',
      'app-hub.webp',
      'app-calcs.webp',
    ]) {
      const file = join(here, '../public/landing', locale, name);
      assert.ok(existsSync(file), `${locale}/${name}`);
      assert.ok(statSync(file).size > 2000, `${locale}/${name} should be a real still`);
    }
    const full = statSync(join(here, '../public/landing', locale, 'dashboard.webp')).size;
    const half = statSync(join(here, '../public/landing', locale, 'dashboard-700.webp')).size;
    assert.ok(half < full, `${locale} half still should be smaller`);
  }
});

test('landing markup lazy-loads below-the-fold stills and keeps the first hero eager', () => {
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.match(page, /loading=\{priority \? 'eager' : 'lazy'\}/);
  assert.match(page, /decoding="async"/);
  assert.match(page, /landingSrcSet/);
  assert.match(page, /priority=\{idx === 0\}/);
  assert.match(page, /mount=\{visited\.has\(idx\)\}/);
  const field = page.split('id="app"')[1];
  assert.match(field, /app-hub\.webp[\s\S]*loading="lazy"/);
  assert.match(field, /app-calcs\.webp[\s\S]*loading="lazy"/);
  assert.match(field, /badge-google-play\.png[\s\S]*loading="lazy"/);
});
