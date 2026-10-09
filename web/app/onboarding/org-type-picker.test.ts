/**
 * The org-type step used to crash onboarding: `.map(t => …)` shadowed useT(),
 * so `t('Click to select')` threw "t is not a function" (minified: "e is not a function").
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';

test('onboarding org-type picker renders choices without throwing', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://repairplanet.net/onboarding',
    pretendToBeVisual: true,
  });
  const win = dom.window;

  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Node', { value: win.Node, configurable: true });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
  const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js');
  const { SiteLocaleProvider } = await import('../../lib/fa/locale.tsx');
  const { OrgTypeStep } = await import('./org-type-step.tsx');

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

  try {
    await act(async () => {
      root.render(
        createElement(
          AppRouterContext.Provider,
          { value: router },
          createElement(
            PathnameContext.Provider,
            { value: '/onboarding' },
            createElement(
              SiteLocaleProvider,
              null,
              createElement(OrgTypeStep, { selected: null, onSelect() {} }),
            ),
          ),
        ),
      );
    });

    const text = rootEl.textContent || '';
    assert.match(text, /Confirm your organization type/);
    assert.match(text, /Repair company/);
    assert.match(text, /Laser Owner \(Clinic \/ Rental \/ Reseller\)/);
    assert.match(text, /Parts Supplier/);
    assert.match(text, /Click to select/);
    assert.equal(rootEl.querySelectorAll('button').length, 3);
  } finally {
    await act(async () => {
      root.unmount();
    });
    win.close();
  }
});
