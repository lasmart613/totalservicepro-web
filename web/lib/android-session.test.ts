import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_AUTH_HOST,
  ANDROID_AUTH_SCHEME,
  ANDROID_APP_PACKAGE,
  buildAndroidHandoff,
  googleOAuthRedirectTo,
  isOfficialAndroidAppUrl,
  isTspAndroidWebView,
  normalizeAndroidSession,
  persistableAndroidSession,
  safeAndroidNextPath,
  TSP_APP_NONCE_RE,
} from './android-session.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('TSP Android user agent is detected and auth callback skips in-app handoff', () => {
  assert.equal(isTspAndroidWebView('Mozilla/5.0 TSPAndroid/0.5.0-beta'), true);
  assert.equal(isTspAndroidWebView('Mozilla/5.0 (Linux; Android 14) Chrome/120'), false);
  assert.equal(ANDROID_AUTH_SCHEME, 'totalservicepro');
  assert.equal(ANDROID_AUTH_HOST, 'auth-callback');
  assert.equal(ANDROID_APP_PACKAGE, 'com.photometrytools');

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(callback, /isTspAndroidWebView/);
  assert.match(callback, /confirmAndroidHandoffNonce/);
  assert.match(callback, /\/api\/auth\/android-handoff/);
  assert.match(callback, /issuedForSession/);
  assert.match(callback, /isOfficialAndroidAppUrl/);
  assert.doesNotMatch(callback, /totalservicepro:\/\/auth-callback/);
  const bridge = readFileSync(join(here, '../components/AndroidSessionBridge.tsx'), 'utf8');
  assert.match(bridge, /Android\.saveSession|saveSession/);
  assert.match(bridge, /clearSession/);
  assert.match(bridge, /tspNative/);
  assert.match(bridge, /m:\s*'getStoredSession'/);
  assert.match(bridge, /__tspRestoreAndroidSession/);
  assert.doesNotMatch(bridge, /getStoredSession\s*\(/);
  const shell = readFileSync(
    join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'),
    'utf8'
  );
  assert.doesNotMatch(shell, /public String getStoredSession/);
  assert.doesNotMatch(shell, /host\.getStoredSession/);
  assert.match(shell, /"getStoredSession"/);
  assert.match(shell, /isMainFrame/);
  const providers = readFileSync(join(here, '../components/providers.tsx'), 'utf8');
  assert.match(providers, /AndroidSessionBridge/);
});

test('Android session blobs normalize to access/refresh tokens', () => {
  const raw = normalizeAndroidSession({
    access_token: 'aaa',
    refresh_token: 'bbb',
    expires_at: 99,
  });
  assert.deepEqual(raw, { access_token: 'aaa', refresh_token: 'bbb', expires_at: 99 });

  const wrapped = normalizeAndroidSession({
    currentSession: { access_token: 'ccc', refresh_token: 'ddd', expires_at: 1 },
    expiresAt: 1,
  });
  assert.equal(wrapped?.access_token, 'ccc');
  assert.match(persistableAndroidSession(wrapped!), /currentSession/);
  assert.equal(normalizeAndroidSession('not-json'), null);
  assert.equal(safeAndroidNextPath('/manuals'), '/manuals');
  assert.equal(safeAndroidNextPath('https://evil.example'), '/');
  assert.equal(safeAndroidNextPath('//evil.example'), '/');
});

const NONCE = '0123456789abcdef0123456789abcdef';

test('Google return URL carries app=1 and a 32-hex tsp_nonce', () => {
  assert.equal(TSP_APP_NONCE_RE.test(NONCE), true);
  const fromApp = googleOAuthRedirectTo(
    'https://repairplanet.net',
    '/',
    new URLSearchParams(),
    true
  );
  assert.match(fromApp, /^https:\/\/repairplanet\.net\/auth\/callback\?/);
  assert.match(fromApp, /app=1/);
  assert.match(fromApp, /next=%2F/);
  const passed = googleOAuthRedirectTo(
    'https://repairplanet.net',
    '/hub',
    new URLSearchParams(`app=1&tsp_nonce=${NONCE}`),
    false
  );
  assert.match(passed, /app=1/);
  assert.match(passed, new RegExp(`tsp_nonce=${NONCE}`));
  assert.match(passed, /next=%2Fhub/);
  const dropped = googleOAuthRedirectTo(
    'https://repairplanet.net',
    '/',
    new URLSearchParams('tsp_nonce=not-a-nonce'),
    false
  );
  assert.doesNotMatch(dropped, /tsp_nonce/);
  assert.doesNotMatch(dropped, /app=1/);
  const fromWww = googleOAuthRedirectTo(
    'https://www.repairplanet.net',
    '/',
    new URLSearchParams(),
    true
  );
  assert.match(fromWww, /^https:\/\/repairplanet\.net\/auth\/callback\?/);
  assert.doesNotMatch(fromWww, /www\.repairplanet\.net/);
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(login, /googleOAuthRedirectTo/);
});

test('callback hands off only a fresh sign-in with a nonce this session issued', () => {
  const base = {
    completedSignIn: true,
    appRequested: true,
    issuedForSession: true,
    nonce: NONCE,
    accessToken: 'fresh-access',
    refreshToken: 'fresh-refresh',
    dest: '/hub',
  };
  assert.equal(buildAndroidHandoff({ ...base, completedSignIn: false, accessToken: 'existing-access' }), null);
  assert.equal(buildAndroidHandoff({ ...base, nonce: 'short' }), null);
  assert.equal(buildAndroidHandoff({ ...base, nonce: '0123456789ABCDEF0123456789ABCDEF' }), null);
  assert.equal(buildAndroidHandoff({ ...base, issuedForSession: false }), null);
  const handoff = buildAndroidHandoff({ ...base, state: 'abc' });
  assert.ok(handoff);
  assert.match(handoff.httpsUrl, /^https:\/\/repairplanet\.net\/auth\/callback\?app=1&tsp_nonce=/);
  assert.match(handoff.httpsUrl, new RegExp(`tsp_nonce=${NONCE}`));
  assert.match(handoff.httpsUrl, /#access_token=fresh-access/);
  assert.match(handoff.httpsUrl, /state=abc/);
  assert.equal(isOfficialAndroidAppUrl(handoff.appUrl), true);
  assert.match(handoff.appUrl, /^intent:\/\/auth-callback\?/);
  assert.match(handoff.appUrl, /package=com\.photometrytools;/);
  assert.match(handoff.appUrl, /scheme=totalservicepro;/);
  assert.match(handoff.appUrl, /access_token=fresh-access/);
  assert.match(handoff.appUrl, new RegExp(`tsp_nonce=${NONCE}`));
  assert.doesNotMatch(handoff.appUrl, /totalservicepro:\/\//);
  assert.equal(isOfficialAndroidAppUrl(`totalservicepro://auth-callback#access_token=x&tsp_nonce=${NONCE}`), false);
  const longState = 'x'.repeat(512);
  const trimmed = buildAndroidHandoff({ ...base, state: longState, dest: '/' });
  assert.ok(trimmed);
  assert.doesNotMatch(trimmed.httpsUrl, /state=/);
  assert.equal(buildAndroidHandoff({ ...base, inWebView: true, dest: '/' }), null);
});
