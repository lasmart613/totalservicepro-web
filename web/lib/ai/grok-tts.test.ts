import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dailyLimitMessage,
  dailyVoiceLimit,
  ALLOWED_VOICE_IDS,
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE_ID,
  filterListedVoices,
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
  assert.equal(VOICE_DAILY_LIMITS.free, 5);
  assert.equal(VOICE_DAILY_LIMITS.premium, 50);
  assert.equal(VOICE_DAILY_LIMITS.team, 50);
  assert.equal(VOICE_DAILY_LIMITS.enterprise, 50);
  assert.match(assistant, /free:\s*\{\s*text:\s*5,\s*voice:\s*5\s*\}/);
  assert.match(assistant, /premium:\s*\{\s*text:\s*50,\s*voice:\s*50\s*\}/);
  assert.match(assistant, /team:\s*\{\s*text:\s*50,\s*voice:\s*50\s*\}/);
  assert.match(assistant, /enterprise:\s*\{\s*text:\s*50,\s*voice:\s*50\s*\}/);
  assert.equal(dailyVoiceLimit('premium'), 50);
  assert.equal(dailyVoiceLimit('unknown'), 5);
  assert.equal(dailyLimitMessage('free', 5), 'Free limit: 5 voice/day.');
  assert.equal(dailyLimitMessage('premium', 50), 'Daily voice limit: 50/day.');
});

test('expired or inactive subscriptions fall back to the free voice tier', () => {
  assert.equal(effectiveTier({ status: 'active', tier: 'premium', expires_at: '2099-01-01T00:00:00.000Z' }), 'premium');
  assert.equal(effectiveTier({ status: 'active', tier: 'premium', expires_at: '2000-01-01T00:00:00.000Z' }), 'free');
  assert.equal(effectiveTier({ status: 'canceled', tier: 'premium' }), 'free');
  assert.equal(effectiveTier(null), 'free');
});

const DOCUMENTED_XAI_TTS_VOICES = [
  'carina',
  'zagan',
  'helix',
  'orion',
  'luna',
  'iris',
  'altair',
  'zenith',
  'perseus',
  'helios',
  'lux',
  'kepler',
  'rigel',
  'cosmo',
  'celeste',
  'ursa',
  'sirius',
  'lumen',
  'castor',
  'naksh',
  'atlas',
  'aurora',
  'liora',
  'ara',
  'eve',
  'leo',
  'rex',
  'sal',
];

test('default voice is eve and every allowed voice matches the xAI docs list', () => {
  assert.equal(DEFAULT_VOICE_ID, 'eve');
  assert.ok(ALLOWED_VOICE_IDS.includes(DEFAULT_VOICE_ID));
  assert.deepEqual([...ALLOWED_VOICE_IDS], DOCUMENTED_XAI_TTS_VOICES);
  assert.equal(DOCUMENTED_XAI_TTS_VOICES.includes('sage' as (typeof DOCUMENTED_XAI_TTS_VOICES)[number]), false);
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
  assert.deepEqual([...ALLOWED_VOICE_IDS], DOCUMENTED_XAI_TTS_VOICES);

  for (const id of ALLOWED_VOICE_IDS) {
    const parsed = parseTtsBody({ text: 'Hello', voice_id: id.toUpperCase() });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.voiceId, id);
  }

  const alias = parseTtsBody({ text: 'Hello', voiceId: 'leo' });
  assert.equal(alias.ok, true);
  if (!alias.ok) return;
  assert.equal(alias.value.voiceId, 'leo');

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
  assert.equal(long.error.status, 413);
  assert.equal(long.error.body.error, 'text_too_long');
  assert.equal(long.error.body.max_characters, 4000);
  assert.equal(long.error.body.length, 4001);

  const cap = parseTtsBody({ text: 'a'.repeat(MAX_TTS_CHARS) });
  assert.equal(cap.ok, true);

  const sage = parseTtsBody({ text: 'Hi', voice_id: 'sage' });
  assert.equal(sage.ok, false);
  if (sage.ok) return;
  assert.equal(sage.error.status, 400);
  assert.equal(sage.error.body.error, 'invalid_voice_id');

  const voice = parseTtsBody({ text: 'Hi', voice_id: 'nova' });
  assert.equal(voice.ok, false);
  if (voice.ok) return;
  assert.equal(voice.error.status, 400);
  assert.equal(voice.error.body.error, 'invalid_voice_id');

  const language = parseTtsBody({ text: 'Hi', language: 'english' });
  assert.equal(language.ok, false);
  if (language.ok) return;
  assert.equal(language.error.body.error, 'invalid_language');

  const junk = parseTtsBody(null);
  assert.equal(junk.ok, false);
});

test('voice list drops sage and keeps documented voices', () => {
  const listed = filterListedVoices({
    voices: [
      { voice_id: 'sage', name: 'Sage' },
      { voice_id: 'Eve', name: 'Eve' },
      { voice_id: 'rex', name: 'Rex' },
      { name: 'missing id' },
    ],
  });
  assert.deepEqual(
    (listed.voices as Array<{ voice_id: string }>).map((row) => row.voice_id),
    ['Eve', 'rex']
  );
});

test('redacts the xAI key before any upstream detail is returned', () => {
  const secret = 'test-voice-key-should-not-leak';
  const shaped = ['sk', 'abcdefghijklmnopqrstuvwxyz'].join('-');
  const out = redactSecrets(`bad request ${secret} and ${shaped}`, secret);
  assert.equal(out.includes(secret), false);
  assert.equal(out.includes(shaped), false);
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
  assert.match(fn, /if \(error\)/);
  assert.match(fn, /console\.warn\('api_usage insert failed'/);
  assert.match(fn, /Could not record voice usage/);
  assert.match(fn, /json\(\s*413/);
  assert.match(fn, /error: 'text_too_long'/);
  assert.match(fn, /TTS_REQUESTS_PER_MINUTE/);
  assert.match(fn, /daily_limit_reached/);
  assert.match(fn, /rate_limited/);
  assert.equal(TTS_REQUESTS_PER_MINUTE, 8);
  assert.doesNotMatch(fn, new RegExp(`${'xai'}-[A-Za-z0-9_-]{8,}|${'sk'}-[A-Za-z0-9_-]{8,}`));
  assert.match(fn, /redactSecrets/);
  assert.match(fn, /--no-verify-jwt/);
});
