import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVOICE_LIST_NEAR_EXPIRY_MS,
  invoiceListReloadSilently,
  invoiceListStatus,
  invoiceMatchesListFilter,
  invoiceStatusBadgeClass,
  invoiceStatusLabel,
  mergeInvoiceRows,
  refreshStaleInvoiceSession,
  sessionExpiresAtMs,
  sessionNeedsRefresh,
  shouldRetryEmptyInvoiceList,
  subscribeInvoiceListResume,
} from './invoice-list.ts';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '../../app/invoices/page.tsx'), 'utf8');
const initSrc = page.slice(page.indexOf('async function init'), page.indexOf('async function loadInvoices'));

test('session expiry accepts seconds, milliseconds, and ISO timestamps', () => {
  const now = Date.parse('2026-10-25T20:00:00.000Z');
  assert.equal(sessionExpiresAtMs(null), null);
  assert.equal(sessionExpiresAtMs(''), null);
  assert.equal(sessionExpiresAtMs(Math.floor(now / 1000)), now);
  assert.equal(sessionExpiresAtMs(now), now);
  assert.equal(sessionExpiresAtMs('2026-10-25T20:00:00.000Z'), now);
  assert.equal(sessionNeedsRefresh(Math.floor(now / 1000) - 5, now), true);
  assert.equal(sessionNeedsRefresh(Math.floor((now + INVOICE_LIST_NEAR_EXPIRY_MS) / 1000), now), true);
  assert.equal(sessionNeedsRefresh(Math.floor((now + INVOICE_LIST_NEAR_EXPIRY_MS + 60_000) / 1000), now), false);
  assert.equal(sessionNeedsRefresh(now + 10 * 60_000, now), false);
  assert.equal(sessionNeedsRefresh(undefined, now), true);
});

test('stale session refresh awaits the native bridge before refreshSession', async () => {
  const order: string[] = [];
  await refreshStaleInvoiceSession({
    restoreNative: async () => {
      order.push('native');
    },
    refreshSession: async () => {
      order.push('refresh');
      return { error: null };
    },
  });
  assert.deepEqual(order, ['native', 'refresh']);

  await assert.rejects(
    () =>
      refreshStaleInvoiceSession({
        restoreNative: async () => {
          throw new Error('bridge down');
        },
        refreshSession: async () => ({ error: { message: 'refresh failed' } }),
      }),
    /refresh failed/
  );
});

test('a zero-row result retries once only after a stale session', () => {
  assert.equal(
    shouldRetryEmptyInvoiceList({
      sessionWasStale: true,
      rowCount: 0,
      hadError: false,
      alreadyRetried: false,
    }),
    true
  );
  assert.equal(
    shouldRetryEmptyInvoiceList({
      sessionWasStale: true,
      rowCount: 0,
      hadError: false,
      alreadyRetried: true,
    }),
    false
  );
  assert.equal(
    shouldRetryEmptyInvoiceList({
      sessionWasStale: false,
      rowCount: 0,
      hadError: false,
      alreadyRetried: false,
    }),
    false
  );
  assert.equal(
    shouldRetryEmptyInvoiceList({
      sessionWasStale: true,
      rowCount: 0,
      hadError: true,
      alreadyRetried: false,
    }),
    false
  );
  assert.equal(
    shouldRetryEmptyInvoiceList({
      sessionWasStale: true,
      rowCount: 2,
      hadError: false,
      alreadyRetried: false,
    }),
    false
  );
});

test('invoice rows merge by id and keep the newest first', () => {
  const rows = mergeInvoiceRows([
    [
      { id: 2, created_at: '2026-10-02T00:00:00.000Z', status: 'paid' },
      { id: 1, created_at: '2026-10-03T00:00:00.000Z', status: 'sent' },
    ],
    [
      { id: 1, created_at: '2026-10-03T00:00:00.000Z', status: 'sent' },
      { id: null, created_at: '2026-10-04T00:00:00.000Z' },
      { id: 3, created_at: '2026-10-01T00:00:00.000Z', status: 'partial' },
    ],
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2, 3]
  );
});

test('Paid and Partial pills match once status is loaded, including partial', () => {
  const paid = { status: 'Paid' };
  const partial = { status: 'partial' };
  const partialLong = { status: 'partially_paid' };
  const sent = { status: 'sent' };
  assert.equal(invoiceListStatus(paid), 'paid');
  assert.equal(invoiceListStatus(partial), 'partially_paid');
  assert.equal(invoiceMatchesListFilter(paid, 'paid'), true);
  assert.equal(invoiceMatchesListFilter(partial, 'partially_paid'), true);
  assert.equal(invoiceMatchesListFilter(partialLong, 'partially_paid'), true);
  assert.equal(invoiceMatchesListFilter(partial, 'paid'), false);
  assert.equal(invoiceMatchesListFilter(sent, 'paid'), false);
  assert.equal(invoiceMatchesListFilter({ status: 'voided' }, 'void'), true);
  assert.equal(invoiceStatusLabel('partial'), 'Partial');
  assert.equal(invoiceStatusLabel('paid'), 'Paid');
  assert.match(invoiceStatusBadgeClass('paid'), /green/);
  assert.match(invoiceStatusBadgeClass('partial'), /amber/);
  assert.match(invoiceStatusBadgeClass('partially_paid'), /amber/);
});

test('resume reruns on visibility and the native resume event, after the bridge restore', async () => {
  const calls: string[] = [];
  let visibilityState = 'hidden';
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const win = {
    __tspRestoreAndroidSession: async () => {
      calls.push('native');
    },
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const stop = subscribeInvoiceListResume(() => calls.push('init'), { document: doc, window: win });
  const emit = (type: string) => {
    for (const listener of listeners.get(type) || []) listener();
  };
  emit('visibilitychange');
  visibilityState = 'visible';
  emit('visibilitychange');
  await new Promise((resolve) => setTimeout(resolve, 0));
  emit('resume');
  await new Promise((resolve) => setTimeout(resolve, 0));
  emit('focus');
  await new Promise((resolve) => setTimeout(resolve, 0));
  stop();
  emit('visibilitychange');
  emit('focus');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['native', 'init', 'native', 'init', 'native', 'init']);
});

test('focus and resume reload silently once invoices are already shown', () => {
  assert.equal(invoiceListReloadSilently(0), false);
  assert.equal(invoiceListReloadSilently(4), true);
  assert.match(page, /invoiceListReloadSilently\(rowsRef\.current\.length\)/);
  assert.match(initSrc, /const silent = Boolean\(opts\?\.silent\)/);
  assert.match(initSrc, /if \(!silent\) \{\s*setLoading\(true\)/);
  assert.match(page, /preserveOnError: silent/);
});

test('invoice list page surfaces query errors, retries, and does not block on role or timezone', () => {
  assert.doesNotMatch(page, /console\.warn\('invoices org load'/);
  assert.doesNotMatch(page, /console\.warn\('invoices mine load'/);
  assert.match(page, /Could not load invoices/);
  assert.match(page, />\s*Retry\s*</);
  assert.match(page, /sessionNeedsRefresh/);
  assert.match(page, /refreshSession/);
  assert.match(page, /__tspRestoreAndroidSession|readNativeSessionRestore/);
  assert.match(page, /subscribeInvoiceListResume/);
  assert.match(page, /shouldRetryEmptyInvoiceList/);
  assert.match(page, /invoiceMatchesListFilter/);
  assert.match(initSrc, /void getOrgRole\(/);
  assert.match(initSrc, /void resolveNumberingTimeZone\(/);
  assert.doesNotMatch(initSrc, /await getOrgRole\(/);
  assert.doesNotMatch(initSrc, /await resolveNumberingTimeZone\(/);
  const roleAt = initSrc.indexOf('void getOrgRole');
  const loadAt = initSrc.indexOf('await loadInvoices');
  assert.ok(roleAt > 0 && loadAt > roleAt);
  assert.doesNotMatch(page, /navigator\.clipboard|copyToClipboard/);
});
