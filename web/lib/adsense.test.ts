import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADSENSE_CLIENT,
  ADSENSE_SCRIPT_SRC,
  ADSENSE_SLOT,
  pathHidesAds,
} from './adsense.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('keeps Larry\'s existing TSP-Web publisher and slot', () => {
  assert.equal(ADSENSE_CLIENT, 'ca-pub-5353320292042327');
  assert.equal(ADSENSE_SLOT, '8443570568');
  assert.equal(
    ADSENSE_SCRIPT_SRC,
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5353320292042327'
  );
});

test('public and auth routes hide ads so the script never mounts', () => {
  for (const hidden of [
    '/signup',
    '/signup/company',
    '/onboarding',
    '/onboarding/member',
    '/auth',
    '/auth/callback',
    '/login',
  ]) {
    assert.equal(pathHidesAds(hidden), true, hidden);
  }
  assert.equal(pathHidesAds(''), true);
  assert.equal(pathHidesAds('/'), false);
  assert.equal(pathHidesAds('/hub'), false);
  assert.equal(pathHidesAds('/company'), false);
});

test('root layout does not load adsbygoogle.js', () => {
  const layout = readFileSync(path.join(here, '../app/layout.tsx'), 'utf8');
  assert.doesNotMatch(layout, /adsbygoogle\.js/);
  assert.doesNotMatch(layout, /pagead2\.googlesyndication\.com/);
  assert.doesNotMatch(layout, /ADSENSE_CLIENT|ADSENSE_SCRIPT_SRC/);
});

test('AdBanner loads the script only after the banner renders', () => {
  const banner = readFileSync(path.join(here, '../components/AdBanner.tsx'), 'utf8');
  assert.match(banner, /if \(!showAd\) return null/);
  assert.match(banner, /ADSENSE_SCRIPT_SRC/);
  assert.match(banner, /id="tsp-adsense"/);
});
