import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_CHANNEL, APP_VERSION, versionLabel } from './app-version.ts';

test('product version is the live-customer beta line', () => {
  assert.equal(APP_VERSION, '0.4.0-beta');
  assert.equal(APP_CHANNEL, 'beta');
  assert.equal(versionLabel(), '0.4.0-beta');
});
