import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { landingHalfSrc, landingSrcSet, LANDING_SHOT_SIZE } from './landing-images.ts';

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
