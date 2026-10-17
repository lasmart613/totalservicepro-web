import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATCHUP_DEFAULT_LIMIT,
  parseMissingRead,
  runManualIndexCatchup,
  type CatchupClient,
} from './manual-index-catchup.ts';
import { buildTextPdf } from './manual-pdf-fixtures.ts';
// @ts-expect-error plain .mjs script without types
import { idsFromJson, parseArgs } from '../scripts/index-missing-manuals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

type Manual = { id: number; storage_path: string; is_folder: boolean; chapter_metadata: unknown; entry_file_path: null; published: boolean };

function harness(opts: {
  missingRead?: { data?: unknown; error?: { message: string } | null } | (() => never);
  manuals?: Manual[];
  index?: Array<{ manual_id: number; chunk_index: number; search_text: string }>;
  files?: Record<string, Buffer>;
}) {
  const calls: Array<{ kind: string; detail: unknown }> = [];
  const index = opts.index || [];
  const failures = new Map<number, string>();
  const manuals = opts.manuals || [];
  const client: CatchupClient = {
    rpc: async (fn, args) => {
      calls.push({ kind: `rpc:${fn}`, detail: args });
      if (fn === 'manuals_missing_search_index') {
        if (typeof opts.missingRead === 'function') return opts.missingRead();
        return opts.missingRead || { data: { missing: 0, eligible: 0, ids: [] }, error: null };
      }
      if (fn === 'record_manual_search_index_failure') {
        failures.set(Number(args.p_manual_id), String(args.p_error));
        return { data: new Date().toISOString(), error: null };
      }
      if (fn === 'replace_manual_search_index') {
        const id = Number(args.p_manual_id);
        if (index.some((r) => r.manual_id === id) && args.p_expected_md5 === null) return { data: false, error: null };
        (args.p_chunks as string[]).forEach((text, i) => index.push({ manual_id: id, chunk_index: i, search_text: text }));
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      calls.push({ kind: `from:${table}`, detail: null });
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable PostgREST fake
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters.push((r) => r[col] === v);
          return q;
        },
        in: (col: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(r[col]));
          return q;
        },
        order: () => q,
        delete: () => {
          calls.push({ kind: `delete:${table}`, detail: null });
          return { eq: async (_c: string, v: unknown) => (failures.delete(Number(v)), { error: null }) };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
        then: (resolve: (v: unknown) => void) => {
          const rows = (table === 'manuals' ? manuals : table === 'manual_search_index' ? index : []) as unknown as Record<string, unknown>[];
          return Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }).then(resolve);
        },
      };
      return q;
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          calls.push({ kind: 'download', detail: path });
          const buf = opts.files?.[path];
          if (!buf) return { data: null, error: { message: 'Object not found' } };
          return { data: { size: buf.byteLength, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
        },
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
  return { client, calls, index, failures };
}

const manual = (id: number, published = true): Manual => ({
  id,
  storage_path: `shared/x/m${id}.pdf`,
  is_folder: false,
  chapter_metadata: [],
  entry_file_path: null,
  published,
});

test('nothing missing: one cheap RPC, then exit with no reads or writes', async () => {
  const h = harness({});
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, { log: (l) => logs.push(l) });
  assert.equal(out.ok, true);
  assert.equal(out.missing, 0);
  assert.deepEqual(h.calls.map((c) => c.kind), ['rpc:manuals_missing_search_index']);
  assert.deepEqual(h.calls[0].detail, { p_limit: CATCHUP_DEFAULT_LIMIT });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"event":"manual-index-catchup"/);
});

for (const [name, missingRead] of [
  ['an RPC error', { data: null, error: { message: 'Could not find the function public.manuals_missing_search_index' } }],
  ['a malformed payload', { data: { missing: 'x', ids: [1] }, error: null }],
  ['a bad id', { data: { missing: 1, eligible: 1, ids: ['1; drop'] }, error: null }],
  ['a thrown error', () => { throw new Error('network down'); }],
] as const) {
  test(`fails closed on ${name}: no manuals read, no writes`, async () => {
    const h = harness({ missingRead: missingRead as never, manuals: [manual(1)] });
    const out = await runManualIndexCatchup(h.client, { log: () => {} });
    assert.equal(out.ok, false);
    assert.ok(out.error);
    assert.deepEqual(h.calls.map((c) => c.kind), ['rpc:manuals_missing_search_index']);
  });
}

test('indexes missing manuals, backs off failures, never overwrites, skips unpublished', async () => {
  const files = {
    'shared/x/m10.pdf': buildTextPdf(['alpha reservoir', 'error 43']),
    'shared/x/m12.pdf': buildTextPdf(['beta collimator']),
    'shared/x/m14.pdf': buildTextPdf(['']),
    'shared/x/m15.pdf': Buffer.from('not a pdf at all'),
  };
  const h = harness({
    missingRead: { data: { missing: 7, eligible: 6, ids: [10, 11, 12, 13, 14, 15] }, error: null },
    // 11 has no file; 13 turned unpublished after the read; 12 was indexed by
    // someone else; 14 has pages but no text (stored as page stamps only);
    // 15 is not a PDF.
    manuals: [manual(10), manual(11), manual(12), manual(13, false), manual(14), manual(15)],
    index: [{ manual_id: 12, chunk_index: 0, search_text: 'written by the God button' }],
    files,
  });
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, { limit: 6, log: (l) => logs.push(l) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.indexed, [10, 14]);
  assert.deepEqual(out.alreadyIndexed, [12]);
  assert.deepEqual(out.failed, [
    { id: 11, reason: 'no_pdf_downloaded' },
    { id: 15, reason: 'no_pdf_downloaded' },
  ]);
  assert.deepEqual(out.emptyText, []);
  assert.equal(out.attempted, 5);
  // A missing or unreadable file never leaves an empty row behind.
  assert.ok(!h.index.some((r) => r.manual_id === 11 || r.manual_id === 15));
  assert.deepEqual(h.index.filter((r) => r.manual_id === 14).map((r) => r.search_text), ['[[pdfpage:1]]']);
  assert.deepEqual(h.index.filter((r) => r.manual_id === 12).map((r) => r.search_text), ['written by the God button']);
  assert.ok(h.failures.has(11) && h.failures.has(15));
  assert.ok(!h.calls.some((c) => c.kind === 'download' && c.detail === 'shared/x/m13.pdf'));
  const writes = h.calls.filter((c) => c.kind === 'rpc:replace_manual_search_index');
  assert.ok(writes.every((c) => (c.detail as { p_expected_md5: unknown }).p_expected_md5 === null));
  assert.equal(logs.length, 6);
});

test('caps work per run and defers past the time budget', async () => {
  let t = 0;
  const h = harness({
    missingRead: { data: { missing: 60, eligible: 60, ids: Array.from({ length: 60 }, (_, i) => i + 1) }, error: null },
    manuals: Array.from({ length: 60 }, (_, i) => manual(i + 1)),
  });
  const seen: number[] = [];
  const out = await runManualIndexCatchup(h.client, {
    limit: 500,
    budgetMs: 10_000,
    now: () => t,
    log: () => {},
    indexer: async (_c, m) => {
      seen.push(Number(m.id));
      t += 4_000;
      return { manualId: String(m.id), ok: true, chars: 1, files: 1 };
    },
  });
  assert.deepEqual(h.calls[0].detail, { p_limit: 50 });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(out.deferred.length, 47);
});

test('parseMissingRead accepts only the RPC shape', () => {
  assert.deepEqual(parseMissingRead({ missing: 2, eligible: 1, ids: [5] }), { missing: 2, eligible: 1, ids: [5] });
  assert.equal(parseMissingRead([]), null);
  assert.equal(parseMissingRead({ missing: -1, eligible: 0, ids: [] }), null);
  assert.equal(parseMissingRead({ missing: 1, eligible: 1, ids: [0] }), null);
});

test('scheduled function: schedule only, env checked, no URL handler output', () => {
  const fn = readFileSync(join(web, 'netlify/functions/manual-index-catchup.mts'), 'utf8');
  assert.match(fn, /export const config = \{\s*schedule: '\*\/15 \* \* \* \*',?\s*\}/);
  assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(fn, /MANUAL_INDEX_CATCHUP_DISABLED/);
  assert.doesNotMatch(fn, /new Response\(/);
  assert.doesNotMatch(fn, /path:/);
  // No [functions] block in netlify.toml (god-email-blast.test.ts forbids it);
  // the default nft bundler ships pdfjs-dist as a real node module.
  const toml = readFileSync(join(web, '../netlify.toml'), 'utf8');
  assert.doesNotMatch(toml, /\[functions/);
});

test('migration 000918 follows the migration rules and has a rollback', () => {
  const dir = join(web, 'supabase/migrations');
  const up = readFileSync(join(dir, '20261016_000918_manual_search_index_catchup.sql'), 'utf8');
  const down = readFileSync(join(dir, '20261016_000918_manual_search_index_catchup_rollback.sql'), 'utf8');
  for (const sql of [up, down]) assert.match(sql, /SET LOCAL lock_timeout = '5s';/);
  assert.equal((up.match(/SET search_path = ''/g) || []).length, 2);
  assert.match(up, /SECURITY DEFINER[\s\S]*SECURITY DEFINER/);
  assert.doesNotMatch(up, /pg_catalog\.(extract|coalesce)/i);
  assert.match(up, /ENABLE ROW LEVEL SECURITY/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION public\.manuals_missing_search_index\(integer\) TO service_role/);
  assert.match(down, /DROP FUNCTION IF EXISTS public\.manuals_missing_search_index\(integer\)/);
  assert.match(down, /DROP TABLE IF EXISTS public\.manual_search_index_failures/);
});

test('--ids-file reads the import flow\'s inserted_ids.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ids-'));
  const file = join(dir, 'inserted_ids.json');
  writeFileSync(file, JSON.stringify([{ id: 1755, title: 'a' }, { id: 1756 }]));
  assert.deepEqual(parseArgs([`--ids-file=${file}`, '--ids=1756,1800']).ids.sort(), [1755, 1756, 1800]);
  assert.deepEqual(idsFromJson('[3, 4]'), [3, 4]);
  assert.throws(() => idsFromJson('{"id": 1}'));
  assert.throws(() => idsFromJson('[{"title": "no id"}]'));
});

test('import README documents the post-insert step', () => {
  const doc = readFileSync(join(web, 'scripts/MANUAL-IMPORTS.md'), 'utf8');
  assert.match(doc, /index-missing-manuals\.mjs --apply --ids-file=inserted_ids\.json/);
  assert.match(doc, /index-missing-manuals\.mjs --apply --ids=/);
});
