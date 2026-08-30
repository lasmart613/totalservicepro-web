import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowHomeDashboardSplash } from './home-splash.ts';

test('logged-out home first paint is marketing, not the dashboard loader', () => {
  assert.equal(shouldShowHomeDashboardSplash(true, false, false), false);
  assert.equal(shouldShowHomeDashboardSplash(true, false, true), true);
  assert.equal(shouldShowHomeDashboardSplash(true, true, false), true);
  assert.equal(shouldShowHomeDashboardSplash(false, false, false), false);
});
