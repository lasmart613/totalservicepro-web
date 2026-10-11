/**
 * QA (live290): right after sign-in a free user's dashboard showed no ad.
 * AdBannerGate checked the auth hint once on mount; on /login there is no token
 * yet, and sign-in moves to / client-side, so the gate never re-checked.
 * It now re-checks on every pathname change and loads AdBanner once.
 *
 * Renders the real gate in jsdom. AdBanner itself is stubbed (it needs the
 * Supabase client and nav provider); the stub counts how often it is imported.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createElement } from 'react';

const hooks = `
const STUB = 'globalThis.__adBannerImports = (globalThis.__adBannerImports || 0) + 1;'
  + 'export default function AdBanner() { return "AD-BANNER"; }';
export async function resolve(specifier, context, next) {
  if (/\\/AdBanner(\\.tsx)?$/.test(specifier) && /AdBannerGate\\.tsx$/.test(context.parentURL || '')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(STUB), shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const AUTH_KEY = 'tsp-auth-token';

async function setupDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://repairplanet.net/login',
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  // Run the idle callback right away so the test stays fast.
  (win as unknown as Record<string, unknown>).requestIdleCallback = (cb: () => void) => win.setTimeout(cb, 0);
  (win as unknown as Record<string, unknown>).cancelIdleCallback = (id: number) => win.clearTimeout(id);
  for (const [key, value] of Object.entries({
    window: win,
    self: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    localStorage: win.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return win;
}

async function settle(act: (fn: () => Promise<void>) => Promise<void>) {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

test('sign-in on /login, client-side move to /: the gate loads the banner without a full reload', async () => {
  const win = await setupDom();
  win.localStorage.removeItem(AUTH_KEY);
  (globalThis as Record<string, unknown>).__adBannerImports = 0;

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
  const { AdBannerGate } = await import('./AdBannerGate.tsx');

  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const render = (pathname: string) =>
    act(async () => {
      root.render(createElement(PathnameContext.Provider, { value: pathname }, createElement(AdBannerGate)));
    });

  try {
    // Guest on /login: no token, so no AdBanner import (guests never load it).
    await render('/login');
    await settle(act);
    assert.equal(el.textContent, '');
    assert.equal((globalThis as Record<string, unknown>).__adBannerImports, 0);

    // Sign-in stores the token, then the app routes to / client-side.
    win.localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: 'x', user: { id: 'u1' } }));
    await render('/');
    await settle(act);
    assert.equal(el.textContent, 'AD-BANNER', 'banner shows on the first page after sign-in');
    assert.equal((globalThis as Record<string, unknown>).__adBannerImports, 1);

    // Later navigations keep the same banner and do not import it again.
    await render('/manuals');
    await settle(act);
    await render('/hub');
    await settle(act);
    assert.equal(el.textContent, 'AD-BANNER');
    assert.equal((globalThis as Record<string, unknown>).__adBannerImports, 1);
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});

test('a guest navigating between public pages never loads the banner', async () => {
  const win = await setupDom();
  win.localStorage.removeItem(AUTH_KEY);
  (globalThis as Record<string, unknown>).__adBannerImports = 0;

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
  const { AdBannerGate } = await import('./AdBannerGate.tsx');

  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    for (const p of ['/', '/plans', '/login', '/signup']) {
      await act(async () => {
        root.render(createElement(PathnameContext.Provider, { value: p }, createElement(AdBannerGate)));
      });
      await settle(act);
    }
    assert.equal(el.textContent, '');
    assert.equal((globalThis as Record<string, unknown>).__adBannerImports, 0);
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});

test('gate source: re-checks on pathname, still guest-safe', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./AdBannerGate.tsx', import.meta.url), 'utf8');
  assert.match(src, /const pathname = usePathname\(\);/);
  assert.match(src, /\}, \[pathname\]\);/);
  assert.match(src, /if \(!hasBrowserAuthHint\(\)\) return;/);
  assert.doesNotMatch(src, /onAuthStateChange|getSupabaseClient/, 'no Supabase client on the guest landing');
});
