import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapAndroidHtmlPath } from './android-html-routes.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('legacy Android HTML notification links map to live Next routes', () => {
  assert.equal(mapAndroidHtmlPath('/paywall.html'), '/plans');
  assert.equal(mapAndroidHtmlPath('/user_profile.html'), '/profile');
  assert.equal(mapAndroidHtmlPath('/service_hub.html'), '/hub');
  assert.equal(mapAndroidHtmlPath('/parts_catalog.html'), '/parts');
  assert.equal(mapAndroidHtmlPath('/settings.html'), '/settings');
  assert.equal(mapAndroidHtmlPath('/coming_soon.html'), '/');
  assert.equal(mapAndroidHtmlPath('/find_a_rep.html'), '/find-a-rep');
  assert.equal(mapAndroidHtmlPath('/manual_library.html'), '/manuals');
  assert.equal(mapAndroidHtmlPath('/pdf_viewer.html'), '/manuals/view');
  assert.equal(mapAndroidHtmlPath('/ai_assistant.html'), '/ai-assistant');
  assert.equal(mapAndroidHtmlPath('/service_requests.html', '?id=9'), '/accepted-bids?id=9');
  assert.equal(mapAndroidHtmlPath('/service_requests.html?id=9'), '/accepted-bids?id=9');
  assert.equal(mapAndroidHtmlPath('/not-an-asset'), null);
});

test('Android MainActivity asset map stays aligned with web remaps', () => {
  const main = readFileSync(
    join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'),
    'utf8'
  );
  assert.match(main, /paywall.*\/plans/);
  assert.match(main, /user_profile.*\/profile/);
  assert.match(main, /service_hub.*\/hub/);
  assert.match(main, /parts_catalog.*\/parts/);
  assert.match(main, /coming_soon.*\/#app/);
  assert.match(main, /find_a_rep.*\/find-a-rep/);
});
