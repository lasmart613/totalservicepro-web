import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANDING_WARM_FALLBACK_MS,
  decodeLandingImages,
  LANDING_WARM_IDLE_TIMEOUT_MS,
  landingImgLoading,
  scheduleAfterLoadIdle,
} from './landing-warm.ts';

const here = dirname(fileURLToPath(import.meta.url));

function fakeWindow(readyState: string, withIdle: boolean) {
  const listeners = new Set<() => void>();
  const idle: { cb: () => void; opts?: { timeout: number } }[] = [];
  const timers: { cb: () => void; ms: number }[] = [];
  const cancelledIdle: unknown[] = [];
  const win = {
    document: { readyState },
    addEventListener: (_t: 'load', cb: () => void) => listeners.add(cb),
    removeEventListener: (_t: 'load', cb: () => void) => listeners.delete(cb),
    setTimeout: (cb: () => void, ms: number) => {
      timers.push({ cb, ms });
      return timers.length;
    },
    clearTimeout: () => {},
    ...(withIdle
      ? {
          requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => {
            idle.push({ cb, opts });
            return idle.length;
          },
          cancelIdleCallback: (id: unknown) => cancelledIdle.push(id),
        }
      : {}),
  };
  return { win, listeners, idle, timers, cancelledIdle, load: () => [...listeners].forEach((l) => l()) };
}

test('waits for load, then one idle slot, then fires once', () => {
  const f = fakeWindow('loading', true);
  let n = 0;
  scheduleAfterLoadIdle(f.win, () => n++);
  assert.equal(f.idle.length, 0);
  assert.equal(f.listeners.size, 1);
  f.load();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.idle.length, 1);
  assert.equal(f.idle[0].opts?.timeout, LANDING_WARM_IDLE_TIMEOUT_MS);
  assert.equal(n, 0);
  f.idle[0].cb();
  assert.equal(n, 1);
});

test('already loaded goes straight to idle; Safari falls back to a timeout', () => {
  const a = fakeWindow('complete', true);
  scheduleAfterLoadIdle(a.win, () => {});
  assert.equal(a.listeners.size, 0);
  assert.equal(a.idle.length, 1);

  const b = fakeWindow('complete', false);
  let n = 0;
  scheduleAfterLoadIdle(b.win, () => n++);
  assert.equal(b.timers.length, 1);
  assert.equal(b.timers[0].ms, LANDING_WARM_FALLBACK_MS);
  b.timers[0].cb();
  assert.equal(n, 1);
});

test('cancel (unmount) before or after load never fires', () => {
  const a = fakeWindow('loading', true);
  let n = 0;
  scheduleAfterLoadIdle(a.win, () => n++)();
  assert.equal(a.listeners.size, 0);
  a.load();
  assert.equal(a.idle.length, 0);

  const b = fakeWindow('complete', true);
  const cancel = scheduleAfterLoadIdle(b.win, () => n++);
  cancel();
  assert.deepEqual(b.cancelledIdle, [1]);
  b.idle[0].cb();
  assert.equal(n, 0);
});

test('landing stills are lazy until warm, eager when priority or warm', () => {
  assert.equal(landingImgLoading(false, false), 'lazy');
  assert.equal(landingImgLoading(undefined, false), 'lazy');
  assert.equal(landingImgLoading(true, false), 'eager');
  assert.equal(landingImgLoading(false, true), 'eager');
});

test('landing page wires warm into every still and hero slide', () => {
  const src = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  assert.ok(!/loading="lazy"/.test(src), 'no hard-coded lazy img left on the landing');
  assert.ok(src.includes('mount={warm || visited.has(idx)}'), 'hero slides mount once warm');
  assert.equal((src.match(/warm=\{warm\}/g) || []).length, 11, '8 gallery + 1 role + 1 hero Shot + HeroCarousel');
});

test('owner signup server-renders the form: no useSearchParams, no loading fallback', () => {
  const src = readFileSync(join(here, '../app/signup/owner/page.tsx'), 'utf8');
  assert.ok(!/\buseSearchParams\b/.test(src));
  assert.ok(src.includes("new URLSearchParams(window.location.search)"));
  for (const q of ["'company'", "'email'", "'claim'"]) assert.ok(src.includes(`searchParams.get(${q})`), q);
  assert.ok(!src.includes("t('Loading sign up…')"), 'no loading fallback in front of the form');
});

test('decodeLandingImages decodes every img and swallows decode failures', async () => {
  let ok = 0;
  const imgs = [
    { decode: async () => { ok++; } },
    { decode: () => Promise.reject(new Error('broken')) },
    {},
  ];
  const n = decodeLandingImages({ querySelectorAll: (sel: string) => (sel === 'img' ? imgs : []) });
  assert.equal(n, 3);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ok, 1);
  assert.equal(decodeLandingImages(null), 0);
});
