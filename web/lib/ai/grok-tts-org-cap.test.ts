/** grok-tts daily voice cap follows the org plan like grok-assistant (effectiveAiTier). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveAiTier } from '../../../supabase/functions/_shared/repair-ai.ts';
import * as assistantAccess from '../../../supabase/functions/grok-assistant/ai-access.ts';
import { dailyVoiceLimit } from '../../../supabase/functions/grok-tts/contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const tts = readFileSync(join(here, '../../../supabase/functions/grok-tts/index.ts'), 'utf8');
const now = new Date('2026-10-15T12:00:00Z');

test('org plan lifts the voice cap; the higher tier wins', () => {
  const premiumOrg = { type: 'service_company', is_premium: true, subscription_tier: 'premium', plan: 'premium' };
  assert.equal(dailyVoiceLimit(effectiveAiTier('free', premiumOrg, now)), 50);
  assert.equal(dailyVoiceLimit(effectiveAiTier('free', { type: 'service_company' }, now)), 5);
  assert.equal(dailyVoiceLimit(effectiveAiTier('premium', { type: 'service_company' }, now)), 50);
  assert.equal(effectiveAiTier('free', { is_premium: true, premium_until: '2026-10-01T00:00:00Z' }, now), 'free', 'expired comp');
  assert.equal(effectiveAiTier('premium', { subscription_tier: 'team' }, now), 'team');
});

test('grok-assistant uses the same shared tier helper', () => {
  assert.equal(assistantAccess.effectiveAiTier, effectiveAiTier);
});

test('grok-tts source: cap tier = effectiveAiTier(user tier, gate caller org); no-row is free', () => {
  assert.match(tts, /const tier = effectiveAiTier\(userTier, aiCaller\.org\)/);
  assert.match(tts, /const limit = dailyVoiceLimit\(tier\)/);
  assert.match(tts, /from\('subscriptions'\)[^\n]*\.maybeSingle\(\)/);
  assert.ok(tts.indexOf('const aiCaller = await loadAiCaller(db, uid)') < tts.indexOf('effectiveAiTier(userTier'));
});
