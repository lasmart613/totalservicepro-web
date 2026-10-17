/**
 * Scheduled catch-up for manual_search_index. Server-only.
 *
 * Called by web/netlify/functions/manual-index-catchup.mts. One RPC
 * (manuals_missing_search_index, migration 000918) answers "is anything
 * missing?". When nothing is, the run ends there. Otherwise up to `limit`
 * published manuals that have a PDF in Storage and no index row are indexed
 * with indexMissingManualSearchText (the God button extractor, expect-empty
 * write). Every write is replace_manual_search_index with p_expected_md5 NULL,
 * so this never overwrites a row another writer just made. A failed extraction is recorded with
 * record_manual_search_index_failure, which backs that manual off.
 *
 * Fails closed: any read error, a missing RPC or missing credentials ends the
 * run before a write.
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
  attempted: number;
  indexed: number[];
  emptyText: number[];
  alreadyIndexed: number[];
  failed: Array<{ id: number; reason: string }>;
  deferred: number[];
  error?: string;
  ms: number;
};

type MissingRead = { missing: number; eligible: number; ids: number[] };

export function parseMissingRead(data: unknown): MissingRead | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as { missing?: unknown; eligible?: unknown; ids?: unknown };
  const missing = Number(row.missing);
  const eligible = Number(row.eligible);
  if (!Number.isSafeInteger(missing) || missing < 0) return null;
  if (!Number.isSafeInteger(eligible) || eligible < 0) return null;
  if (!Array.isArray(row.ids)) return null;
  const ids: number[] = [];
  for (const raw of row.ids) {
    const id = asManualCatalogId(raw);
    if (id == null || id < 1) return null;
    ids.push(id);
  }
  return { missing, eligible, ids };
}

export async function runManualIndexCatchup(
  client: CatchupClient,
  opts: {
    limit?: number;
    budgetMs?: number;
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
  const started = now();
  const summary: CatchupSummary = {
    ok: false,
    missing: null,
    eligible: null,
    attempted: 0,
    indexed: [],
    emptyText: [],
    alreadyIndexed: [],
    failed: [],
    deferred: [],
    ms: 0,
  };
  const finish = (patch: Partial<CatchupSummary>) => {
    Object.assign(summary, patch, { ms: now() - started });
    log(JSON.stringify({ event: 'manual-index-catchup', ...summary }));
    return summary;
  };

  let read: RpcResult;
  try {
    read = await client.rpc('manuals_missing_search_index', { p_limit: limit });
  } catch (err) {
    return finish({ error: `missing read threw: ${err instanceof Error ? err.message : String(err)}` });
  }
  if (read?.error) return finish({ error: `missing read failed: ${read.error.message || 'unknown'}` });
  const parsed = parseMissingRead(read?.data);
  if (!parsed) return finish({ error: 'missing read returned an unexpected shape' });
  summary.missing = parsed.missing;
  summary.eligible = parsed.eligible;
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

  for (const id of ids) {
    if (now() - started >= budgetMs) {
      summary.deferred.push(id);
      continue;
    }
    const manual = byId.get(id);
    if (!manual) continue;
    summary.attempted += 1;
    let result: ManualIndexResult;
    try {
      result = await indexer(client, manual);
    } catch (err) {
      result = { manualId: String(id), ok: false, chars: 0, files: 0, skipped: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      summary.indexed.push(id);
      await client.from('manual_search_index_failures').delete().eq('manual_id', id);
    } else if (result.skipped === ALREADY_INDEXED) {
      // Another writer indexed it after the missing read. Nothing to do.
      summary.alreadyIndexed.push(id);
    } else if (result.skipped === 'no_extractable_text') {
      // indexMissingManualSearchText stored an empty row, so the manual is no longer missing.
      summary.emptyText.push(id);
      await client.from('manual_search_index_failures').delete().eq('manual_id', id);
    } else {
      const reason = String(result.skipped || 'index failed');
      summary.failed.push({ id, reason });
      const backoff = await client.rpc('record_manual_search_index_failure', { p_manual_id: id, p_error: reason });
      if (backoff?.error) log(JSON.stringify({ event: 'manual-index-catchup-backoff-failed', id, error: backoff.error.message }));
    }
    log(JSON.stringify({ event: 'manual-index-catchup-manual', id, ok: result.ok, chars: result.chars, skipped: result.skipped }));
  }
  return finish({ ok: true });
}
