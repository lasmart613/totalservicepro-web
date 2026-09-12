import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicAuthMessage } from './auth-errors.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('Google token-exchange failure does not show the provider auth code', () => {
  const live = 'Unable to exchange external code: 4/0AeanBoXXXXXXXX';
  const msg = publicAuthMessage(live);
  assert.match(msg, /Google sign-in is temporarily unavailable/);
  assert.match(msg, /email and password/);
  assert.doesNotMatch(msg, /4\/0A/);
  assert.doesNotMatch(msg, /exchange external code/);
});

test('invalid Google client secret maps to the same user-safe copy', () => {
  const msg = publicAuthMessage(
    'oauth2: "invalid_client" "The provided client secret is invalid."'
  );
  assert.match(msg, /Google sign-in is temporarily unavailable/);
});

test('does not leak Supabase project URLs or JWTs', () => {
  assert.equal(
    publicAuthMessage('https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/callback'),
    'Sign-in failed. Please try again.'
  );
  assert.equal(
    publicAuthMessage('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaaaaaaaaaa'),
    'Sign-in failed. Please try again.'
  );
});

test('ordinary auth errors stay readable', () => {
  assert.equal(publicAuthMessage('Invalid login credentials'), 'Invalid login credentials');
  assert.equal(publicAuthMessage(''), 'Sign-in failed. Please try again.');
});

test('login and callback use the shared sanitizer', () => {
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(login, /publicAuthMessage/);
  assert.match(callback, /publicAuthMessage/);
  assert.doesNotMatch(callback, /function publicAuthMessage/);
});
