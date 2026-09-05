import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANDROID_AUTH_HOST,
  ANDROID_AUTH_SCHEME,
  isTspAndroidWebView,
  normalizeAndroidSession,
  persistableAndroidSession,
  safeAndroidNextPath,
} from './android-session.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('TSP Android user agent is detected and auth callback skips in-app handoff', () => {
  assert.equal(isTspAndroidWebView('Mozilla/5.0 TSPAndroid/1.4'), true);
  assert.equal(isTspAndroidWebView('Mozilla/5.0 (Linux; Android 14) Chrome/120'), false);
  assert.equal(ANDROID_AUTH_SCHEME, 'totalservicepro');
  assert.equal(ANDROID_AUTH_HOST, 'auth-callback');

  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  assert.match(callback, /isTspAndroidWebView/);
  assert.match(callback, /totalservicepro:\/\/auth-callback/);
  const bridge = readFileSync(join(here, '../components/AndroidSessionBridge.tsx'), 'utf8');
  assert.match(bridge, /Android\.saveSession|saveSession/);
  assert.match(bridge, /getStoredSession/);
  assert.match(bridge, /clearSession/);
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
