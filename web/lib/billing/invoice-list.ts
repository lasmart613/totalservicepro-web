/**
 * Invoice list load, session refresh, and Paid / Partial pills.
 * The page keeps the Supabase calls. These helpers are what the tests pin.
 */
import { isVoidInvoiceStatus } from './void-invoice.ts';

/** Refresh before a query when the access token is inside this window. */
export const INVOICE_LIST_NEAR_EXPIRY_MS = 60_000;

export type InvoiceListFilter = 'all' | 'draft' | 'sent' | 'paid' | 'partially_paid' | 'void';

export type InvoiceListRow = {
  id?: unknown;
  status?: string | null;
  created_at?: string | null;
};

export type NativeSessionRestore = (raw?: unknown) => Promise<unknown>;

type ResumeTarget = {
  visibilityState?: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type ResumeWindow = {
  __tspRestoreAndroidSession?: NativeSessionRestore;
};

/** Supabase expires_at is unix seconds. Millisecond values and ISO strings are accepted. */
export function sessionExpiresAtMs(expiresAt: unknown): number | null {
  if (expiresAt == null || expiresAt === '') return null;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  }
  const text = String(expiresAt).trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    return n > 1e12 ? n : n * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when the stored session is missing an expiry, already expired, or inside the near-expiry window. */
export function sessionNeedsRefresh(expiresAt: unknown, nowMs: number, skewMs = INVOICE_LIST_NEAR_EXPIRY_MS): boolean {
  const expiresMs = sessionExpiresAtMs(expiresAt);
  if (expiresMs == null) return true;
  return expiresMs - nowMs <= skewMs;
}

export function readNativeSessionRestore(win: object | null | undefined): NativeSessionRestore | null {
  if (win == null || !('__tspRestoreAndroidSession' in win)) return null;
  const fn = (win as { __tspRestoreAndroidSession?: unknown }).__tspRestoreAndroidSession;
  return typeof fn === 'function' ? (fn as NativeSessionRestore) : null;
}

/** A resume/focus reload keeps the list on screen once any rows are already shown. */
export function invoiceListReloadSilently(existingRowCount: number): boolean {
  return existingRowCount > 0;
}

/**
 * Expired or near-expiry: await the Android/WebView restore when the bridge
 * installed one, then await supabase.auth.refreshSession.
 */
export async function refreshStaleInvoiceSession(input: {
  restoreNative?: NativeSessionRestore | null;
  refreshSession: () => Promise<{ error?: { message?: string } | null } | null | void>;
}): Promise<void> {
  if (typeof input.restoreNative === 'function') {
    try {
      await input.restoreNative();
    } catch {
      /* The stored native session can fail; refreshSession still runs. */
    }
  }
  const refreshed = await input.refreshSession();
  const message =
    refreshed && typeof refreshed === 'object' && refreshed.error
      ? refreshed.error.message || 'Could not refresh the session'
      : null;
  if (message) throw new Error(message);
}

/**
 * Re-run the invoice list when the tab becomes visible, when the window gains
 * focus, and when a native shell fires `resume`. The WebView session restore
 * is awaited on that transition. The page decides whether the reload is silent.
 */
export function subscribeInvoiceListResume(
  onResume: () => void,
  target?: { document?: ResumeTarget | null; window?: (ResumeWindow & Partial<ResumeTarget>) | null }
): () => void {
  const doc =
    target?.document ??
    (typeof document !== 'undefined' ? (document as unknown as ResumeTarget) : null);
  const win =
    target?.window ?? (typeof window !== 'undefined' ? (window as unknown as ResumeWindow & ResumeTarget) : null);
  if (!doc) return () => {};

  const fire = () => {
    const restore = readNativeSessionRestore(win);
    if (!restore) {
      onResume();
      return;
    }
    Promise.resolve(restore()).then(
      () => onResume(),
      () => onResume()
    );
  };
  const onVis = () => {
    if (doc.visibilityState === 'hidden') return;
    fire();
  };
  const onNativeResume = () => {
    fire();
  };
  const onFocus = () => {
    fire();
  };
  const focusTarget: ResumeTarget | null =
    win && typeof win.addEventListener === 'function' && typeof win.removeEventListener === 'function'
      ? (win as ResumeTarget)
      : null;
  doc.addEventListener('visibilitychange', onVis);
  doc.addEventListener('resume', onNativeResume);
  if (focusTarget) focusTarget.addEventListener('focus', onFocus);
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    doc.removeEventListener('resume', onNativeResume);
    if (focusTarget) focusTarget.removeEventListener('focus', onFocus);
  };
}

/** One retry, only when the session we just refreshed still came back with zero rows and no error. */
export function shouldRetryEmptyInvoiceList(input: {
  sessionWasStale: boolean;
  rowCount: number;
  hadError: boolean;
  alreadyRetried: boolean;
}): boolean {
  return input.sessionWasStale && input.rowCount === 0 && !input.hadError && !input.alreadyRetried;
}

export function mergeInvoiceRows<T extends InvoiceListRow>(
  batches: Array<readonly T[] | null | undefined>
): T[] {
  const seen = new Set<string>();
  const list: T[] = [];
  for (const batch of batches) {
    for (const row of batch || []) {
      if (!row || row.id == null) continue;
      const key = String(row.id);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(row);
    }
  }
  list.sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  return list;
}

/** Stored status for pills. `partial` is the same pill as `partially_paid`. */
export function invoiceListStatus(row: { status?: string | null }): string {
  const st = String(row.status || '')
    .trim()
    .toLowerCase();
  if (!st) return 'draft';
  if (st === 'partial') return 'partially_paid';
  return st;
}

export function invoiceMatchesListFilter(
  row: { status?: string | null },
  filter: InvoiceListFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'void') return isVoidInvoiceStatus(row.status);
  return invoiceListStatus(row) === filter;
}

export function invoiceStatusBadgeClass(status: string): string {
  const st = invoiceListStatus({ status });
  if (st === 'paid') return 'bg-green-900/40 text-green-200 border-green-700';
  if (st === 'partially_paid') return 'bg-amber-900/40 text-amber-200 border-amber-700';
  if (st === 'draft') return 'bg-gray-700/40 text-gray-200 border-gray-600';
  if (st === 'sent') return 'bg-blue-900/40 text-blue-200 border-blue-700';
  if (st === 'void' || st === 'voided') return 'bg-rose-900/40 text-rose-200 border-rose-700';
  return 'bg-[var(--surface2)] text-[var(--text2)] border-[var(--border2)]';
}

export function invoiceStatusLabel(status: string): string {
  const st = invoiceListStatus({ status });
  if (st === 'partially_paid') return 'Partial';
  if (st === 'paid') return 'Paid';
  if (st === 'void' || st === 'voided') return 'Void';
  return st ? st.charAt(0).toUpperCase() + st.slice(1) : 'Draft';
}
