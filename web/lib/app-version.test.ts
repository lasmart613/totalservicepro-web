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

test('Android gradle version is bumped past 1.3 / 4 and loads production', () => {
  const gradle = readFileSync(join(here, '../../app/build.gradle'), 'utf8');
  assert.match(gradle, /versionCode\s+5/);
  assert.match(gradle, /versionName\s+"1\.4"/);
  assert.doesNotMatch(gradle, /play-services-ads/);
  const main = readFileSync(join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'), 'utf8');
  assert.match(main, /https:\/\/repairplanet\.net/);
  assert.match(main, /PRODUCTION_ORIGIN/);
  assert.match(main, /TSPAndroid\/1\.4/);
  assert.match(main, /totalservicepro:\/\//);
  assert.match(main, /__tspRestoreAndroidSession/);
  assert.doesNotMatch(main, /MobileAds|AdView|play-services-ads/);
  const manifest = readFileSync(join(here, '../../app/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /gms\.ads|ca-app-pub-/);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(manifest, /android:scheme="totalservicepro"/);
  assert.match(manifest, /android:host="repairplanet\.net"/);
  const assets = readFileSync(join(here, '../../app/src/main/assets/app-version.js'), 'utf8');
  assert.match(assets, /1\.4/);
  assert.match(assets, /\b5\b/);
});

test('bundled manuals stay in-app with VBeam OP vs Perfecta and find', () => {
  const library = readFileSync(join(here, '../../app/src/main/assets/manual_library.html'), 'utf8');
  const list = readFileSync(join(here, '../../app/src/main/assets/service_manuals.html'), 'utf8');
  const viewer = readFileSync(join(here, '../../app/src/main/assets/pdf_viewer.html'), 'utf8');
  assert.match(library, /isBareVbeamOperatorTitle/);
  assert.match(library, /op-badge/);
  assert.match(library, /inc-badge/);
  assert.match(library, /Incomplete/);
  assert.match(library, /isDornierHolmium/);
  assert.match(library, /Operator's Manual/);
  assert.match(library, /currentRoom/);
  assert.match(library, /lithotriptor/);
  assert.match(library, /tspLoadServiceAccess|service-company-gate/);
  assert.match(list, /pdf_viewer\.html/);
  assert.match(list, /tspLoadServiceAccess|service-company-gate/);
  assert.doesNotMatch(list, /DEV MODE/);
  assert.doesNotMatch(list, /createSignedUrl/);
  assert.match(viewer, /Find in manual/);
  assert.match(viewer, /findNext|findPrev/);
  assert.match(viewer, /tspLoadServiceAccess|service-company-gate/);
  assert.doesNotMatch(viewer, /download.*manual|saveAs/i);
  const gate = readFileSync(join(here, '../../app/src/main/assets/service-company-gate.js'), 'utf8');
  assert.match(gate, /tspCanAccessServiceManuals/);
  assert.match(gate, /tspCanAccessRepairAi/);
  const ai = readFileSync(join(here, '../../app/src/main/assets/ai_assistant.html'), 'utf8');
  assert.match(ai, /Service Company only/);
  assert.match(ai, /tspLoadServiceAccess/);
});
