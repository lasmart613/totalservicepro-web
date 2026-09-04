import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adsenseAllowedOnHost } from './adsense-host.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('AdSense stays on production hosts and is skipped on Netlify previews', () => {
  assert.equal(adsenseAllowedOnHost('repairplanet.net'), true);
  assert.equal(adsenseAllowedOnHost('www.repairplanet.net'), true);
  assert.equal(adsenseAllowedOnHost('totalservicepro.netlify.app'), true);
  assert.equal(adsenseAllowedOnHost('deploy-preview-90--totalservicepro.netlify.app'), false);
  assert.equal(adsenseAllowedOnHost('abc123--totalservicepro.netlify.app'), false);
  assert.equal(adsenseAllowedOnHost(''), true);
});

test('root layout does not inject AdSense on every marketing hit', () => {
  const layout = readFileSync(join(here, '../app/layout.tsx'), 'utf8');
  const gate = readFileSync(join(here, '../components/AdBannerGate.tsx'), 'utf8');
  const banner = readFileSync(join(here, '../components/AdBanner.tsx'), 'utf8');
  assert.match(layout, /AdBannerGate/);
  assert.doesNotMatch(layout, /pagead2\.googlesyndication\.com/);
  assert.match(gate, /hasBrowserAuthHint/);
  assert.match(gate, /adsenseAllowedOnHost/);
  assert.match(gate, /requestIdleCallback/);
  assert.match(banner, /lazyOnload/);
  assert.match(banner, /adsenseAllowedOnHost/);
});
