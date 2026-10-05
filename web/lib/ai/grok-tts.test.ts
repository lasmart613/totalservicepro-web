import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dailyLimitMessage,
  dailyVoiceLimit,
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE_ID,
  effectiveTier,
  MAX_TTS_CHARS,
  parseTtsBody,
  redactSecrets,
  TTS_REQUESTS_PER_MINUTE,
  VOICE_DAILY_LIMITS,
} from '../../../supabase/functions/grok-tts/contract.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fn = readFileSync(join(here, '../../../supabase/functions/grok-tts/index.ts'), 'utf8');
const assistant = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');

test('daily voice limits match grok-assistant', () => {
  assert.equal(VOICE_DAILY_LIMITS.free, 1);
  assert.equal(VOICE_DAILY_LIMITS.premium, 10);
  assert.equal(VOICE_DAILY_LIMITS.team, 10);
  assert.equal(VOICE_DAILY_LIMITS.enterprise, 10);
  assert.match(assistant, /free:\s*\{\s*text:\s*5,\s*voice:\s*1\s*\}/);
  assert.match(assistant, /premium:\s*\{\s*text:\s*50,\s*voice:\s*10\s*\}/);
  assert.equal(dailyVoiceLimit('premium'), 10);
  assert.equal(dailyVoiceLimit('unknown'), 1);
  assert.equal(dailyLimitMessage('free', 1), 'Free limit: 1 voice/day.');
  assert.equal(dailyLimitMessage('premium', 10), 'Daily voice limit: 10/day.');
});

test('expired or inactive subscriptions fall back to the free voice tier', () => {
  assert.equal(effectiveTier({ status: 'active', tier: 'premium', expires_at: '2099-01-01T00:00:00.000Z' }), 'premium');
  assert.equal(effectiveTier({ status: 'active', tier: 'premium', expires_at: '2000-01-01T00:00:00.000Z' }), 'free');
  assert.equal(effectiveTier({ status: 'canceled', tier: 'premium' }), 'free');
  assert.equal(effectiveTier(null), 'free');
});

test('parse accepts the mobile body and applies eve / en defaults', () => {
  const ok = parseTtsBody({ text: 'Check the simmer pot.', voice_id: 'ara', language: 'en' });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.text, 'Check the simmer pot.');
  assert.equal(ok.value.voiceId, 'ara');
  assert.equal(ok.value.language, 'en');

  const defaults = parseTtsBody({ text: 'Hello' });
  assert.equal(defaults.ok, true);
  if (!defaults.ok) return;
  assert.equal(defaults.value.voiceId, DEFAULT_VOICE_ID);
  assert.equal(defaults.value.language, DEFAULT_LANGUAGE);
  assert.equal(DEFAULT_VOICE_ID, 'eve');
  assert.equal(DEFAULT_LANGUAGE, 'en');

  const alias = parseTtsBody({ text: 'Hello', voiceId: 'sage' });
  assert.equal(alias.ok, true);
  if (!alias.ok) return;
  assert.equal(alias.value.voiceId, 'sage');

  const regional = parseTtsBody({ text: 'Hola', language: 'es-MX' });
  assert.equal(regional.ok, true);
  if (!regional.ok) return;
  assert.equal(regional.value.language, 'es-MX');

  const auto = parseTtsBody({ text: 'Hi', language: 'auto' });
  assert.equal(auto.ok, true);
});

test('rejects missing text, over-long text, and bad voice or language', () => {
  const missing = parseTtsBody({ text: '   ' });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error.status, 400);
  assert.equal(missing.error.body.error, 'Missing text');

  const long = parseTtsBody({ text: 'a'.repeat(MAX_TTS_CHARS + 1) });
  assert.equal(long.ok, false);
  if (long.ok) return;
  assert.equal(long.error.body.error, 'text_too_long');
  assert.equal(long.error.body.max_characters, 4000);
  assert.equal(long.error.body.length, 4001);

  const cap = parseTtsBody({ text: 'a'.repeat(MAX_TTS_CHARS) });
  assert.equal(cap.ok, true);

  const voice = parseTtsBody({ text: 'Hi', voice_id: 'eve!' });
  assert.equal(voice.ok, false);
  if (voice.ok) return;
  assert.equal(voice.error.body.error, 'invalid_voice_id');

  const language = parseTtsBody({ text: 'Hi', language: 'english' });
  assert.equal(language.ok, false);
  if (language.ok) return;
  assert.equal(language.error.body.error, 'invalid_language');

  const junk = parseTtsBody(null);
  assert.equal(junk.ok, false);
});

test('redacts the xAI key before any upstream detail is returned', () => {
  const secret = 'xai-secret-value-should-not-leak';
  const out = redactSecrets(`bad request ${secret} and sk-abcdefghijklmnopqrstuvwxyz`, secret);
  assert.equal(out.includes(secret), false);
  assert.equal(out.includes('sk-abcdefghijklmnopqrstuvwxyz'), false);
  assert.match(out, /\[redacted\]/);
});

test('grok-tts uses the same JWT check and never returns the xAI key', () => {
  assert.match(fn, /supabaseAuth\.auth\.getUser\(\)/);
  assert.match(fn, /Authorization: `Bearer \$\{userToken\}`/);
  assert.match(fn, /error: 'No auth'/);
  assert.match(fn, /error: 'Unauthorized'/);
  assert.match(fn, /Deno\.env\.get\('XAI_API_KEY'\)/);
  assert.match(fn, /https:\/\/api\.x\.ai\/v1\/tts'/);
  assert.match(fn, /https:\/\/api\.x\.ai\/v1\/tts\/voices'/);
  assert.match(fn, /'Content-Type': 'audio\/mpeg'/);
  assert.match(fn, /request_type: requestType/);
  assert.match(fn, /TTS_REQUESTS_PER_MINUTE/);
  assert.match(fn, /daily_limit_reached/);
  assert.match(fn, /rate_limited/);
  assert.equal(TTS_REQUESTS_PER_MINUTE, 8);
  assert.doesNotMatch(fn, /xai-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}/);
  assert.match(fn, /redactSecrets/);
  assert.match(fn, /--no-verify-jwt/);
});
