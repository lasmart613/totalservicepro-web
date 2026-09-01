import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CHANNEL, APP_VERSION, versionLabel } from './app-version.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('product version is the live-customer beta line', () => {
  assert.equal(APP_VERSION, '0.4.0-beta');
  assert.equal(APP_CHANNEL, 'beta');
  assert.equal(versionLabel(), '0.4.0-beta');
});

test('Android gradle version is bumped past 1.2 / 3 and loads production', () => {
  const gradle = readFileSync(join(here, '../../app/build.gradle'), 'utf8');
  assert.match(gradle, /versionCode\s+4/);
  assert.match(gradle, /versionName\s+"1\.3"/);
  assert.doesNotMatch(gradle, /play-services-ads/);
  const main = readFileSync(join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'), 'utf8');
  assert.match(main, /https:\/\/repairplanet\.net/);
  assert.match(main, /PRODUCTION_ORIGIN/);
  assert.doesNotMatch(main, /MobileAds|AdView|play-services-ads/);
  const manifest = readFileSync(join(here, '../../app/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /gms\.ads|ca-app-pub-/);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  const assets = readFileSync(join(here, '../../app/src/main/assets/app-version.js'), 'utf8');
  assert.match(assets, /1\.3/);
  assert.match(assets, /\b4\b/);
});

test('bundled manuals stay in-app with VBeam OP vs Perfecta and find', () => {
  const library = readFileSync(join(here, '../../app/src/main/assets/manual_library.html'), 'utf8');
  const list = readFileSync(join(here, '../../app/src/main/assets/service_manuals.html'), 'utf8');
  const viewer = readFileSync(join(here, '../../app/src/main/assets/pdf_viewer.html'), 'utf8');
  assert.match(library, /isBareVbeamOperatorTitle/);
  assert.match(library, /op-badge/);
  assert.match(library, /Operator's Manual/);
  assert.match(list, /pdf_viewer\.html/);
  assert.doesNotMatch(list, /createSignedUrl/);
  assert.match(viewer, /Find in manual/);
  assert.match(viewer, /findNext|findPrev/);
  assert.doesNotMatch(viewer, /download.*manual|saveAs/i);
});
