/**
 * Signed-in /plans crashed with "ReferenceError: t is not defined" because
 * SignedInPlans() called t(...) without `const t = useT()` (live since #213).
 * Render the real page as a signed-in free user and a signed-in Premium user.
 *
 * Only the Supabase client, the app Header and the landing shell are stubbed
 * (network, nav provider, CSS import). The plan logic, org-plan-load, locale
 * and audience selector are the real modules.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createElement } from 'react';

const STUBS: Record<string, string> = {
  '@/lib/supabase/client': `
    export function getSupabaseClient() { return globalThis.__plansTestSupabase; }
  `,
  '@/components/Header': `export function Header() { return null; }`,
  '@/components/landing/LandingShell': `export function LandingShell({ children }) { return children; }`,
};

const hooks = `
const STUBS = ${JSON.stringify(STUBS)};
export async function resolve(specifier, context, next) {
  if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
    return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hooks));

type OrgRow = Record<string, unknown>;

function fakeSupabase(org: OrgRow) {
  const reads: string[] = [];
  return {
    reads,
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null };
      },
      // No token: skip the /api/billing/upgrade/sync POST and keep the row.
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  reads.push(`${table}:${columns}`);
                  if (table === 'user_profiles') return { data: { organization_id: 42 }, error: null };
                  if (table === 'organizations') return { data: org, error: null };
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

let domReady = false;
async function setupDom() {
  if (domReady) return;
  domReady = true;
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://repairplanet.net/plans',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  for (const [key, value] of Object.entries({
    window: win,
    self: win, // next/link's idle-callback prefetch
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    localStorage: win.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
}

async function renderSignedInPlans(org: OrgRow) {
  await setupDom();
  const supabase = fakeSupabase(org);
  (globalThis as Record<string, unknown>).__plansTestSupabase = supabase;

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
  const { PathnameContext, SearchParamsContext } = await import(
    'next/dist/shared/lib/hooks-client-context.shared-runtime.js'
  );
  const { SiteLocaleProvider } = await import('../../lib/fa/locale.tsx');
  const { default: PlansPage } = await import('./page.tsx');

  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const router = { push() {}, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
  const errors: unknown[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    await act(async () => {
      root.render(
        createElement(
          AppRouterContext.Provider,
          { value: router },
          createElement(
            PathnameContext.Provider,
            { value: '/plans' },
            createElement(
              SearchParamsContext.Provider,
              { value: new URLSearchParams() },
              createElement(SiteLocaleProvider, null, createElement(PlansPage)),
            ),
          ),
        ),
      );
    });
    // Let the gate's getUser and the plan load settle.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    return { text: el.textContent || '', html: el.innerHTML, reads: supabase.reads, errors };
  } finally {
    console.error = origError;
    await act(async () => root.unmount());
    el.remove();
  }
}

test('signed-in free user: /plans renders the upgrade page without throwing', async () => {
  const { text, reads, errors } = await renderSignedInPlans({ name: 'Acme Lasers', is_premium: false });
  assert.deepEqual(errors, [], 'no React render errors (ReferenceError: t is not defined)');
  assert.match(text, /Plans and prices/, 'SignedInPlans rendered, not the public page');
  assert.match(text, /Acme Lasers is on Free\./);
  assert.match(text, /Upgrade from this page without creating a second account\./);
  assert.match(text, /Upgrade to Premium/);
  assert.match(text, /Upgrade to Team/);
  assert.match(text, /Current plan/);
  assert.ok(reads.some((r) => r.startsWith('organizations:')), 'loaded the org plan row');
});

test('signed-in Premium user: /plans shows Premium as current and offers Team', async () => {
  const { text, errors } = await renderSignedInPlans({
    name: 'Acme Lasers',
    is_premium: true,
    plan: 'premium',
    subscription_tier: 'premium',
  });
  assert.deepEqual(errors, [], 'no React render errors');
  assert.match(text, /Plans and prices/);
  assert.match(text, /Acme Lasers is on Premium\./);
  assert.match(text, /Upgrade to Team on this same account/);
  assert.doesNotMatch(text, /Upgrade to Premium/);
  assert.match(text, /Upgrade to Team/);
});
