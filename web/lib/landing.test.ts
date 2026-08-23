import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const landing = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');

test('hero auto-advances every 5–7 seconds and pauses on hover, focus, or swipe', () => {
  const ms = landing.match(/export const HERO_AUTO_MS = (\d+)/);
  assert.ok(ms, 'HERO_AUTO_MS is exported');
  const interval = Number(ms[1]);
  assert.ok(interval >= 5000 && interval <= 7000, `auto-advance is ${interval}ms`);
  assert.match(landing, /setInterval/);
  assert.match(landing, /onPointerMove/);
  assert.match(landing, /onPointerLeave/);
  assert.match(landing, /onFocusCapture/);
  assert.match(landing, /holdRef\.current/);
});

test('Laser Owner slide leads with the audience, not Receive Multiple Bids', () => {
  assert.match(landing, /audience: 'Laser Owner'/);
  assert.match(landing, /title: 'Laser Owner'/);
  assert.match(
    landing,
    /subhead: 'Shop around for the best price and the right shop\.'/
  );
  assert.doesNotMatch(landing, /Receive [Mm]ultiple [Bb]ids/);
  assert.doesNotMatch(landing, /Clinic \/ owner/);
});

test('marketplace and parts-seller shots reuse the redacted parts still', () => {
  assert.match(landing, /src: '\/landing\/parts\.webp'/);
  assert.match(landing, /src: '\/landing\/marketplace\.webp'/);
  assert.match(landing, /guest prices redacted/);
  assert.doesNotMatch(landing, /live Candela listings and prices/);
});
