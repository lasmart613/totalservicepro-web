import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = fileURLToPath(new URL('.', import.meta.url));
const webRoot = join(here, '..');
const KEY = 'tsp-auth-token';
const URL_BASE = 'http://supabase.test';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

type Event = { what: string; tokenInStorage: boolean; auth?: string | null };

/**
 * Real supabase-js client over a fake network. Records every request in order,
 * and whether tsp-auth-token was still in localStorage when it was made.
 */
async function setup(logout: 'ok' | 'offline' | 'error500' | 'stall') {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  (globalThis as any).window = { localStorage: local, sessionStorage: session };
  const now = Math.floor(Date.now() / 1000);
  local.setItem(
    KEY,
    JSON.stringify({
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'qa@example.com' },
    })
  );
  local.setItem('tsp-pending-signup', '{"company":"Old Co"}');
  const events: Event[] = [];
  const fakeFetch = async (input: any, init: any = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const path = url.replace(URL_BASE, '').replace(/^https?:\/\/[^/]+/, '');
    events.push({ what: `${method} ${path}`, tokenInStorage: local.getItem(KEY) != null, auth: headers.get('authorization') });
    if (path.startsWith('/auth/v1/logout')) {
      if (logout === 'offline') throw new TypeError('Failed to fetch');
      if (logout === 'stall') return new Promise<Response>(() => {});
      if (logout === 'error500') return new Response('{"msg":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } });
      return new Response(null, { status: 204 });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  (globalThis as any).fetch = fakeFetch;
  const supabase = createClient(URL_BASE, 'anon', {
    auth: { persistSession: true, storageKey: KEY, storage: local as any, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch as any },
  });
  const { signOutAndClearIdentity } = await import('./auth-session.ts');
  return { supabase, local, events, signOutAndClearIdentity };
}

test('sign-out calls /auth/v1/logout (default scope) with the old token before clearing local state', async () => {
  const { supabase, local, events, signOutAndClearIdentity } = await setup('ok');
  await signOutAndClearIdentity(supabase as any);
  const logout = events.findIndex((e) => e.what.startsWith('POST /auth/v1/logout'));
  assert.ok(logout >= 0, `logout never called: ${events.map((e) => e.what).join(', ')}`);
  assert.equal(events[logout].what, 'POST /auth/v1/logout?scope=global');
  assert.equal(events[logout].auth, 'Bearer old-access');
  assert.equal(events[logout].tokenInStorage, true, 'token was cleared before the revoke');
  // Report-cookie DELETEs come after the revoke.
  const deletes = events.map((e, i) => (e.what.startsWith('DELETE ') ? i : -1)).filter((i) => i >= 0);
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every((i) => i > logout));
  assert.equal(local.getItem(KEY), null);
  assert.equal(local.getItem('tsp-pending-signup'), null);
  const { data } = await supabase.auth.getSession();
  assert.equal(data.session, null);
});

for (const mode of ['offline', 'error500'] as const) {
  test(`sign-out still clears local state when the revoke fails (${mode})`, async () => {
    const { supabase, local, events, signOutAndClearIdentity } = await setup(mode);
    await signOutAndClearIdentity(supabase as any);
    assert.ok(events.some((e) => e.what.startsWith('POST /auth/v1/logout') && e.tokenInStorage));
    assert.equal(local.getItem(KEY), null);
    assert.equal(local.getItem('tsp-pending-signup'), null);
    const { data } = await supabase.auth.getSession();
    assert.equal(data.session, null);
  });
}

test('a stalled revoke times out and still clears local state', async () => {
  const { supabase, local, signOutAndClearIdentity } = await setup('stall');
  const started = Date.now();
  await signOutAndClearIdentity(supabase as any, { revokeTimeoutMs: 50 });
  assert.ok(Date.now() - started < 2000);
  assert.equal(local.getItem(KEY), null);
});

test('helper order: signOut() first, then the local clear; no scope override', () => {
  const src = readFileSync(join(here, 'auth-session.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function signOutAndClearIdentity'), src.indexOf('export async function prepareFreshSignup'));
  const signOut = fn.indexOf('supabase.auth.signOut()');
  assert.ok(signOut > 0);
  assert.ok(fn.indexOf('clearBrowserIdentityArtifacts()') > signOut, 'local clear after signOut');
  assert.equal((fn.match(/clearBrowserIdentityArtifacts\(\)/g) || []).length, 1, 'no clear before the revoke');
  assert.doesNotMatch(fn, /\.auth\.signOut\(\{/);
  assert.ok(fn.indexOf("method: 'DELETE'") > signOut);
});

test('Header: revoke, then nav.clear(), then redirect to /login', () => {
  const header = readFileSync(join(webRoot, 'components/Header.tsx'), 'utf8');
  const fn = header.slice(header.indexOf('const handleLogout'), header.indexOf('const closeMobileMenu'));
  const revoke = fn.indexOf('await signOutAndClearIdentity(supabase)');
  const clear = fn.indexOf('nav.clear()');
  const redirect = fn.indexOf("window.location.replace('/login')");
  assert.ok(revoke > 0 && clear > revoke && redirect > clear, fn);
});

test('Settings sign-out awaits the revoke before redirecting', () => {
  const settings = readFileSync(join(webRoot, 'app/settings/page.tsx'), 'utf8');
  assert.match(settings, /await signOutAndClearIdentity\(s\); window\.location\.href = '\/login';/);
});

test('every sign-out goes through signOutAndClearIdentity', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', 'out', 'build', 'dist'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mjs|js)$/.test(name) && !/\.test\./.test(name)) {
        const rel = relative(webRoot, p);
        if (rel === join('lib', 'auth-session.ts')) continue;
        if (/\.auth\.signOut\(/.test(readFileSync(p, 'utf8'))) offenders.push(rel);
      }
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(join(webRoot, d));
  assert.deepEqual(offenders, []);
});
