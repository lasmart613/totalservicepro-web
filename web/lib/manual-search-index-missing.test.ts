import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALREADY_INDEXED,
  indexMissingManualSearchText,
  indexTextMd5,
  listIndexedManualIds,
  manualsMissingSearchIndex,
} from './manual-search-index.ts';
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
function fakeAdmin(opts: {
  manuals: ManualRow[];
  index: IndexRow[];
  files: Record<string, Buffer>;
  onDownload?: (path: string) => void;
  listed?: Record<string, string[]>;
}) {
  const calls = { rpc: [] as Array<Record<string, unknown>>, manualUpdates: 0 };
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
      // Mirrors replace_manual_search_index: md5 of the joined chunks (NULL for
      // no rows) IS DISTINCT FROM p_expected_md5 refuses the write.
      const id = Number(args.p_manual_id);
      const existing = opts.index
        .filter((r) => r.manual_id === id)
        .sort((a, b) => a.chunk_index - b.chunk_index)
        .map((r) => r.search_text);
      const current = indexTextMd5(existing);
      const expected = (args.p_expected_md5 as string | null) ?? null;
      if (current !== expected) return { data: false, error: null };
      for (let i = opts.index.length - 1; i >= 0; i -= 1) if (opts.index[i].manual_id === id) opts.index.splice(i, 1);
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
  return admin;
}

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
  assert.deepEqual(admin.calls.rpc.map((c) => c.p_manual_id).sort(), [1755, 1756, 1757]);
  assert.ok(admin.calls.rpc.every((c) => c.fn === 'replace_manual_search_index' && c.p_expected_md5 === null));
  assert.equal(first.done.indexed, 3);
  assert.equal(first.done.indexedDistinctAfter, 1149);
  const text = s.index.find((r) => r.manual_id === 1756)?.search_text || '';
  assert.match(text, /\[\[pdfpage:1\]\][\s\S]*reservoir/);
  assert.match(text, /\[\[pdfpage:2\]\][\s\S]*error code 1756/);

  const second = await runIndexMissing(deps(admin), parseArgs(['--apply']), () => {});
  assert.deepEqual(second.summary.toIndexIds, [1758]);
  assert.equal(admin.calls.rpc.length, 3);
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
  // Every write was expect-empty.
  assert.ok(admin.calls.rpc.every((c) => c.p_expected_md5 === null));
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
