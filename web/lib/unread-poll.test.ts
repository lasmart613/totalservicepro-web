import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UNREAD_POLL_BACKOFF_CAP_MS,
  UNREAD_POLL_INTERVAL_MS,
  isUnreadPollBackoffError,
  isUnreadPollVisible,
  nextUnreadPollDelayMs,
  startUnreadPollLoop,
} from './unread-poll.ts';

const here = dirname(fileURLToPath(import.meta.url));

async function flush(times = 4) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function fakeLoop(poll: () => Promise<boolean>, startVisible = true) {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  let visible = startVisible;
  let visibilityCb: (() => void) | null = null;

  const stop = startUnreadPollLoop({
    poll,
    isVisible: () => visible,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    addVisibilityListener: (fn) => {
      visibilityCb = fn;
    },
    removeVisibilityListener: () => {
      visibilityCb = null;
    },
  });

  return {
    timers,
    stop,
    setVisible(next: boolean) {
      visible = next;
      visibilityCb?.();
    },
    fireNext() {
      const entry = [...timers.entries()][0];
      assert.ok(entry, 'expected an armed timer');
      timers.delete(entry[0]);
      entry[1].fn();
      return entry[1].ms;
    },
    armedMs() {
      const entry = [...timers.values()][0];
      return entry ? entry.ms : null;
    },
  };
}

test('unread poll delay doubles after failure and resets on success', () => {
  assert.equal(UNREAD_POLL_INTERVAL_MS, 45_000);
  assert.equal(UNREAD_POLL_BACKOFF_CAP_MS, 10 * 60 * 1000);

  assert.equal(nextUnreadPollDelayMs(UNREAD_POLL_INTERVAL_MS, false), UNREAD_POLL_INTERVAL_MS);
  assert.equal(nextUnreadPollDelayMs(UNREAD_POLL_INTERVAL_MS, true), 90_000);
  assert.equal(nextUnreadPollDelayMs(90_000, true), 180_000);
  assert.equal(nextUnreadPollDelayMs(180_000, true), 360_000);
  assert.equal(nextUnreadPollDelayMs(360_000, true), 600_000);
  assert.equal(nextUnreadPollDelayMs(UNREAD_POLL_BACKOFF_CAP_MS, true), UNREAD_POLL_BACKOFF_CAP_MS);
  assert.equal(nextUnreadPollDelayMs(UNREAD_POLL_BACKOFF_CAP_MS, false), UNREAD_POLL_INTERVAL_MS);
});

test('hidden tabs are not visible for unread polling', () => {
  assert.equal(isUnreadPollVisible('hidden'), false);
  assert.equal(isUnreadPollVisible('visible'), true);
  assert.equal(isUnreadPollVisible('prerender'), true);
  assert.equal(isUnreadPollVisible(undefined), true);
});

test('backoff errors are 504, timeout, and 5xx — not auth or not-found', () => {
  assert.equal(isUnreadPollBackoffError({ status: 504, message: 'Gateway Timeout' }), true);
  assert.equal(isUnreadPollBackoffError({ statusCode: 502 }), true);
  assert.equal(isUnreadPollBackoffError({ code: '503' }), true);
  assert.equal(isUnreadPollBackoffError({ message: 'FetchError: request timed out' }), true);
  assert.equal(isUnreadPollBackoffError({ name: 'AbortError', message: 'The operation was aborted' }), true);
  assert.equal(isUnreadPollBackoffError({ message: 'UND_ERR_CONNECT_TIMEOUT' }), true);
  assert.equal(isUnreadPollBackoffError(504), true);
  assert.equal(isUnreadPollBackoffError({ cause: { status: 500 } }), true);

  assert.equal(isUnreadPollBackoffError(null), false);
  assert.equal(isUnreadPollBackoffError({ status: 401, message: 'JWT expired' }), false);
  assert.equal(isUnreadPollBackoffError({ status: 404 }), false);
  assert.equal(isUnreadPollBackoffError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isUnreadPollBackoffError({ code: 'PGRST116' }), false);
  assert.equal(isUnreadPollBackoffError({ message: 'row-level security' }), false);
});

test('unread poll loop waits one interval, then polls while visible', async () => {
  const polls: string[] = [];
  const loop = fakeLoop(async () => {
    polls.push('tick');
    return false;
  });

  assert.equal(loop.armedMs(), UNREAD_POLL_INTERVAL_MS);
  assert.equal(polls.length, 0);

  loop.fireNext();
  await flush();
  assert.deepEqual(polls, ['tick']);
  assert.equal(loop.armedMs(), UNREAD_POLL_INTERVAL_MS);

  loop.stop();
  assert.equal(loop.armedMs(), null);
});

test('unread poll loop pauses while hidden and resumes when visible', async () => {
  const polls: string[] = [];
  const loop = fakeLoop(async () => {
    polls.push('tick');
    return false;
  });

  loop.setVisible(false);
  assert.equal(loop.armedMs(), null);
  assert.equal(polls.length, 0);

  loop.setVisible(true);
  await flush();
  assert.deepEqual(polls, ['tick']);
  assert.equal(loop.armedMs(), UNREAD_POLL_INTERVAL_MS);

  loop.stop();
});

test('unread poll loop does not arm when the tab starts hidden', () => {
  const loop = fakeLoop(async () => false, false);
  assert.equal(loop.armedMs(), null);
  loop.stop();
});

test('unread poll loop backs off after 5xx and resets after success', async () => {
  let failNext = true;
  const loop = fakeLoop(async () => failNext);

  loop.fireNext();
  await flush();
  assert.equal(loop.armedMs(), 90_000);

  failNext = true;
  loop.fireNext();
  await flush();
  assert.equal(loop.armedMs(), 180_000);

  failNext = false;
  loop.fireNext();
  await flush();
  assert.equal(loop.armedMs(), UNREAD_POLL_INTERVAL_MS);

  loop.stop();
});

test('Header unread poll uses visibility + backoff helpers (soft beta / no Ads)', () => {
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  assert.match(header, /startDocumentUnreadPoll/);
  assert.match(header, /isUnreadPollBackoffError/);
  assert.match(header, /from '@\/lib\/unread-poll'/);
  assert.doesNotMatch(header, /setInterval\(/);
  assert.doesNotMatch(header, /45000/);
});
