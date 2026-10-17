/**
 * Scheduled catch-up for manual_search_index. Server-only.
 *
 * Called by web/netlify/functions/manual-index-catchup.mts. One RPC
 * (manuals_missing_search_index, migration 000918) answers "is anything
 * missing?". When nothing is, the run ends there. Otherwise up to `limit`
 * published manuals that have a PDF in Storage and no index row are indexed
 * with indexMissingManualSearchText (the God button extractor, expect-empty
 * write). Every write is replace_manual_search_index with p_expected_md5 NULL,
 * so this never overwrites a row another writer just made.
 *
 * Crash safety: before extracting a manual, the attempt is recorded with
 * record_manual_search_index_attempt, which bumps attempts and backs the
 * manual off (15 min, doubling, 24 h cap). If Netlify kills the function
 * mid-extraction (30 s limit, out of memory), the manual is already backed
 * off, so it cannot be picked first on every run. Success clears the row; a
 * failure stores the reason with record_manual_search_index_failure.
 *
 * Never eligible, but logged every run (up to 20 ids each) and left to
 * scripts/index-missing-manuals.mjs or a person: oversized PDFs (over
 * maxBytes, default 20 MiB in Storage), PDFs whose Storage size is missing or
 * not a number (unknown_size, never treated as small), and published
 * manuals with no live file in Storage at all (no_file).
 *
 * Writes are chunked (~200,000 characters per call, see
 * writeChunkedManualSearchIndex) so each statement stays under the REST
 * role's 8 s statement_timeout, and partial rows stay invisible to readers.
 *
 * Fails closed: any read error, a missing RPC, missing credentials or a
 * failed attempt record ends the run before an extraction or write.
 */

import {
  ALREADY_INDEXED,
  asManualCatalogId,
  indexMissingManualSearchText,
  type ManualIndexResult,
} from './manual-search-index.ts';

export const CATCHUP_DEFAULT_LIMIT = 5;
/** Netlify scheduled functions stop at 30 s. Start no new manual after this. */
export const CATCHUP_DEFAULT_BUDGET_MS = 18_000;
/** PDFs larger than this (bytes in Storage, summed for folders) are left to the CLI. */
export const CATCHUP_DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const ATTEMPT_NOTE = 'attempt started; no result recorded (timeout or crash?)';

type RpcResult = { data?: unknown; error?: { message?: string } | null };

export type CatchupClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js query builder
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js storage client
  storage: any;
};

export type CatchupSummary = {
  ok: boolean;
  missing: number | null;
  eligible: number | null;
  oversized: number | null;
  oversizedIds: number[];
  unknownSize: number | null;
  unknownSizeIds: number[];
  noFile: number | null;
  noFileIds: number[];
  inProgress: number | null;
  attempted: number;
  indexed: number[];
  emptyText: number[];
  alreadyIndexed: number[];
  failed: Array<{ id: number; reason: string }>;
  deferred: number[];
  cleanupFailed: number[];
  error?: string;
  ms: number;
};

type MissingRead = {
  missing: number;
  eligible: number;
  oversized: number;
  oversizedIds: number[];
  unknownSize: number;
  unknownSizeIds: number[];
  noFile: number;
  noFileIds: number[];
  inProgress: number;
  ids: number[];
};

function parseIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: number[] = [];
  for (const value of raw) {
    const id = asManualCatalogId(value);
    if (id == null || id < 1) return null;
    ids.push(id);
  }
  return ids;
}

function count(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function parseMissingRead(data: unknown): MissingRead | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const missing = count(row.missing);
  const eligible = count(row.eligible);
  const oversized = count(row.oversized);
  const unknownSize = count(row.unknown_size);
  const noFile = count(row.no_file);
  const inProgress = count(row.in_progress);
  const ids = parseIds(row.ids);
  const oversizedIds = parseIds(row.oversized_ids);
  const unknownSizeIds = parseIds(row.unknown_size_ids);
  const noFileIds = parseIds(row.no_file_ids);
  if (
    missing == null || eligible == null || oversized == null || unknownSize == null || noFile == null ||
    inProgress == null || !ids || !oversizedIds || !unknownSizeIds || !noFileIds
  ) {
    return null;
  }
  return { missing, eligible, oversized, oversizedIds, unknownSize, unknownSizeIds, noFile, noFileIds, inProgress, ids };
}

export async function runManualIndexCatchup(
  client: CatchupClient,
  opts: {
    limit?: number;
    budgetMs?: number;
    maxBytes?: number;
    now?: () => number;
    log?: (line: string) => void;
    indexer?: (client: CatchupClient, manual: Record<string, unknown>) => Promise<ManualIndexResult>;
  } = {},
): Promise<CatchupSummary> {
  const now = opts.now || Date.now;
  const log = opts.log || ((line: string) => console.log(line));
  const indexer =
    opts.indexer || ((c: CatchupClient, m: Record<string, unknown>) => indexMissingManualSearchText(c, m));
  const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit) || CATCHUP_DEFAULT_LIMIT)));
  const budgetMs = Math.max(0, Number(opts.budgetMs ?? CATCHUP_DEFAULT_BUDGET_MS));
  const maxBytes = Math.max(1, Math.floor(Number(opts.maxBytes) || CATCHUP_DEFAULT_MAX_BYTES));
  const started = now();
  const summary: CatchupSummary = {
    ok: false,
    missing: null,
    eligible: null,
    oversized: null,
    oversizedIds: [],
    unknownSize: null,
    unknownSizeIds: [],
    noFile: null,
    noFileIds: [],
    inProgress: null,
    attempted: 0,
    indexed: [],
    emptyText: [],
    alreadyIndexed: [],
    failed: [],
    deferred: [],
    cleanupFailed: [],
    ms: 0,
  };
  const finish = (patch: Partial<CatchupSummary>) => {
    Object.assign(summary, patch, { ms: now() - started });
    log(JSON.stringify({ event: 'manual-index-catchup', ...summary }));
    return summary;
  };

  let read: RpcResult;
  try {
    read = await client.rpc('manuals_missing_search_index', { p_limit: limit, p_max_bytes: maxBytes });
  } catch (err) {
    return finish({ error: `missing read threw: ${err instanceof Error ? err.message : String(err)}` });
  }
  if (read?.error) return finish({ error: `missing read failed: ${read.error.message || 'unknown'}` });
  const parsed = parseMissingRead(read?.data);
  if (!parsed) return finish({ error: 'missing read returned an unexpected shape' });
  summary.missing = parsed.missing;
  summary.eligible = parsed.eligible;
  summary.oversized = parsed.oversized;
  summary.oversizedIds = parsed.oversizedIds;
  summary.unknownSize = parsed.unknownSize;
  summary.unknownSizeIds = parsed.unknownSizeIds;
  summary.noFile = parsed.noFile;
  summary.noFileIds = parsed.noFileIds;
  summary.inProgress = parsed.inProgress;
  if (parsed.oversized > 0) {
    log(
      JSON.stringify({
        event: 'manual-index-catchup-oversized',
        maxBytes,
        count: parsed.oversized,
        ids: parsed.oversizedIds,
        hint: 'left to scripts/index-missing-manuals.mjs --apply',
      }),
    );
  }
  if (parsed.unknownSize > 0) {
    log(
      JSON.stringify({
        event: 'manual-index-catchup-unknown-size',
        count: parsed.unknownSize,
        ids: parsed.unknownSizeIds,
        hint: 'Storage has no numeric size for the PDF; not treated as small. Use scripts/index-missing-manuals.mjs --apply --ids=...',
      }),
    );
  }
  if (parsed.noFile > 0) {
    log(
      JSON.stringify({
        event: 'manual-index-catchup-no-file',
        count: parsed.noFile,
        ids: parsed.noFileIds,
        hint: 'published, not indexed, and no live file in the manuals bucket; upload the PDF or unpublish the row',
      }),
    );
  }
  if (!parsed.ids.length) return finish({ ok: true });

  const ids = parsed.ids.slice(0, limit);
  const { data: rows, error: rowsError } = await client
    .from('manuals')
    .select('id, storage_path, is_folder, chapter_metadata, entry_file_path, published')
    .in('id', ids);
  if (rowsError) return finish({ error: `manuals read failed: ${rowsError.message || 'unknown'}` });
  const byId = new Map<number, Record<string, unknown>>();
  for (const row of (rows || []) as Record<string, unknown>[]) {
    const id = asManualCatalogId(row.id);
    if (id != null && row.published === true) byId.set(id, row);
  }

  const clearFailureRow = async (id: number) => {
    let message: string | null = null;
    try {
      const res = await client.from('manual_search_index_failures').delete().eq('manual_id', id);
      if (res?.error) message = res.error.message || 'unknown';
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (message != null) {
      summary.cleanupFailed.push(id);
      log(JSON.stringify({ event: 'manual-index-catchup-cleanup-failed', id, error: message }));
    }
  };

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (now() - started >= budgetMs) {
      summary.deferred.push(id);
      continue;
    }
    const manual = byId.get(id);
    if (!manual) continue;

    // Record the attempt BEFORE extracting, so a timeout or OOM kill still
    // backs this manual off. If that write fails, extract nothing.
    let claimError: string | null = null;
    try {
      const claim = await client.rpc('record_manual_search_index_attempt', { p_manual_id: id, p_note: ATTEMPT_NOTE });
      if (claim?.error) claimError = claim.error.message || 'unknown';
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
    }
    if (claimError != null) {
      summary.deferred.push(...ids.slice(i));
      return finish({ ok: false, error: `attempt record failed for ${id}: ${claimError}` });
    }

    summary.attempted += 1;
    let result: ManualIndexResult;
    try {
      result = await indexer(client, manual);
    } catch (err) {
      result = { manualId: String(id), ok: false, chars: 0, files: 0, skipped: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      summary.indexed.push(id);
      await clearFailureRow(id);
    } else if (result.skipped === ALREADY_INDEXED) {
      // Another writer indexed it after the missing read. Nothing is missing.
      summary.alreadyIndexed.push(id);
      await clearFailureRow(id);
    } else if (result.skipped === 'no_extractable_text') {
      // indexMissingManualSearchText stored an empty row, so the manual is no longer missing.
      summary.emptyText.push(id);
      await clearFailureRow(id);
    } else {
      const reason = String(result.skipped || 'index failed');
      summary.failed.push({ id, reason });
      // The attempt row already backs it off; this only stores the reason.
      let noteError: string | null = null;
      try {
        const noted = await client.rpc('record_manual_search_index_failure', { p_manual_id: id, p_error: reason });
        if (noted?.error) noteError = noted.error.message || 'unknown';
      } catch (err) {
        noteError = err instanceof Error ? err.message : String(err);
      }
      if (noteError != null) log(JSON.stringify({ event: 'manual-index-catchup-backoff-failed', id, error: noteError }));
    }
    log(JSON.stringify({ event: 'manual-index-catchup-manual', id, ok: result.ok, chars: result.chars, skipped: result.skipped }));
  }
  return finish({ ok: true });
}
