/**
 * Reindex folder manuals 1, 9, and 73 locally so the whole PDF is searchable.
 *
 * Those rows were sliced at 1,500,000 characters. pdf.js totals are 1157,
 * 1621, and 1207 pages. The clipped index stops at [[pdfpage:1018]],
 * [[pdfpage:1402]], and [[pdfpage:1090]]. After this script the max stamps
 * are 1157, 1621, and 1207, index_clipped is false, and page stamps stay
 * continuous across chunk rows.
 *
 * Do not use POST /api/god/manuals/reindex-one. That route has a 60 second
 * limit and cannot extract these books. This script calls
 * reindexManualPageRange on your machine with the service role key.
 *
 * The first call for a manual (page 1) stores md5 of the joined index on
 * the staging object in the manuals bucket. The call that finishes the
 * book invokes replace_manual_search_index. That function is one
 * transaction: lock_timeout 5s, an advisory lock on the manual id, and a
 * refusal when the stored md5 changed. The page loop itself is not held
 * inside a database transaction.
 *
 * 20261011_000911_manuals_published.sql is already applied. Apply these
 * files on yljztfajyvjzqikxdddf before --apply, in order:
 *   web/supabase/migrations/20261011_000912_manual_search_index_clip.sql
 *   web/supabase/migrations/20261011_000913_manual_search_index_chunks.sql
 * Redeploy the get-manual-url and grok-assistant edge functions after the
 * SQL, then run this script. This script does not apply SQL and does not
 * deploy.
 *
 * Dry-run is the default. Nothing is read or written unless --apply is set.
 *
 * Usage (from web/, Node 22):
 *   node scripts/reindex-long-manuals.mjs
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node --experimental-strip-types --experimental-transform-types \
 *     scripts/reindex-long-manuals.mjs --apply
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LONG_MANUAL_REINDEX = [
  { id: 1, expectedMaxStamp: 1157 },
  { id: 9, expectedMaxStamp: 1621 },
  { id: 73, expectedMaxStamp: 1207 },
];

export function reindexPlanText() {
  const lines = [
    'Dry run. Pass --apply to reindex manuals 1, 9, and 73.',
    'Expected max [[pdfpage:N]] after a full reindex:',
  ];
  for (const manual of LONG_MANUAL_REINDEX) {
    lines.push(`  manual ${manual.id} indexed_page_max ${manual.expectedMaxStamp}`);
  }
  lines.push('The write is replace_manual_search_index, guarded by the md5 captured at page 1.');
  lines.push('index_clipped should be false. Chunk stamps stay continuous.');
  return lines.join('\n');
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function applyReindex() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before --apply.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const { reindexManualPageRange } = await import('../lib/manual-search-index.ts');
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  for (const manual of LONG_MANUAL_REINDEX) {
    const loaded = await admin
      .from('manuals')
      .select('id, storage_path, is_folder, chapter_metadata, entry_file_path')
      .eq('id', manual.id)
      .maybeSingle();
    if (loaded.error) throw new Error(`manual ${manual.id}: ${loaded.error.message}`);
    if (!loaded.data) throw new Error(`manual ${manual.id} was not found`);
    let pageFrom = 1;
    let result;
    for (;;) {
      result = await reindexManualPageRange(admin, loaded.data, { pageFrom, pageCount: 40 });
      console.log(JSON.stringify({ id: manual.id, ...result }));
      if (!result.ok) {
        throw new Error(`manual ${manual.id} stopped: ${result.error || 'reindex failed'}`);
      }
      if (result.done) break;
      if (!result.nextPage || result.nextPage <= pageFrom) {
        throw new Error(`manual ${manual.id} did not advance from page ${pageFrom}`);
      }
      pageFrom = result.nextPage;
    }
    const chunks = await admin
      .from('manual_search_index')
      .select('chunk_index,indexed_page_max,index_clipped')
      .eq('manual_id', manual.id)
      .order('chunk_index', { ascending: true });
    if (chunks.error) throw new Error(`manual ${manual.id} readback: ${chunks.error.message}`);
    const rows = chunks.data || [];
    let maxStamp = 0;
    let clipped = false;
    for (const row of rows) {
      if (row.index_clipped === true) clipped = true;
      const stamp = Number(row.indexed_page_max);
      if (Number.isFinite(stamp) && stamp > maxStamp) maxStamp = stamp;
    }
    console.log(
      `manual ${manual.id} chunks=${rows.length} index_clipped=${clipped} indexed_page_max=${maxStamp}`,
    );
    if (clipped) {
      throw new Error(`manual ${manual.id} is still index_clipped; a single page exceeded the cap`);
    }
    if (maxStamp !== manual.expectedMaxStamp) {
      throw new Error(
        `manual ${manual.id} indexed_page_max ${maxStamp}, expected ${manual.expectedMaxStamp}`,
      );
    }
  }
}

function main() {
  if (!process.argv.includes('--apply')) {
    console.log(reindexPlanText());
    return;
  }
  const child = process.env.REINDEX_LONG_MANUALS_INNER === '1';
  if (!child) {
    const rerun = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--experimental-transform-types', fileURLToPath(import.meta.url), '--apply'],
      {
        stdio: 'inherit',
        env: { ...process.env, REINDEX_LONG_MANUALS_INNER: '1' },
      },
    );
    process.exit(rerun.status == null ? 1 : rerun.status);
  }
  applyReindex().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

if (isDirectRun()) main();
