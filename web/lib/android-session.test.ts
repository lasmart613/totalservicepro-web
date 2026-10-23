import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_AUTH_HOST,
  ANDROID_AUTH_SCHEME,
  buildAndroidHandoff,
  googleOAuthRedirectTo,
  androidSessionIsFresh,
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

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(callback, /isTspAndroidWebView/);
  assert.match(callback, /totalservicepro:\/\/auth-callback/);
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
  assert.match(shell, /CryptoObject/);
  assert.match(shell, /deleteAllData/);
  assert.match(shell, /PREFS_CARD_DRAFTS/);
  assert.match(shell, /setAllowedAuthenticators\(BiometricManager\.Authenticators\.BIOMETRIC_STRONG\)/);
  const keystore = readFileSync(
    join(here, '../../app/src/main/java/com/photometrytools/KeystoreSessionStore.java'),
    'utf8'
  );
  assert.match(keystore, /setInvalidatedByBiometricEnrollment\(true\)/);
  assert.match(keystore, /setUserAuthenticationParameters\(0/);
  const client = readFileSync(join(here, 'supabase/client.ts'), 'utf8');
  assert.match(client, /autoRefreshToken:\s*!isTspAndroidWebView\(\)/);
  assert.match(client, /androidSessionIsFresh/);
  assert.match(shell, /removeAllCookies\(/);
  assert.match(shell, /loadDataWithBaseURL/);
  assert.match(shell, /retainDraftsForUser/);
  assert.match(shell, /clearHistory\(/);
  assert.match(shell, /BACKGROUND_LOCK_MS/);
  assert.match(shell, /getOrigins\(/);
  assert.match(shell, /FLAG_SECURE/);
  assert.match(shell, /loadUrl\("about:blank"\)/);
  assert.match(shell, /clearPlain\(\)/);
  assert.match(keystore, /session_envelope/);
  assert.match(keystore, /transientFailure/);
  assert.doesNotMatch(shell, /tsp-unlock:/);
  assert.doesNotMatch(shell, /resealBiometric/);
  assert.match(bridge, /androidSessionIsFresh/);
  assert.match(bridge, /TOKEN_REFRESHED/);
  assert.match(bridge, /INITIAL_SESSION/);
  assert.match(bridge, /if \(raw\) return applyTokens/);
  const providers = readFileSync(join(here, '../components/providers.tsx'), 'utf8');
  assert.match(providers, /AndroidSessionBridge/);
});

test('an expired Android session is not fresh enough to seed', () => {
  const now = 1_700_000_000_000;
  const fresh = androidSessionIsFresh(
    { access_token: 'a', refresh_token: 'r', expires_at: now / 1000 + 3600 },
    now
  );
  const expired = androidSessionIsFresh(
    { access_token: 'a', refresh_token: 'r', expires_at: now / 1000 + 30 },
    now
  );
  assert.equal(fresh, true);
  assert.equal(expired, false);
  assert.equal(androidSessionIsFresh({ access_token: 'a', refresh_token: 'r' }, now), false);
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

test('callback hands off only a fresh sign-in with a valid nonce', () => {
  assert.equal(
    buildAndroidHandoff({
      completedSignIn: false,
      appRequested: true,
      nonce: NONCE,
      accessToken: 'existing-access',
      refreshToken: 'existing-refresh',
      dest: '/',
    }),
    null
  );
  assert.equal(
    buildAndroidHandoff({
      completedSignIn: true,
      appRequested: true,
      nonce: 'short',
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      dest: '/hub',
    }),
    null
  );
  assert.equal(
    buildAndroidHandoff({
      completedSignIn: true,
      appRequested: true,
      nonce: '0123456789ABCDEF0123456789ABCDEF',
      accessToken: 'fresh-access',
      refreshToken: 'r',
      dest: '/',
    }),
    null
  );
  const handoff = buildAndroidHandoff({
    completedSignIn: true,
    appRequested: true,
    nonce: NONCE,
    state: 'abc',
    accessToken: 'fresh-access',
    refreshToken: 'fresh-refresh',
    dest: '/hub',
  });
  assert.ok(handoff);
  assert.match(handoff.httpsUrl, /^https:\/\/repairplanet\.net\/auth\/callback\?app=1&tsp_nonce=/);
  assert.match(handoff.httpsUrl, new RegExp(`tsp_nonce=${NONCE}`));
  assert.match(handoff.httpsUrl, /#access_token=fresh-access/);
  assert.match(handoff.httpsUrl, /state=abc/);
  assert.match(handoff.customSchemeUrl, /^totalservicepro:\/\/auth-callback#/);
  assert.match(handoff.customSchemeUrl, /tsp_nonce=/);
  const longState = 'x'.repeat(512);
  const trimmed = buildAndroidHandoff({
    completedSignIn: true,
    appRequested: true,
    nonce: NONCE,
    state: longState,
    accessToken: 'fresh-access',
    refreshToken: 'r',
    dest: '/',
  });
  assert.ok(trimmed);
  assert.doesNotMatch(trimmed.httpsUrl, /state=/);
  assert.equal(
    buildAndroidHandoff({
      completedSignIn: true,
      appRequested: true,
      nonce: NONCE,
      accessToken: 'fresh-access',
      refreshToken: 'r',
      dest: '/',
      inWebView: true,
    }),
    null
  );
});
