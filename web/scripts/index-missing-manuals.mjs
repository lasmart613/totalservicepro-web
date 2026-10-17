/**
 * Backfill manual_search_index for every catalog manual that has no index row.
 *
 * Why this exists: nothing indexes a manual automatically. There is no
 * trigger, cron job or edge function. Only POST /api/god/manuals (one row at a
 * time from the God form) and the God "Index PDF text" button write the index.
 * Bulk imports insert public.manuals rows with SQL or the REST API, so every
 * import since the Sep 27 full reindex (ids 1168 and up) was never indexed.
 * Run this after every bulk import.
 *
 * Dry run is the default. It reads public.manuals and manual_search_index
 * (read-only) and prints what --apply would do. Without SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY it only prints the plan and touches nothing.
 *
 * --apply indexes each missing manual with indexMissingManualSearchText: the
 * same extractor the God button uses (pdf.js, [[pdfpage:N]] stamps,
 * 1.5M-character chunks), but an expect-empty write. It calls
 * replace_manual_search_index with p_expected_md5 NULL, which the function
 * compares with IS DISTINCT FROM against md5 of the current rows (NULL when
 * there are none). A manual that gained rows after this script listed it
 * (God button, reindex-one, a parallel run) is refused and reported as
 * already_indexed, never overwritten. There is no upsert fallback.
 * Re-running is safe: indexed manuals are skipped.
 * An image-only PDF stores an empty row (same as the God button), so it is
 * not retried forever. A PDF that pdf.js cannot open, or one over the size
 * limit, writes nothing and is listed under failed.
 *
 * It never changes manuals rows except the page counts on chapter_metadata
 * for a manual that already lists chapters (same as the God button).
 *
 * Usage (from web/, Node 22):
 *   node scripts/index-missing-manuals.mjs                       # plan only
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/index-missing-manuals.mjs                     # dry run, read-only
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/index-missing-manuals.mjs --apply             # write
 * Options:
 *   --ids=1755,1756        only these catalog ids (still skipped if indexed)
 *   --limit=N              stop after N manuals
 *   --concurrency=N        parallel manuals, default 2, max 6
 *   --include-unpublished  also index unpublished rows (off by default)
 *   --report=path.json     write per-manual results as JSON
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pdf.js extraction measured locally under Node 22 on the 41 PDFs in the
 * Oct 16 import folder (379 MB; 39 of them became catalog rows 1755-1793):
 * 19.3 s, about 0.05 s per MB. Download from Storage is assumed at
 * about 10 MB/s, plus one read and one RPC per manual.
 */
export const SECONDS_PER_MB = 0.15;
export const SECONDS_PER_MANUAL_OVERHEAD = 1;

export function parseArgs(argv) {
  const opts = {
    apply: false,
    ids: null,
    limit: null,
    concurrency: 2,
    includeUnpublished: false,
    report: null,
  };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--include-unpublished') opts.includeUnpublished = true;
    else if (arg.startsWith('--ids=')) {
      const ids = arg
        .slice(6)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);
      if (!ids.length || ids.some((n) => !Number.isSafeInteger(n) || n < 1)) {
        throw new Error(`--ids must be positive integers: ${arg}`);
      }
      opts.ids = ids;
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice(8));
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--limit must be a positive integer: ${arg}`);
      opts.limit = n;
    } else if (arg.startsWith('--concurrency=')) {
      const n = Number(arg.slice(14));
      if (!Number.isSafeInteger(n) || n < 1 || n > 6) throw new Error(`--concurrency must be 1 to 6: ${arg}`);
      opts.concurrency = n;
    } else if (arg.startsWith('--report=')) {
      opts.report = arg.slice(9);
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return opts;
}

/** Wall-clock estimate in seconds for indexing `bytes` across `count` manuals. */
export function estimateSeconds(count, bytes, concurrency = 2) {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  const serial = count * SECONDS_PER_MANUAL_OVERHEAD + mb * SECONDS_PER_MB;
  return Math.ceil(serial / Math.max(1, concurrency));
}

export function planText() {
  return [
    'Plan only. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for a read-only dry run.',
    'The dry run lists every catalog manual with no manual_search_index row.',
    'Pass --apply to extract each PDF and write it with replace_manual_search_index.',
    'Indexed manuals are skipped, so the script is safe to re-run.',
  ].join('\n');
}

async function loadCatalog(admin, fetchAllPages) {
  const res = await fetchAllPages(async (from, to) =>
    admin
      .from('manuals')
      .select('id, storage_path, is_folder, chapter_metadata, entry_file_path, published')
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (res.error) throw new Error(`manuals read failed: ${res.error.message || res.error}`);
  return res.data;
}

export const STORAGE_LIST_PAGE = 1000;

export async function storageSizes(admin, manuals) {
  const sizes = new Map();
  const byFolder = new Map();
  for (const m of manuals) {
    const p = String(m.storage_path || '');
    if (!/\.pdf$/i.test(p)) continue;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (!byFolder.has(dir)) byFolder.set(dir, []);
    byFolder.get(dir).push({ id: m.id, name });
  }
  for (const [dir, items] of byFolder) {
    const found = new Map();
    for (let offset = 0; ; offset += STORAGE_LIST_PAGE) {
      const { data, error } = await admin.storage
        .from('manuals')
        .list(dir, { limit: STORAGE_LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw new Error(`storage list ${dir} failed: ${error.message || error}`);
      for (const o of data || []) found.set(o.name, Number(o.metadata?.size) || 0);
      if (!data || data.length < STORAGE_LIST_PAGE) break;
    }
    for (const item of items) sizes.set(item.id, found.has(item.name) ? found.get(item.name) : null);
  }
  return sizes;
}

/**
 * Core loop, injectable for tests. `deps` supplies the Supabase admin client
 * and the indexer functions from lib/manual-search-index.ts.
 */
export async function runIndexMissing(deps, opts, log = console.log) {
  const { admin, fetchAllPages, listIndexedManualIds, manualsMissingSearchIndex, indexMissingManualSearchText } = deps;
  const catalog = await loadCatalog(admin, fetchAllPages);
  const before = await listIndexedManualIds(admin);
  if (before.error) throw new Error(`manual_search_index read failed: ${before.error}`);

  let missing = manualsMissingSearchIndex(catalog, before.ids, {
    includeUnpublished: opts.includeUnpublished,
  });
  const unpublishedMissing = manualsMissingSearchIndex(catalog, before.ids, { includeUnpublished: true }).length
    - manualsMissingSearchIndex(catalog, before.ids).length;
  if (opts.ids) {
    const want = new Set(opts.ids);
    missing = missing.filter((m) => want.has(Number(m.id)));
  }
  if (opts.limit) missing = missing.slice(0, opts.limit);

  const sizes = deps.skipSizes ? new Map() : await storageSizes(admin, missing);
  const noFile = missing.filter((m) => sizes.has(m.id) && sizes.get(m.id) == null).map((m) => Number(m.id));
  const bytes = [...sizes.values()].reduce((a, b) => a + (b || 0), 0);

  const summary = {
    mode: opts.apply ? 'apply' : 'dry-run',
    catalog: catalog.length,
    indexedDistinctBefore: before.ids.size,
    indexRowsBefore: before.rows,
    unpublishedMissingSkipped: opts.includeUnpublished ? 0 : unpublishedMissing,
    toIndex: missing.length,
    toIndexIds: missing.map((m) => Number(m.id)),
    missingStorageObject: noFile,
    bytes,
    estimatedSeconds: estimateSeconds(missing.length, bytes, opts.concurrency),
    expectedIndexedDistinctAfter: before.ids.size + missing.length - noFile.length,
  };
  log(JSON.stringify(summary));
  if (!opts.apply) return { summary, results: [] };

  const results = [];
  const queue = missing.filter((m) => !noFile.includes(Number(m.id)));
  let cursor = 0;
  async function worker() {
    for (;;) {
      const manual = queue[cursor++];
      if (!manual) return;
      const started = Date.now();
      let result;
      try {
        result = await indexMissingManualSearchText(admin, manual);
      } catch (err) {
        result = { manualId: String(manual.id), ok: false, chars: 0, files: 0, skipped: err instanceof Error ? err.message : String(err) };
      }
      const row = { ...result, ms: Date.now() - started };
      results.push(row);
      log(JSON.stringify(row));
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, queue.length || 1) }, worker));

  const after = await listIndexedManualIds(admin);
  const done = {
    indexed: results.filter((r) => r.ok).length,
    emptyText: results.filter((r) => r.skipped === 'no_extractable_text').map((r) => Number(r.manualId)),
    alreadyIndexed: results.filter((r) => r.skipped === 'already_indexed').map((r) => Number(r.manualId)),
    failed: results
      .filter((r) => !r.ok && r.skipped !== 'no_extractable_text' && r.skipped !== 'already_indexed')
      .map((r) => ({ id: Number(r.manualId), reason: r.skipped })),
    indexedDistinctAfter: after.error ? null : after.ids.size,
  };
  log(JSON.stringify(done));
  return { summary, results, done };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function inner() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    if (opts.apply) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before --apply.');
    console.log(planText());
    return;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const lib = await import('../lib/manual-search-index.ts');
  const { fetchAllPages } = await import('../lib/supabase/paginate.ts');
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const out = await runIndexMissing(
    {
      admin,
      fetchAllPages,
      listIndexedManualIds: lib.listIndexedManualIds,
      manualsMissingSearchIndex: lib.manualsMissingSearchIndex,
      indexMissingManualSearchText: lib.indexMissingManualSearchText,
    },
    opts,
  );
  if (opts.report) writeFileSync(opts.report, JSON.stringify(out, null, 2));
  if (out.done && out.done.failed.length) process.exitCode = 2;
}

function main() {
  try {
    parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (process.env.INDEX_MISSING_MANUALS_INNER !== '1') {
    const rerun = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--experimental-transform-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, INDEX_MISSING_MANUALS_INNER: '1' } },
    );
    process.exit(rerun.status == null ? 1 : rerun.status);
  }
  inner().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

if (isDirectRun()) main();
