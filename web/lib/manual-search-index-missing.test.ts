import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALREADY_INDEXED,
  APPEND_TIMEOUT_RETRIES,
  appendChunks,
  INDEX_WRITE_BUSY,
  indexMissingManualSearchText,
  isTransientAppendError,
  indexTextMd5,
  listIndexedManualIds,
  listPendingIndexIds,
  manualsMissingSearchIndex,
  writeChunkedManualSearchIndex,
} from './manual-search-index.ts';
import { chunkIndexText, PDF_INDEX_APPEND_CHUNK_CHARS } from './manual-pdf-text.ts';
import { fetchAllPages } from './supabase/paginate.ts';
import { buildTextPdf } from './manual-pdf-fixtures.ts';
// @ts-expect-error plain .mjs script without types
import { estimateSeconds, parseArgs, runIndexMissing, storageSizes, STORAGE_LIST_PAGE } from '../scripts/index-missing-manuals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PGRST_MAX_ROWS = 1000;

type IndexRow = { manual_id: number; chunk_index: number; search_text: string };
type ManualRow = {
  id: number;
  storage_path: string;
  is_folder: boolean;
  chapter_metadata: unknown;
  entry_file_path: string | null;
  published: boolean;
};

/**
 * Minimal PostgREST-shaped fake. Like the live API, any select returns at most
 * PGRST_MAX_ROWS rows, and .range() pages through ordered rows.
 */
type PendingRow = { token: string; total: number; startedAt: number };

/**
 * Also models migration 000918's chunked writer: begin / append / finish /
 * abort with the in-progress marker table manual_search_index_pending, and
 * replace_manual_search_index clearing a marker. `chunked: false` answers
 * like a database without 000918 (begin RPC missing). `onRpc` can return a
 * result to inject an error before the fake runs.
 */
function fakeAdmin(opts: {
  manuals: ManualRow[];
  index: IndexRow[];
  files: Record<string, Buffer>;
  onDownload?: (path: string) => void;
  listed?: Record<string, string[]>;
  pending?: Map<number, PendingRow>;
  chunked?: boolean;
  onRpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) =>
    | { data?: unknown; error?: { message: string } | null }
    | undefined
    | Promise<{ data?: unknown; error?: { message: string } | null } | undefined>;
}) {
  const calls = { rpc: [] as Array<Record<string, unknown>>, manualUpdates: 0 };
  const pending = opts.pending || new Map<number, PendingRow>();
  let tokens = 0;
  const rowsOf = (id: number) => opts.index.filter((r) => r.manual_id === id);
  const dropRows = (id: number) => {
    for (let i = opts.index.length - 1; i >= 0; i -= 1) if (opts.index[i].manual_id === id) opts.index.splice(i, 1);
  };
  function query(rows: () => Record<string, unknown>[]) {
    let filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let orderKeys: string[] = [];
    let range: [number, number] | null = null;
    const run = () => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      if (orderKeys.length) {
        out = [...out].sort((a, b) => {
          for (const key of orderKeys) {
            const d = Number(a[key]) - Number(b[key]);
            if (d) return d;
          }
          return 0;
        });
      }
      if (range) out = out.slice(range[0], range[1] + 1);
      return { data: out.slice(0, PGRST_MAX_ROWS), error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable PostgREST fake
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        filters = [...filters, (r) => r[col] === val];
        return q;
      },
      in: (col: string, vals: unknown[]) => {
        filters = [...filters, (r) => vals.includes(r[col])];
        return q;
      },
      order: (col: string) => {
        orderKeys = [...orderKeys, col];
        return q;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return q;
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }
  const admin = {
    calls,
    from: (table: string) => {
      if (table === 'manual_search_index') return query(() => opts.index as unknown as Record<string, unknown>[]);
      if (table === 'manual_search_index_pending') return query(() => [...pending.keys()].map((manual_id) => ({ manual_id })));
      if (table === 'manuals') {
        const q = query(() => opts.manuals as unknown as Record<string, unknown>[]);
        q.update = () => {
          calls.manualUpdates += 1;
          return { eq: async () => ({ error: null }) };
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push({ fn, ...args });
      const injected = await opts.onRpc?.(fn, args);
      if (injected) return injected;
      const id = Number(args.p_manual_id);
      if (fn === 'begin_manual_search_index_append') {
        if (opts.chunked === false) {
          return { data: null, error: { message: 'Could not find the function public.begin_manual_search_index_append(p_manual_id, p_total_chunks) in the schema cache' } };
        }
        const marker = pending.get(id);
        if (marker) {
          if (marker.startedAt > Date.now() - 10 * 60_000) return { data: { status: 'busy' }, error: null };
          dropRows(id);
          pending.delete(id);
        } else if (rowsOf(id).length) {
          return { data: { status: 'already_indexed' }, error: null };
        }
        const token = `tok-${(tokens += 1)}`;
        pending.set(id, { token, total: Number(args.p_total_chunks), startedAt: Date.now() });
        return { data: { status: 'ok', token }, error: null };
      }
      if (fn === 'append_manual_search_index_chunks') {
        const marker = pending.get(id);
        const chunks = args.p_chunks as string[];
        const expected = Number(args.p_expected_rows);
        if (!marker || marker.token !== args.p_token) return { data: false, error: null };
        if (rowsOf(id).length !== expected || expected + chunks.length > marker.total) return { data: false, error: null };
        chunks.forEach((text, i) => opts.index.push({ manual_id: id, chunk_index: expected + i, search_text: text }));
        return { data: true, error: null };
      }
      if (fn === 'finish_manual_search_index_append') {
        const marker = pending.get(id);
        if (!marker || marker.token !== args.p_token || rowsOf(id).length !== marker.total) return { data: false, error: null };
        pending.delete(id);
        return { data: true, error: null };
      }
      if (fn === 'abort_manual_search_index_append') {
        const marker = pending.get(id);
        if (!marker || marker.token !== args.p_token) return { data: false, error: null };
        dropRows(id);
        pending.delete(id);
        return { data: true, error: null };
      }
      // Mirrors replace_manual_search_index: md5 of the joined chunks (NULL for
      // no rows) IS DISTINCT FROM p_expected_md5 refuses the write.
      const existing = rowsOf(id)
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((r) => r.search_text);
      const current = indexTextMd5(existing);
      const expected = (args.p_expected_md5 as string | null) ?? null;
      if (current !== expected) return { data: false, error: null };
      dropRows(id);
      pending.delete(id);
      (args.p_chunks as string[]).forEach((text, i) =>
        opts.index.push({ manual_id: id, chunk_index: i, search_text: text }),
      );
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          opts.onDownload?.(path);
          const buf = opts.files[path];
          if (!buf) return { data: null, error: { message: 'Object not found' } };
          return {
            data: {
              size: buf.byteLength,
              arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            },
            error: null,
          };
        },
        list: async (dir: string, o: { limit?: number; offset?: number } = {}) => {
          const names = opts.listed?.[dir]
            ? opts.listed[dir].map((name) => ({ name, size: 1 }))
            : Object.entries(opts.files)
                .filter(([p]) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
                .map(([p, b]) => ({ name: p.slice(dir.length + 1), size: b.byteLength }));
          names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
          const offset = o.offset || 0;
          const limit = Math.min(o.limit || 100, PGRST_MAX_ROWS);
          return {
            data: names.slice(offset, offset + limit).map((n) => ({ name: n.name, id: n.name, metadata: { size: n.size } })),
            error: null,
          };
        },
      }),
    },
  };
  return { ...admin, pending };
}

const writes = (admin: { calls: { rpc: Array<Record<string, unknown>> } }) =>
  admin.calls.rpc.filter((c) => c.fn !== 'abort_manual_search_index_append');

function liveShapedIndex(): IndexRow[] {
  // 1,146 indexed manuals, three of them stored as two chunks: 1,149 rows.
  const rows: IndexRow[] = [];
  for (let id = 1; id <= 1146; id += 1) {
    rows.push({ manual_id: id, chunk_index: 0, search_text: `manual ${id}` });
    if (id === 1 || id === 9 || id === 73) rows.push({ manual_id: id, chunk_index: 1, search_text: 'more' });
  }
  return rows;
}

test('a bare select stops at the PostgREST max rows, listIndexedManualIds pages past it', async () => {
  const admin = fakeAdmin({ manuals: [], index: liveShapedIndex(), files: {} });
  const bare = (await admin.from('manual_search_index').select('manual_id')) as { data: IndexRow[] };
  assert.equal(bare.data.length, PGRST_MAX_ROWS);
  assert.ok(new Set(bare.data.map((r) => r.manual_id)).size < 1146);

  const read = await listIndexedManualIds(admin);
  assert.equal(read.error, undefined);
  assert.equal(read.rows, 1149);
  assert.equal(read.ids.size, 1146);
});

test('listIndexedManualIds fails closed on a read error', async () => {
  const admin = {
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable PostgREST fake
      const q: any = {
        select: () => q,
        order: () => q,
        range: async () => ({ data: null, error: { message: 'boom' } }),
      };
      return q;
    },
  };
  const read = await listIndexedManualIds(admin);
  assert.equal(read.error, 'boom');
  assert.equal(read.ids.size, 0);
});

test('manualsMissingSearchIndex returns unindexed published rows lowest id first', () => {
  const catalog = [
    { id: 5, published: true },
    { id: '3', published: true },
    { id: 2, published: true },
    { id: 4, published: false },
    { id: 'x', published: true },
  ];
  const missing = manualsMissingSearchIndex(catalog, new Set([2]));
  assert.deepEqual(missing.map((m) => Number(m.id)), [3, 5]);
  const all = manualsMissingSearchIndex(catalog, new Set([2]), { includeUnpublished: true });
  assert.deepEqual(all.map((m) => Number(m.id)), [3, 4, 5]);
});

test('reindex route reads the index with the paged helper, not a bare select', () => {
  const route = readFileSync(join(here, '../app/api/god/manuals/reindex/route.ts'), 'utf8');
  assert.match(route, /listIndexedManualIds\(admin\)/);
  assert.doesNotMatch(route, /from\('manual_search_index'\)\.select\('manual_id'\)/);
  assert.match(route, /indexedRead\.error/);
});

function scenario(): {
  manuals: ManualRow[];
  files: Record<string, Buffer>;
  index: IndexRow[];
  onDownload?: (path: string) => void;
} {
  const manuals: ManualRow[] = [];
  const files: Record<string, Buffer> = {};
  for (let id = 1; id <= 1146; id += 1) {
    manuals.push({ id, storage_path: `shared/a/m${id}.pdf`, is_folder: false, chapter_metadata: [], entry_file_path: null, published: true });
  }
  for (const id of [1755, 1756, 1757]) {
    const path = `shared/new/m${id}/manual.pdf`;
    manuals.push({ id, storage_path: path, is_folder: false, chapter_metadata: [], entry_file_path: null, published: true });
    files[path] = buildTextPdf([`service manual ${id} reservoir`, `error code ${id}`]);
  }
  // Published row whose PDF is not in Storage.
  manuals.push({ id: 1758, storage_path: 'shared/new/m1758/gone.pdf', is_folder: false, chapter_metadata: [], entry_file_path: null, published: true });
  // Unpublished folder with no files (the Sciton rows 47-52 on prod).
  manuals.push({ id: 1800, storage_path: 'shared/sciton/profile', is_folder: true, chapter_metadata: [], entry_file_path: null, published: false });
  return { manuals, files, index: liveShapedIndex() };
}

function deps(admin: ReturnType<typeof fakeAdmin>) {
  return { admin, fetchAllPages, listIndexedManualIds, manualsMissingSearchIndex, indexMissingManualSearchText };
}

test('index-missing-manuals is a dry run by default and writes nothing', async () => {
  const s = scenario();
  const admin = fakeAdmin(s);
  const logs: string[] = [];
  const out = await runIndexMissing(deps(admin), parseArgs([]), (line: string) => logs.push(line));
  assert.equal(out.summary.mode, 'dry-run');
  assert.equal(out.summary.indexedDistinctBefore, 1146);
  assert.deepEqual(out.summary.toIndexIds, [1755, 1756, 1757, 1758]);
  assert.deepEqual(out.summary.missingStorageObject, [1758]);
  assert.equal(out.summary.unpublishedMissingSkipped, 1);
  assert.equal(out.summary.expectedIndexedDistinctAfter, 1149);
  assert.equal(admin.calls.rpc.length, 0);
  assert.equal(admin.calls.manualUpdates, 0);
  assert.equal(s.index.length, 1149);
});

test('index-missing-manuals --apply indexes only the missing manuals and is idempotent', async () => {
  const s = scenario();
  const admin = fakeAdmin(s);
  const first = await runIndexMissing(deps(admin), parseArgs(['--apply']), () => {});
  const begun = admin.calls.rpc.filter((c) => c.fn === 'begin_manual_search_index_append');
  assert.deepEqual(begun.map((c) => c.p_manual_id).sort(), [1755, 1756, 1757]);
  // Chunked, expect-empty writes only: no single-call replace.
  assert.ok(!admin.calls.rpc.some((c) => c.fn === 'replace_manual_search_index'));
  assert.equal(admin.pending.size, 0);
  assert.equal(first.done.indexed, 3);
  assert.equal(first.done.indexedDistinctAfter, 1149);
  const text = s.index.find((r) => r.manual_id === 1756)?.search_text || '';
  assert.match(text, /\[\[pdfpage:1\]\][\s\S]*reservoir/);
  assert.match(text, /\[\[pdfpage:2\]\][\s\S]*error code 1756/);

  const second = await runIndexMissing(deps(admin), parseArgs(['--apply']), () => {});
  assert.deepEqual(second.summary.toIndexIds, [1758]);
  assert.equal(admin.calls.rpc.length, 9);
  assert.equal(s.index.filter((r) => r.manual_id === 1755).length, 1);
});

test('index-missing-manuals --ids and --limit narrow the run', async () => {
  const s = scenario();
  const admin = fakeAdmin(s);
  const out = await runIndexMissing(deps(admin), parseArgs(['--ids=1757,1755,12', '--limit=1']), () => {});
  assert.deepEqual(out.summary.toIndexIds, [1755]);
  assert.throws(() => parseArgs(['--ids=abc']));
  assert.throws(() => parseArgs(['--concurrency=9']));
  assert.throws(() => parseArgs(['--force']));
});

test('estimate scales with bytes and concurrency', () => {
  const mb = 1024 * 1024;
  assert.equal(estimateSeconds(0, 0), 0);
  assert.ok(estimateSeconds(609, 3125 * mb, 2) < estimateSeconds(609, 3125 * mb, 1));
  assert.equal(estimateSeconds(2, 10 * mb, 1), Math.ceil(2 * 1 + 10 * 0.15));
});

test('the script has no prod defaults and only writes with --apply', () => {
  const src = readFileSync(join(here, '../scripts/index-missing-manuals.mjs'), 'utf8');
  assert.doesNotMatch(src, /yljztfajyvjzqikxdddf/);
  assert.match(src, /if \(!opts\.apply\) return \{ summary, results: \[\] \};/);
});

test('--apply never overwrites a manual that gained rows after the script listed it', async () => {
  const s = scenario();
  // Another writer (God button, reindex-one, a parallel run) indexes 1756
  // while this run is extracting it.
  s.onDownload = (path) => {
    if (path === 'shared/new/m1756/manual.pdf' && !s.index.some((r) => r.manual_id === 1756)) {
      s.index.push({ manual_id: 1756, chunk_index: 0, search_text: 'written by the God button' });
    }
  };
  const admin = fakeAdmin(s);
  const out = await runIndexMissing(deps(admin), parseArgs(['--apply']), () => {});
  const rows1756 = s.index.filter((r) => r.manual_id === 1756);
  assert.deepEqual(rows1756.map((r) => r.search_text), ['written by the God button']);
  assert.deepEqual(out.done.alreadyIndexed, [1756]);
  assert.deepEqual(out.done.failed, []);
  assert.equal(out.done.indexed, 2);
  // Every write was an expect-empty chunked write; 1756 was refused at begin.
  assert.ok(!writes(admin).some((c) => c.fn === 'replace_manual_search_index'));
  assert.ok(!admin.calls.rpc.some((c) => c.fn === 'append_manual_search_index_chunks' && c.p_manual_id === 1756));
});

test('indexMissingManualSearchText skips without downloading when rows already exist', async () => {
  const s = scenario();
  s.index.push({ manual_id: 1757, chunk_index: 0, search_text: 'existing' });
  const downloads: string[] = [];
  s.onDownload = (p) => downloads.push(p);
  const admin = fakeAdmin(s);
  const manual = s.manuals.find((m) => m.id === 1757)!;
  const result = await indexMissingManualSearchText(admin, manual);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, ALREADY_INDEXED);
  assert.deepEqual(downloads, []);
  assert.equal(admin.calls.rpc.length, 0);
});

test('indexMissingManualSearchText refuses without the replace RPC (no upsert fallback)', async () => {
  const s = scenario();
  const admin = fakeAdmin(s) as Partial<ReturnType<typeof fakeAdmin>>;
  delete admin.rpc;
  let upserts = 0;
  const from = admin.from!;
  admin.from = (t: string) => {
    const q = from(t);
    q.upsert = async () => {
      upserts += 1;
      return { error: null };
    };
    return q;
  };
  const result = await indexMissingManualSearchText(admin as never, s.manuals.find((m) => m.id === 1755)!);
  assert.equal(result.ok, false);
  assert.match(String(result.skipped), /Refused/);
  assert.equal(upserts, 0);
});

test('storage listing pages past 1,000 objects in one folder', async () => {
  const names = Array.from({ length: 1500 }, (_, i) => `f${String(i).padStart(4, '0')}.pdf`);
  const admin = fakeAdmin({ manuals: [], index: [], files: {}, listed: { 'shared/big': names } });
  const sizes = await storageSizes(admin, [
    { id: 1, storage_path: 'shared/big/f1200.pdf' },
    { id: 2, storage_path: 'shared/big/f0003.pdf' },
    { id: 3, storage_path: 'shared/big/nope.pdf' },
  ]);
  assert.equal(STORAGE_LIST_PAGE, 1000);
  assert.equal(sizes.get(1), 1);
  assert.equal(sizes.get(2), 1);
  assert.equal(sizes.get(3), null);
});

test('reindex route skips unpublished by default and orders by id as a tiebreaker', () => {
  const route = readFileSync(join(here, '../app/api/god/manuals/reindex/route.ts'), 'utf8');
  assert.match(route, /\.order\('brand'\)\s*\.order\('title'\)\s*\.order\('id'\)/);
  assert.match(route, /m\.published === false && !includeUnpublished/);
  assert.match(route, /select\('[^']*published'\)/);
});

test('a missing or unreadable PDF writes nothing (no permanent empty row)', async () => {
  const s = scenario();
  s.files['shared/new/m1757/manual.pdf'] = Buffer.from('<html>error page</html>');
  const admin = fakeAdmin(s);
  const gone = await indexMissingManualSearchText(admin, s.manuals.find((m) => m.id === 1758)!);
  const notPdf = await indexMissingManualSearchText(admin, s.manuals.find((m) => m.id === 1757)!);
  assert.equal(gone.skipped, 'no_pdf_downloaded');
  assert.equal(notPdf.skipped, 'no_pdf_downloaded');
  assert.equal(admin.calls.rpc.length, 0);
  assert.ok(!s.index.some((r) => r.manual_id === 1757 || r.manual_id === 1758));
});

// ---- Chunked writes (migration 000918). These fail on 10c4e7cc, which wrote
// a whole manual in one replace_manual_search_index call (1195 and 1210 hit
// the 8 s REST statement_timeout on Oct 16).

function bigManualChunks(chars = 2_100_000) {
  const pages: string[] = [];
  let total = 0;
  for (let page = 1; total < chars; page += 1) {
    const text = `[[pdfpage:${page}]] ${'torque 4 Nm fault 1020 handpiece temperature '.repeat(80)}`;
    pages.push(text);
    total += text.length + 1;
  }
  return chunkIndexText(pages.join('\f'));
}

test('a 2M+ character manual is written ~200k characters per call, invisible until finish', async () => {
  const s = scenario();
  // What readers see while the write is half done (after 3 appends).
  let midWrite: { listed: boolean; rows: number } | null = null;
  let probe: ReturnType<typeof fakeAdmin> | null = null;
  const admin = fakeAdmin({
    ...s,
    onRpc: async (fn, args) => {
      if (fn === 'append_manual_search_index_chunks' && args.p_expected_rows === 3 && !midWrite && probe) {
        const read = await listIndexedManualIds(probe);
        midWrite = { listed: read.ids.has(1757), rows: s.index.filter((r) => r.manual_id === 1757).length };
      }
      return undefined;
    },
  });
  probe = admin;
  const source = bigManualChunks();
  assert.ok(source.length <= 2, 'the 1.5M-character chunker made one or two huge chunks');
  const chunks = appendChunks(source);
  assert.ok(chunks.length >= 11);
  assert.ok(chunks.every((c) => c.text.length <= PDF_INDEX_APPEND_CHUNK_CHARS));
  // Same text and stamps (re-chunking only normalizes whitespace).
  const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
  assert.ok(squash(chunks.map((c) => c.text).join('\f')) === squash(source.map((c) => c.text).join('\f')), 'text changed');
  assert.equal(chunks.map((c) => c.text).join('').match(/\[\[pdfpage:\d+\]\]/g)?.length, source.map((c) => c.text).join('').match(/\[\[pdfpage:\d+\]\]/g)?.length);

  const out = await writeChunkedManualSearchIndex(admin, 1757, chunks);
  assert.deepEqual(out, { ok: true, chunks: chunks.length, calls: chunks.length + 2 });
  const appends = admin.calls.rpc.filter((c) => c.fn === 'append_manual_search_index_chunks');
  assert.equal(appends.length, chunks.length);
  assert.deepEqual(appends.map((c) => c.p_expected_rows), chunks.map((_, i) => i));
  assert.ok(appends.every((c) => (c.p_chunks as string[]).length === 1));
  assert.equal(admin.calls.rpc.at(-1)?.fn, 'finish_manual_search_index_append');
  assert.equal(s.index.filter((r) => r.manual_id === 1757).length, chunks.length);
  // Mid-write: 3 partial rows existed, and the manual was not listed as indexed.
  assert.deepEqual(midWrite, { listed: false, rows: 3 });
  assert.ok((await listIndexedManualIds(admin)).ids.has(1757));
});

test('partial rows of a write in progress do not count as indexed', async () => {
  const s = scenario();
  const pending = new Map<number, PendingRow>([[1756, { token: 'other', total: 4, startedAt: Date.now() }]]);
  s.index.push({ manual_id: 1756, chunk_index: 0, search_text: 'partial' });
  const admin = fakeAdmin({ ...s, pending });
  const read = await listIndexedManualIds(admin);
  assert.equal(read.error, undefined);
  assert.ok(!read.ids.has(1756));
  assert.equal(read.pending, 1);
  assert.deepEqual([...(await listPendingIndexIds(admin, [1756, 1757])).ids], [1756]);
  // The script lists it as missing; the expect-empty claim then answers busy
  // (another writer < 10 min ago) instead of skipping it as already indexed.
  const result = await indexMissingManualSearchText(admin, s.manuals.find((m) => m.id === 1756)!);
  assert.equal(result.skipped, INDEX_WRITE_BUSY);
  assert.deepEqual(s.index.filter((r) => r.manual_id === 1756).map((r) => r.search_text), ['partial']);
});

test('a stale write in progress (writer died) is taken over and completed', async () => {
  const s = scenario();
  const pending = new Map<number, PendingRow>([[1756, { token: 'dead', total: 4, startedAt: Date.now() - 11 * 60_000 }]]);
  s.index.push({ manual_id: 1756, chunk_index: 0, search_text: 'stale partial' });
  const admin = fakeAdmin({ ...s, pending });
  const result = await indexMissingManualSearchText(admin, s.manuals.find((m) => m.id === 1756)!);
  assert.equal(result.ok, true);
  assert.ok(!s.index.some((r) => r.search_text === 'stale partial'));
  assert.equal(admin.pending.size, 0);
  assert.ok((await listIndexedManualIds(admin)).ids.has(1756));
});

test('a failed append aborts: partial rows and the marker are removed', async () => {
  const s = scenario();
  const admin = fakeAdmin({
    ...s,
    onRpc: (fn, args) =>
      fn === 'append_manual_search_index_chunks' && args.p_expected_rows === 2
        ? { data: null, error: { message: 'permission denied for table manual_search_index' } }
        : undefined,
  });
  const out = await writeChunkedManualSearchIndex(admin, 1757, appendChunks(bigManualChunks(700_000)));
  assert.equal(out.ok, false);
  assert.match(out.ok ? '' : out.reason, /append chunk 3\/\d+ failed: permission denied/);
  assert.equal(admin.calls.rpc.at(-1)?.fn, 'abort_manual_search_index_append');
  assert.ok(!s.index.some((r) => r.manual_id === 1757));
  assert.equal(admin.pending.size, 0);
});

test('an append cancelled by the statement timeout is retried (row-count guard makes it safe)', async () => {
  const s = scenario();
  let timeouts = 0;
  const admin = fakeAdmin({
    ...s,
    onRpc: (fn, args) => {
      if (fn === 'append_manual_search_index_chunks' && args.p_expected_rows === 1 && timeouts < APPEND_TIMEOUT_RETRIES) {
        timeouts += 1;
        return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      }
      return undefined;
    },
  });
  const chunks = appendChunks(bigManualChunks(500_000));
  const out = await writeChunkedManualSearchIndex(admin, 1757, chunks);
  assert.equal(out.ok, true);
  assert.equal(timeouts, APPEND_TIMEOUT_RETRIES);
  assert.equal(s.index.filter((r) => r.manual_id === 1757).length, chunks.length);
});

test('an append that fails with a gateway/PostgREST 500 is retried', async () => {
  const s = scenario();
  let fails = 0;
  const admin = fakeAdmin({
    ...s,
    onRpc: (fn, args) => {
      if (fn === 'append_manual_search_index_chunks' && args.p_expected_rows === 1 && fails < 2) {
        fails += 1;
        return { data: null, error: { message: fails === 1 ? 'Internal Server Error' : '' } };
      }
      return undefined;
    },
  });
  const chunks = appendChunks(bigManualChunks(500_000));
  const out = await writeChunkedManualSearchIndex(admin, 1757, chunks, 0);
  assert.equal(out.ok, true);
  assert.equal(fails, 2);
  assert.equal(s.index.filter((r) => r.manual_id === 1757).length, chunks.length);
});

test('an append whose response was lost (it committed) is accepted, not aborted', async () => {
  const s = scenario();
  let lost = false;
  const admin = fakeAdmin({
    ...s,
    onRpc: (fn, args) => {
      if (fn === 'append_manual_search_index_chunks' && args.p_expected_rows === 1 && !lost) {
        lost = true;
        // The insert lands, then the HTTP response is lost (thread killed / 502).
        (args.p_chunks as string[]).forEach((text, i) => s.index.push({ manual_id: 1757, chunk_index: 1 + i, search_text: text }));
        return { data: null, error: { message: 'upstream connect error or disconnect/reset before headers (502)' } };
      }
      return undefined;
    },
  });
  const chunks = appendChunks(bigManualChunks(500_000));
  const out = await writeChunkedManualSearchIndex(admin, 1757, chunks, 0);
  assert.equal(out.ok, true);
  const rows = s.index.filter((r) => r.manual_id === 1757).sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
  assert.equal(rows.length, chunks.length);
  assert.deepEqual(rows.map((r) => r.search_text), chunks.map((c) => c.text));
});

test('isTransientAppendError: gateway/network yes, Postgres errors no', () => {
  for (const m of ['canceling statement due to statement timeout', 'Internal Server Error', '', 'fetch failed', 'Bad Gateway', '504 Gateway Time-out', 'socket hang up']) {
    assert.equal(isTransientAppendError(m), true, m);
  }
  for (const m of ['permission denied for table manual_search_index', 'append_manual_search_index_chunks requires p_chunks', 'invalid input syntax for type uuid']) {
    assert.equal(isTransientAppendError(m), false, m);
  }
});

test('an abort that fails is reported, not swallowed', async () => {
  const s = scenario();
  const admin = fakeAdmin({
    ...s,
    onRpc: (fn) =>
      fn === 'finish_manual_search_index_append'
        ? { data: null, error: { message: 'boom' } }
        : fn === 'abort_manual_search_index_append'
          ? { data: null, error: { message: 'connection reset' } }
          : undefined,
  });
  const out = await writeChunkedManualSearchIndex(admin, 1757, appendChunks(bigManualChunks(300_000)));
  assert.equal(out.ok, false);
  assert.equal(out.ok ? '' : out.cleanupError, 'abort failed: connection reset');
  const result = await indexMissingManualSearchText(
    fakeAdmin({ ...scenario(), onRpc: (fn) => (fn === 'finish_manual_search_index_append' ? { data: null, error: { message: 'boom' } } : fn === 'abort_manual_search_index_append' ? { data: null, error: { message: 'connection reset' } } : undefined) }),
    s.manuals.find((m) => m.id === 1755)!,
  );
  assert.match(String(result.skipped), /finish failed: boom; abort failed: connection reset/);
});

test('without 000918 (no begin RPC) it falls back to one expect-empty replace', async () => {
  const s = scenario();
  const admin = fakeAdmin({ ...s, chunked: false });
  const result = await indexMissingManualSearchText(admin, s.manuals.find((m) => m.id === 1755)!);
  assert.equal(result.ok, true);
  const replace = admin.calls.rpc.filter((c) => c.fn === 'replace_manual_search_index');
  assert.equal(replace.length, 1);
  assert.equal(replace[0].p_expected_md5, null);
});

test('chunkIndexText target keeps long pages whole and never drops text', () => {
  const long = `[[pdfpage:2]] ${'x'.repeat(250_000)}`;
  const text = [`[[pdfpage:1]] a`, long, `[[pdfpage:3]] c`].join('\f');
  const chunks = chunkIndexText(text, 1_500_000, 200_000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1].text, long);
  assert.equal(chunks[1].clipped, false);
  assert.equal(chunks.map((c) => c.text).join('\f'), text);
});
