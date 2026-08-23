import assert from 'node:assert/strict';
import test from 'node:test';
import { PREMIUM_MANUALS_LINE, TEAM_MANUALS_LINE, WEEKLY_UPDATES_LINE } from './plan-tiles.ts';

test('weekly updates perk is one shared phrase', () => {
  assert.equal(WEEKLY_UPDATES_LINE, 'New features added weekly');
});

test('manual entitlements stay Premium 15 and Team 50', () => {
  assert.equal(PREMIUM_MANUALS_LINE, '15 service manuals');
  assert.equal(TEAM_MANUALS_LINE, '50 service manuals');
  assert.doesNotMatch(TEAM_MANUALS_LINE, /unlimited/i);
});
