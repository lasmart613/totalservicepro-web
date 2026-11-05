/**
 * Invoice new/edit/view share StripeConnectCard. A charges-enabled Connect
 * account replaces the setup button with the pay-online note. An unlinked
 * shop still gets Connect Stripe. Other pages keep the generic status.
 *
 * The live invoice form needs a signed-in shop. This renders the card against
 * a mocked connect status so we do not write a Stripe account id anywhere.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { createElement } from 'react';
import { INVOICE_STRIPE_PAY_ONLINE_MESSAGE } from '../lib/billing/invoice-connect-copy.ts';
import { appStrings } from '../lib/i18n/app-copy.ts';

const supabaseStub = `
export function getSupabaseClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
  };
}
`;

const hooks = `
export async function resolve(specifier, context, next) {
  const spec = String(specifier);
  if (
    spec === '@/lib/supabase/client' ||
    spec.endsWith('/lib/supabase/client.ts') ||
    spec.endsWith('/supabase/client.ts')
  ) {
    return {
      url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(supabaseStub))},
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(hooks));

type Status = Record<string, unknown>;

async function setupDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://repairplanet.net/invoices/new',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return win;
}

test('invoice card swaps Connect Stripe for the pay-online note when Connect can charge', async () => {
  const win = await setupDom();
  win.localStorage.setItem('siteLanguage', 'es');
  let status: Status = {
    eligible: true,
    connected: false,
    canStart: true,
    schemaReady: true,
    chargesEnabled: false,
    payoutsEnabled: false,
    hasAccount: false,
    prompt: { title: 'Connect Stripe to take card payments', message: 'Connect Stripe before you take a card payment.' },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/api/billing/stripe/connect')) throw new Error('unexpected fetch ' + url);
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
  const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
  const { SiteLocaleProvider } = await import('../lib/fa/locale.tsx');
  const { StripeConnectCard } = await import('./StripeConnectCard.tsx');

  const rootEl = win.document.getElementById('root');
  assert.ok(rootEl);
  const root = createRoot(rootEl);
  const router = {
    push() {},
    replace() {},
    prefetch() {},
    back() {},
    forward() {},
    refresh() {},
  };

  let generation = 0;
  async function show(props: { whenConnected?: 'invoice' }, path: string) {
    generation += 1;
    await act(async () => {
      root.render(
        createElement(
          AppRouterContext.Provider,
          { value: router },
          createElement(
            PathnameContext.Provider,
            { value: path },
            createElement(
              SiteLocaleProvider,
              null,
              createElement(StripeConnectCard, { ...props, key: String(generation) })
            )
          )
        )
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  }

  try {
    await show({ whenConnected: 'invoice' }, '/invoices/new');
    assert.match(rootEl.textContent || '', /Connect Stripe/);
    assert.equal(rootEl.querySelectorAll('button').length, 1);
    assert.doesNotMatch(rootEl.textContent || '', /pagar en línea/);

    status = {
      eligible: true,
      connected: true,
      canStart: true,
      schemaReady: true,
      chargesEnabled: true,
      payoutsEnabled: false,
      hasAccount: true,
      prompt: null,
    };
    await show({ whenConnected: 'invoice' }, '/invoices/new?id=1');
    const spanish = appStrings('es')[INVOICE_STRIPE_PAY_ONLINE_MESSAGE];
    assert.match(rootEl.textContent || '', /pagar en línea/);
    assert.equal((rootEl.textContent || '').includes(spanish), true);
    assert.equal(rootEl.querySelectorAll('button').length, 0);
    assert.doesNotMatch(rootEl.textContent || '', /Connect Stripe/);

    win.localStorage.setItem('siteLanguage', 'de');
    await show({ whenConnected: 'invoice' }, '/invoices/new?id=2');
    assert.match(rootEl.textContent || '', /Stripe-Konto/);
    assert.equal(rootEl.querySelectorAll('button').length, 0);

    win.localStorage.setItem('siteLanguage', 'ar');
    await show({ whenConnected: 'invoice' }, '/invoices/new?id=3');
    assert.match(rootEl.textContent || '', /[\u0600-\u06FF]/);
    assert.equal(rootEl.querySelectorAll('button').length, 0);

    win.localStorage.setItem('siteLanguage', 'en');
    await show({}, '/company');
    assert.match(rootEl.textContent || '', /Card payments go to your connected Stripe account/);
    assert.match(rootEl.textContent || '', /Bank payouts are still finishing/);
    assert.doesNotMatch(rootEl.textContent || '', /When you send this invoice/);
    assert.equal(rootEl.querySelectorAll('button').length, 0);

    status = { ...status, payoutsEnabled: true };
    await show({}, '/company?ready=1');
    assert.match(rootEl.textContent || '', /Card payments go to your connected Stripe account/);
    assert.doesNotMatch(rootEl.textContent || '', /Bank payouts are still finishing/);
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => {
      root.unmount();
    });
    win.close();
  }
});
