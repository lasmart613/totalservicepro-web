import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FREE_AI_DAILY,
  PREMIUM_AI_DAILY,
  TEAM_AI_DAILY,
  aiDailyLimitsForOrg,
  dailyLimitMessage,
  isDailyLimitReached,
  utcDayStartIso,
} from './daily-quota.ts';

test('Free is 5 text and 5 voice per team member', () => {
  assert.deepEqual(FREE_AI_DAILY, { text: 5, voice: 5 });
  assert.deepEqual(aiDailyLimitsForOrg(null), { text: 5, voice: 5, tier: 'free' });
  assert.deepEqual(aiDailyLimitsForOrg({ plan: 'pro' }), { text: 5, voice: 5, tier: 'free' });
  assert.deepEqual(aiDailyLimitsForOrg({ is_premium: false }), { text: 5, voice: 5, tier: 'free' });
});

test('Premium is 50 text and 50 voice per team member', () => {
  assert.deepEqual(PREMIUM_AI_DAILY, { text: 50, voice: 50 });
  assert.deepEqual(aiDailyLimitsForOrg({ plan: 'premium' }), { text: 50, voice: 50, tier: 'premium' });
  assert.deepEqual(aiDailyLimitsForOrg({ is_premium: true }), { text: 50, voice: 50, tier: 'premium' });
});

test('Team is 250 text and 250 voice per team member', () => {
  assert.deepEqual(TEAM_AI_DAILY, { text: 250, voice: 250 });
  assert.deepEqual(aiDailyLimitsForOrg({ plan: 'team' }), { text: 250, voice: 250, tier: 'team' });
  assert.deepEqual(aiDailyLimitsForOrg({ subscription_tier: 'enterprise' }), {
    text: 250,
    voice: 250,
    tier: 'team',
  });
});

test('UTC day start is midnight UTC of the given instant', () => {
  const d = new Date('2026-08-23T15:04:05.000Z');
  assert.equal(utcDayStartIso(d), '2026-08-23T00:00:00.000Z');
});

test('limit is reached at equality, not only past it', () => {
  assert.equal(isDailyLimitReached(4, 5), false);
  assert.equal(isDailyLimitReached(5, 5), true);
  assert.equal(isDailyLimitReached(6, 5), true);
  assert.match(dailyLimitMessage('text', 5, 5), /Daily text limit reached \(5\/5\)/);
});
