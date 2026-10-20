/**
 * Company manual library: add-confirm guard, Remove & refund, and read reports.
 *
 * The rules live in the database (migration 000936, SECURITY DEFINER RPCs);
 * this file only calls them and turns their answers into UI copy. See
 * supabase/migrations/20261020_000936_manual_library_refund.sql.
 *
 *   - Remove always works. It refunds the slot only within 24h of the add, if
 *     the manual was not downloaded or printed and not heavily read (more than
 *     20 distinct pages, more than half of a manual of at most 40 pages, or
 *     more than 15 signed URLs issued), and the org has had fewer than 3
 *     refunds this calendar month (UTC).
 *   - A removal that does not refund holds its slot until the month ends.
 */

export const ADD_CONFIRM_ARM_MS = 300;
export const REFUND_WINDOW_HOURS = 24;
export const REFUND_MONTHLY_CAP = 3;
export const HEAVY_READING_PAGES = 20;

export type LibrarySource = 'web' | 'android' | 'ios' | 'api';

/** Which client is calling: the Android/iOS shells set a UA marker. */
export function librarySource(userAgent: string | null | undefined): LibrarySource {
  const ua = String(userAgent || '');
  if (/TotalServicePro-Android|TSPAndroid/i.test(ua)) return 'android';
  if (/TotalServicePro-iOS|TSPiOS/i.test(ua)) return 'ios';
  return 'web';
}

/** Sanitize a client-sent source for the server (anything else is 'web'). */
export function normalizeLibrarySource(value: unknown): LibrarySource {
  return value === 'android' || value === 'ios' || value === 'api' ? value : 'web';
}

/**
 * Ignores repeat calls for the same key while one is running (double click,
 * key repeat). Returns undefined when the call was dropped.
 */
export function createInFlightGuard() {
  const busy = new Set<string>();
  return {
    isBusy: (key: string) => busy.has(key),
    async run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
      if (busy.has(key)) return undefined;
      busy.add(key);
      try {
        return await fn();
      } finally {
        busy.delete(key);
      }
    },
  };
}

/** The Add button is ignored until this long after the dialog opened. */
export function addConfirmArmed(openedAt: number, now: number, armMs = ADD_CONFIRM_ARM_MS): boolean {
  return now - openedAt >= armMs;
}

export type RefundReason =
  | 'refund'
  | 'window_expired'
  | 'downloaded'
  | 'printed'
  | 'heavy_reading'
  | 'many_fetches'
  | 'monthly_cap'
  | 'still_held'
  | 'not_in_library';

export type RemoveResult = {
  removed: boolean;
  refunded: boolean;
  reason: RefundReason | string;
  refunds_used?: number;
  refunds_cap?: number;
  slots_held?: number;
  /** 000936 not applied: plain delete, no refund rules ran. */
  legacy?: boolean;
};

export type LibraryStatus = {
  owned: boolean;
  refund_eligible?: boolean;
  reason?: RefundReason | string;
  refund_until?: string;
  refunds_used?: number;
  refunds_cap?: number;
  slots_held?: number;
};

type PgError = { message?: string; code?: string } | null | undefined;

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: PgError }>;
};

type DeleteClient = RpcClient & {
  from: (table: string) => any;
};

/** True when the error says the 000936 function is not deployed yet. */
export function isMissingLibraryRpc(error: PgError): boolean {
  if (!error) return false;
  const msg = String(error.message || '');
  return error.code === 'PGRST202' || /could not find the function|does not exist|schema cache/i.test(msg);
}

/** English copy (translated by useT at the call site). */
export function refundReasonMessage(reason: string | undefined | null): string {
  switch (reason) {
    case 'refund':
      return 'Removed. The slot was refunded.';
    case 'window_expired':
      return 'Removed. No slot refund: it was added more than 24 hours ago.';
    case 'downloaded':
      return 'Removed. No slot refund: the manual was downloaded.';
    case 'printed':
      return 'Removed. No slot refund: the manual was printed.';
    case 'heavy_reading':
    case 'many_fetches':
      return 'Removed. No slot refund: much of the manual was read.';
    case 'monthly_cap':
      return 'Removed. No slot refund: your company used its 3 refunds this month.';
    case 'still_held':
      return 'Removed. No slot refund: this manual already held a slot from an earlier removal this month.';
    case 'not_in_library':
      return 'This manual is no longer in your company library.';
    default:
      return 'Removed from company library.';
  }
}

/** Label for the remove action on a library item, from a status preview. */
export function removeActionLabel(status: LibraryStatus | null | undefined): string {
  return status?.refund_eligible ? 'Remove & refund' : 'Remove';
}

/** Explains, before removing, whether the slot comes back. */
export function removeConfirmBody(status: LibraryStatus | null | undefined): string {
  if (status?.refund_eligible) {
    return 'The slot will be refunded. Everyone in your company loses access to this manual.';
  }
  return 'The slot will not be refunded and stays used until the end of the month. Everyone in your company loses access to this manual.';
}

export async function loadLibraryStatus(supabase: RpcClient, manualId: string | number): Promise<LibraryStatus | null> {
  try {
    const { data, error } = await supabase.rpc('manual_library_status', { p_manual_id: Number(manualId) });
    if (error || !data || typeof data !== 'object') return null;
    return data as LibraryStatus;
  } catch {
    return null;
  }
}

/**
 * Remove through the 000936 RPC. Only when that function does not exist yet
 * (000936 not applied) does it fall back to the old direct delete. Any other
 * error is returned, never retried another way.
 */
export async function removeFromLibrary(
  supabase: DeleteClient,
  manualId: string | number,
  orgId: string | number | null,
  source: LibrarySource,
): Promise<{ result: RemoveResult | null; error: PgError }> {
  const { data, error } = await supabase.rpc('manual_library_remove', {
    p_manual_id: Number(manualId),
    p_source: source,
  });
  if (!error && data && typeof data === 'object') return { result: data as RemoveResult, error: null };
  if (!isMissingLibraryRpc(error)) return { result: null, error: error || { message: 'Could not remove manual' } };
  if (orgId == null) return { result: null, error: { message: 'No company on your profile' } };
  const del = await supabase
    .from('organization_manuals')
    .delete()
    .eq('organization_id', orgId)
    .eq('manual_id', manualId);
  if (del?.error) return { result: null, error: del.error };
  return { result: { removed: true, refunded: true, reason: 'refund', legacy: true }, error: null };
}

/** Slots still held by non-refunded removals this month (0 before 000936). */
export async function loadSlotsHeld(supabase: RpcClient, orgId: string | number | null): Promise<number> {
  if (orgId == null) return 0;
  try {
    const { data, error } = await supabase.rpc('manual_slots_held', { p_org: Number(orgId) });
    if (error) return 0;
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export type AccessKind = 'page_view' | 'download' | 'print';

/** Fire-and-forget read report. Never throws, never blocks the viewer. */
export async function recordManualAccess(
  supabase: RpcClient,
  manualId: string | number | null | undefined,
  kind: AccessKind,
  opts: { pages?: number[]; pageCount?: number; source?: LibrarySource } = {},
): Promise<void> {
  const id = Number(manualId);
  if (!Number.isFinite(id) || id <= 0) return;
  const pages =
    kind === 'page_view'
      ? Array.from(new Set((opts.pages || []).filter((p) => Number.isInteger(p) && p >= 1))).slice(0, 500)
      : null;
  if (kind === 'page_view' && (!pages || pages.length === 0)) return;
  try {
    await supabase.rpc('manual_record_access', {
      p_manual_id: id,
      p_kind: kind,
      p_pages: pages,
      p_page_count: opts.pageCount && opts.pageCount > 0 ? Math.floor(opts.pageCount) : null,
      p_source: opts.source || 'web',
    });
  } catch {
    /* reporting must never break reading */
  }
}

/**
 * Batches distinct page numbers and flushes them every few seconds (and on
 * hide). The server keeps one row per page per add, so resends are harmless.
 */
export function createPageViewBatcher(flush: (pages: number[]) => void) {
  const pending = new Set<number>();
  const sent = new Set<number>();
  return {
    add(page: number) {
      if (!Number.isInteger(page) || page < 1 || sent.has(page)) return;
      pending.add(page);
    },
    flush() {
      if (!pending.size) return;
      const pages = [...pending].sort((a, b) => a - b);
      pending.clear();
      for (const p of pages) sent.add(p);
      flush(pages);
    },
    get pendingCount() {
      return pending.size;
    },
  };
}
