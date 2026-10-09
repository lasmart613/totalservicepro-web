import assert from 'node:assert/strict';
import test from 'node:test';
import { safeAndroidNextPath } from './android-session.ts';
import { safeConnectNext } from './billing/stripe-connect.ts';
import { safeNextPath } from './login-next.ts';
import { safeAuthEmailRedirect, safeRedirectPath } from './safe-redirect.ts';

const ORIGIN = 'https://repairplanet.net';

test('unsafe next values fall back and internal paths pass through', () => {
  const rejected = [
    '/\\evil.example',
    '%2F%5Cevil.example',
    '/\\/evil.example',
    '/%09/evil.example',
    '/%0a/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '\t',
    '\n',
    '//evil.example',
    '%2F%2Fevil.example',
    '%252F%255Cevil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '',
    null,
  ];
  for (const raw of rejected) {
    assert.equal(safeRedirectPath(raw, ORIGIN), '/hub', `rejected ${JSON.stringify(raw)}`);
  }
  assert.equal(safeRedirectPath('%', ORIGIN), '/hub');
  assert.equal(safeRedirectPath('/\\evil.example', ORIGIN, '/login'), '/login');
  assert.equal(safeRedirectPath('/hub?x=1#y', ORIGIN), '/hub?x=1#y');
  assert.equal(safeRedirectPath('/onboarding/member', ORIGIN), '/onboarding/member');
});

test('login, android, connect, and email redirects use the shared helper', () => {
  assert.equal(safeNextPath('/\\evil.example'), '/');
  assert.equal(safeNextPath('/onboarding/member'), '/onboarding/member');
  assert.equal(safeNextPath('/%09/evil.example', '/hub'), '/hub');
  assert.equal(safeAndroidNextPath('/\\evil.example'), '/');
  assert.equal(safeAndroidNextPath('/manuals'), '/manuals');
  assert.equal(safeConnectNext('/\\evil.example'), '/company');
  assert.equal(safeConnectNext('/%0a/company'), '/company');
  assert.equal(safeConnectNext('/marketplace/parts/abc'), '/marketplace/parts/abc');

  const fallback = `${ORIGIN}/auth/callback?next=%2Fonboarding`;
  assert.equal(
    safeAuthEmailRedirect('https://evil.example/phish', ORIGIN, fallback),
    fallback
  );
  assert.equal(
    safeAuthEmailRedirect(
      `${ORIGIN}/auth/callback?next=${encodeURIComponent('/\\evil.example')}`,
      ORIGIN,
      fallback
    ),
    `${ORIGIN}/auth/callback?next=%2Fonboarding`
  );
  const ok = `${ORIGIN}/auth/callback?next=%2Fmy-lasers`;
  assert.equal(safeAuthEmailRedirect(ok, ORIGIN, fallback), ok);
});
