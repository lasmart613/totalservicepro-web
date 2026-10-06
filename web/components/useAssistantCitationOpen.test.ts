/**
 * Renders the citation hook through a fresh settled answer.
 * A source-string check cannot catch a missing `onAnswerSettled` import:
 * that ReferenceError is thrown only when the effect runs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useRef } from 'react';

test('a fresh settled answer runs the hook and announces page 142', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://repairplanet.net/ai-assistant',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.innerWidth = 1280;
  const frames: FrameRequestCallback[] = [];
  win.requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  };
  win.cancelAnimationFrame = () => {};

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
  // jsdom only accepts events created in its own realm.
  globalThis.Event = win.Event;
  globalThis.CustomEvent = win.CustomEvent;

  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useAssistantCitationOpen } = await import('./useAssistantCitationOpen.ts');
  const { ANSWER_EVENT } = await import('../lib/ai/citation-auto-open.ts');

  const ts = 900142;
  const heard: Array<{
    top: { manualId: number; page: number } | null;
    citations: { manualId: number; page: number }[];
  }> = [];
  win.addEventListener(ANSWER_EVENT, (event: Event) => {
    heard.push((event as CustomEvent).detail);
  });

  type Reply = {
    role: string;
    content: string;
    citations?: { manualId: number; page: number; title?: string }[];
    ts?: number;
  };
  let markFresh: (key: string) => void = () => {};
  function Harness({ messages }: { messages: Reply[] }) {
    const listRef = useRef<HTMLDivElement | null>(null);
    const api = useAssistantCitationOpen({
      messages,
      sending: false,
      ready: true,
      manuals: [
        {
          id: 5,
          title: 'GentleMAX PRO PLUS Service Manual',
          storage_path: 'shared/gentlemax-pro-plus.pdf',
        },
      ],
      caller: { role: 'technician', orgType: 'service_company' },
      listRef,
      askAssistant: () => false,
    });
    markFresh = api.markFresh;
    return createElement('div', { ref: listRef, 'data-open': api.open ? '1' : '0' });
  }

  const answer: Reply = {
    role: 'assistant',
    content: 'See the calibration port on page 142.',
    citations: [{ manualId: 5, page: 142, title: 'GentleMAX PRO PLUS Service Manual' }],
    ts,
  };
  const rootEl = win.document.getElementById('root');
  assert.ok(rootEl);
  const root = createRoot(rootEl);
  await act(async () => {
    root.render(createElement(Harness, { messages: [] }));
  });
  await act(async () => {
    markFresh(String(ts));
    root.render(createElement(Harness, { messages: [answer] }));
  });
  await act(async () => {
    for (let i = 0; i < 6 && frames.length; i++) {
      const batch = frames.splice(0);
      for (const cb of batch) cb(Date.now());
    }
  });

  try {
    assert.equal(heard.length, 1, 'assistant:answer should fire once for the fresh reply');
    assert.equal(heard[0].top?.manualId, 5);
    assert.equal(heard[0].top?.page, 142);
    assert.equal(heard[0].citations[0].page, 142);
  } finally {
    await act(async () => {
      root.unmount();
    });
    win.close();
  }
});
