import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTEMPT_NOTE,
  CATCHUP_DEFAULT_LIMIT,
  CATCHUP_DEFAULT_MAX_BYTES,
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

type FailureRow = { attempts: number; retryAfter: number; error: string };

const EMPTY_READ = {
  missing: 0,
  eligible: 0,
  oversized: 0,
  oversized_ids: [] as number[],
  unknown_size: 0,
  unknown_size_ids: [] as number[],
  no_file: 0,
  no_file_ids: [] as number[],
  in_progress: 0,
  ids: [] as number[],
};

function harness(opts: {
  missingRead?: { data?: unknown; error?: { message: string } | null } | (() => never);
  /** Stateful mode: the RPC answers like 000918 from these ids, the index and the failure rows. */
  missingIds?: number[];
  manuals?: Manual[];
  index?: Array<{ manual_id: number; chunk_index: number; search_text: string }>;
  files?: Record<string, Buffer>;
  failures?: Map<number, FailureRow>;
  clock?: { t: number };
  attemptError?: string;
  deleteError?: string;
}) {
  const calls: Array<{ kind: string; detail: unknown }> = [];
  const index = opts.index || [];
  const failures = opts.failures || new Map<number, FailureRow>();
  const clock = opts.clock || { t: 0 };
  const manuals = opts.manuals || [];
  const pending = new Map<number, { token: string; total: number }>();
  const MIN = 60_000;
  const client: CatchupClient = {
    rpc: async (fn, args) => {
      calls.push({ kind: `rpc:${fn}`, detail: args });
      if (fn === 'manuals_missing_search_index') {
        if (typeof opts.missingRead === 'function') return opts.missingRead();
        if (opts.missingRead) return opts.missingRead;
        const missing = (opts.missingIds || []).filter((id) => !index.some((r) => r.manual_id === id));
        const eligible = missing.filter((id) => !((failures.get(id)?.retryAfter ?? -1) > clock.t));
        return {
          data: { ...EMPTY_READ, missing: missing.length, eligible: eligible.length, ids: eligible.slice(0, Number(args.p_limit)) },
          error: null,
        };
      }
      if (fn === 'record_manual_search_index_attempt') {
        if (opts.attemptError) return { data: null, error: { message: opts.attemptError } };
        const id = Number(args.p_manual_id);
        const prev = failures.get(id);
        const attempts = (prev?.attempts || 0) + 1;
        const backoff = Math.min(24 * 60, 15 * 2 ** Math.min(attempts - 1, 7)) * MIN;
        failures.set(id, { attempts, retryAfter: clock.t + backoff, error: String(args.p_note) });
        return { data: new Date(clock.t + backoff).toISOString(), error: null };
      }
      if (fn === 'record_manual_search_index_failure') {
        const id = Number(args.p_manual_id);
        const prev = failures.get(id);
        failures.set(id, prev ? { ...prev, error: String(args.p_error) } : { attempts: 1, retryAfter: clock.t + 15 * MIN, error: String(args.p_error) });
        return { data: new Date().toISOString(), error: null };
      }
      if (fn === 'begin_manual_search_index_append') {
        const id = Number(args.p_manual_id);
        if (pending.has(id)) return { data: { status: 'busy' }, error: null };
        if (index.some((r) => r.manual_id === id)) return { data: { status: 'already_indexed' }, error: null };
        pending.set(id, { token: `t${id}`, total: Number(args.p_total_chunks) });
        return { data: { status: 'ok', token: `t${id}` }, error: null };
      }
      if (fn === 'append_manual_search_index_chunks') {
        const id = Number(args.p_manual_id);
        const marker = pending.get(id);
        const have = index.filter((r) => r.manual_id === id).length;
        if (!marker || marker.token !== args.p_token || have !== Number(args.p_expected_rows)) return { data: false, error: null };
        (args.p_chunks as string[]).forEach((text, i) => index.push({ manual_id: id, chunk_index: have + i, search_text: text }));
        return { data: true, error: null };
      }
      if (fn === 'finish_manual_search_index_append') {
        const id = Number(args.p_manual_id);
        const marker = pending.get(id);
        if (!marker || marker.token !== args.p_token || index.filter((r) => r.manual_id === id).length !== marker.total) return { data: false, error: null };
        pending.delete(id);
        return { data: true, error: null };
      }
      if (fn === 'abort_manual_search_index_append') {
        const id = Number(args.p_manual_id);
        if (pending.get(id)?.token !== args.p_token) return { data: false, error: null };
        for (let i = index.length - 1; i >= 0; i -= 1) if (index[i].manual_id === id) index.splice(i, 1);
        pending.delete(id);
        return { data: true, error: null };
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
          return {
            eq: async (_c: string, v: unknown) => {
              if (opts.deleteError) return { error: { message: opts.deleteError } };
              failures.delete(Number(v));
              return { error: null };
            },
          };
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
  return { client, calls, index, failures, clock };
}

const read = (ids: number[], extra: Record<string, unknown> = {}) => ({
  data: { ...EMPTY_READ, missing: ids.length, eligible: ids.length, ids, ...extra },
  error: null,
});

/** Lets pending microtasks and I/O callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await nextTurn();
};

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
  assert.deepEqual(h.calls[0].detail, { p_limit: CATCHUP_DEFAULT_LIMIT, p_max_bytes: CATCHUP_DEFAULT_MAX_BYTES });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /"event":"manual-index-catchup"/);
});

for (const [name, missingRead] of [
  ['an RPC error', { data: null, error: { message: 'Could not find the function public.manuals_missing_search_index' } }],
  ['a malformed payload', { data: { missing: 'x', ids: [1] }, error: null }],
  ['an old payload without oversized', { data: { missing: 1, eligible: 1, ids: [1] }, error: null }],
  ['a bad id', { data: { ...EMPTY_READ, missing: 1, eligible: 1, ids: ['1; drop'] }, error: null }],
  ['a payload without unknown_size/no_file (10c4e7cc shape)', { data: { missing: 1, eligible: 1, oversized: 0, oversized_ids: [], ids: [1] }, error: null }],
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
    missingRead: read([10, 11, 12, 13, 14, 15], { missing: 7 }),
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
  assert.equal(h.failures.get(11)?.error, 'no_pdf_downloaded');
  // Indexed, already-indexed and empty-text manuals leave no failure row.
  assert.deepEqual([...h.failures.keys()].sort((x, y) => x - y), [11, 15]);
  assert.deepEqual(out.cleanupFailed, []);
  assert.ok(!h.calls.some((c) => c.kind === 'download' && c.detail === 'shared/x/m13.pdf'));
  // Chunked, expect-empty writes only (begin / append / finish), no single-call replace.
  assert.ok(!h.calls.some((c) => c.kind === 'rpc:replace_manual_search_index'));
  assert.deepEqual(
    h.calls.filter((c) => c.kind === 'rpc:begin_manual_search_index_append').map((c) => (c.detail as { p_manual_id: number }).p_manual_id),
    [10, 14],
  );
  assert.equal(logs.length, 6);
});

test('caps work per run and defers past the time budget', async () => {
  let t = 0;
  const h = harness({
    missingRead: read(Array.from({ length: 60 }, (_, i) => i + 1)),
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
  assert.deepEqual(h.calls[0].detail, { p_limit: 50, p_max_bytes: CATCHUP_DEFAULT_MAX_BYTES });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(out.deferred.length, 47);
});

test('parseMissingRead accepts only the RPC shape', () => {
  assert.deepEqual(
    parseMissingRead({ ...EMPTY_READ, missing: 3, eligible: 1, oversized: 1, oversized_ids: [9], unknown_size: 1, unknown_size_ids: [8], no_file: 2, no_file_ids: [6, 7], in_progress: 1, ids: [5] }),
    { missing: 3, eligible: 1, oversized: 1, oversizedIds: [9], unknownSize: 1, unknownSizeIds: [8], noFile: 2, noFileIds: [6, 7], inProgress: 1, ids: [5] },
  );
  assert.equal(parseMissingRead([]), null);
  assert.equal(parseMissingRead({ ...EMPTY_READ, missing: -1 }), null);
  assert.equal(parseMissingRead({ ...EMPTY_READ, missing: 1, eligible: 1, ids: [0] }), null);
  assert.equal(parseMissingRead({ ...EMPTY_READ, oversized_ids: ['x'] }), null);
  assert.equal(parseMissingRead({ ...EMPTY_READ, unknown_size_ids: [-1] }), null);
  assert.equal(parseMissingRead({ missing: 1, eligible: 1, oversized: 0, oversized_ids: [], ids: [] }), null);
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
  // missing, attempt, failure, begin, append, finish, abort, replace, search.
  assert.equal((up.match(/SET search_path = ''/g) || []).length, 9);
  assert.equal((up.match(/^SECURITY DEFINER$/gm) || []).length, 9);
  assert.doesNotMatch(up, /pg_catalog\.(extract|coalesce)/i);
  assert.match(up, /ENABLE ROW LEVEL SECURITY/);
  for (const fn of [
    'manuals_missing_search_index\\(integer, bigint\\)',
    'record_manual_search_index_attempt\\(bigint, text\\)',
    'record_manual_search_index_failure\\(bigint, text\\)',
    'begin_manual_search_index_append\\(bigint, integer\\)',
    'append_manual_search_index_chunks\\(bigint, uuid, integer, text\\[\\], boolean\\[\\], integer\\[\\]\\)',
    'finish_manual_search_index_append\\(bigint, uuid\\)',
    'abort_manual_search_index_append\\(bigint, uuid\\)',
  ]) {
    assert.match(up, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn} TO service_role`));
    assert.match(up, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM authenticated`));
    assert.match(down, new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}`));
  }
  // Deleted Storage versions count as absent; oversized PDFs are never eligible.
  assert.equal((up.match(/o\.archived_at IS NULL/g) || []).length, 2);
  assert.equal((up.match(/o\.is_delete_marker IS NOT TRUE/g) || []).length, 2);
  // Unknown size is never treated as small; no-file manuals are listed.
  assert.match(up, /WHERE NOT x\.size_unknown\s+AND x\.bytes <= /);
  assert.match(up, /'unknown_size_ids'/);
  assert.match(up, /'no_file_ids'/);
  // In-progress marker: readers in SQL skip it; rollback restores 000913.
  assert.match(up, /CREATE TABLE IF NOT EXISTS public\.manual_search_index_pending/);
  assert.match(up, /FUNCTION public\.search_manual_catalog[\s\S]*NOT EXISTS \(\s*SELECT 1 FROM public\.manual_search_index_pending/);
  assert.match(up, /DELETE FROM public\.manual_search_index_pending WHERE manual_id = p_manual_id;\n\n  INSERT INTO public\.manual_search_index/);
  assert.match(down, /DROP TABLE IF EXISTS public\.manual_search_index_pending/);
  const v913 = readFileSync(join(dir, '20261011_000913_manual_search_index_chunks.sql'), 'utf8');
  const body = (sql: string, name: string) => sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`), sql.indexOf('$$;', sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)));
  assert.equal(body(down, 'search_manual_catalog'), body(v913, 'search_manual_catalog'));
  assert.equal(body(down, 'replace_manual_search_index'), body(v913, 'replace_manual_search_index'));
  assert.match(up, /p_max_bytes bigint DEFAULT 20971520/);
  assert.equal(CATCHUP_DEFAULT_MAX_BYTES, 20971520);
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
  assert.match(doc, /clear the backlog with the script first/i);
  assert.match(doc, /MANUAL_INDEX_CATCHUP_DISABLED=1/);
  assert.match(doc, /record_manual_search_index_attempt/);
  assert.match(doc, /unknown_size/);
  assert.match(doc, /no_file/);
  assert.match(doc, /append_manual_search_index_chunks/);
});

// ---- Crash safety (QA #307 MEDIUM). These fail on 664fbe22, which only
// wrote the failure row after the indexer returned.

test('a run killed mid-extraction (30 s timeout / OOM) has already backed the manual off', async () => {
  const failures = new Map<number, FailureRow>();
  const clock = { t: 0 };
  const shared = { missingIds: [1, 2, 3], manuals: [manual(1), manual(2), manual(3)], failures, clock };

  // Run 1: manual 1 never finishes. Netlify kills the function; the promise
  // never settles and nothing after the indexer call runs.
  const h1 = harness(shared);
  const entered: number[] = [];
  void runManualIndexCatchup(h1.client, {
    log: () => {},
    indexer: (_c, m) => {
      entered.push(Number(m.id));
      return new Promise<never>(() => {});
    },
  });
  await settle();
  assert.deepEqual(entered, [1]);
  const kinds = h1.calls.map((c) => c.kind);
  assert.ok(kinds.indexOf('rpc:record_manual_search_index_attempt') > -1, 'attempt recorded before extraction');
  assert.deepEqual(failures.get(1), { attempts: 1, retryAfter: 15 * 60_000, error: ATTEMPT_NOTE });

  // Run 2, 15 minutes later on the clock minus a second: manual 1 is backed
  // off, so the queue moves on instead of picking it first again.
  clock.t = 15 * 60_000 - 1_000;
  const h2 = harness(shared);
  const seen: number[] = [];
  const out = await runManualIndexCatchup(h2.client, {
    log: () => {},
    indexer: async (_c, m) => {
      seen.push(Number(m.id));
      return { manualId: String(m.id), ok: true, chars: 1, files: 1 };
    },
  });
  assert.deepEqual(seen, [2, 3]);
  assert.equal(out.eligible, 2);
  assert.ok(!failures.has(2) && !failures.has(3), 'success clears the attempt row');

  // Run 3 after the window: retried once, and a second crash doubles the backoff.
  clock.t = 15 * 60_000 + 1_000;
  const h3 = harness({ ...shared, missingIds: [1] });
  void runManualIndexCatchup(h3.client, { log: () => {}, indexer: () => new Promise<never>(() => {}) });
  await settle();
  assert.equal(failures.get(1)?.attempts, 2);
  assert.equal(failures.get(1)?.retryAfter, clock.t + 30 * 60_000);
});

test('the attempt is recorded before any download of the PDF', async () => {
  const h = harness({ missingRead: read([7]), manuals: [manual(7)], files: { 'shared/x/m7.pdf': buildTextPdf(['gamma']) } });
  const out = await runManualIndexCatchup(h.client, { log: () => {} });
  assert.deepEqual(out.indexed, [7]);
  const kinds = h.calls.map((c) => c.kind);
  const claim = kinds.indexOf('rpc:record_manual_search_index_attempt');
  assert.ok(claim > -1 && claim < kinds.indexOf('download'));
  assert.ok(!h.failures.has(7));
});

test('fails closed when the attempt cannot be recorded: nothing extracted or written', async () => {
  const h = harness({ missingRead: read([1, 2]), manuals: [manual(1), manual(2)], attemptError: 'permission denied' });
  let called = 0;
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, {
    log: (l) => logs.push(l),
    indexer: async () => {
      called += 1;
      return { manualId: '1', ok: true, chars: 1, files: 1 };
    },
  });
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.match(out.error || '', /attempt record failed for 1: permission denied/);
  assert.deepEqual(out.deferred, [1, 2]);
  assert.ok(!h.calls.some((c) => c.kind === 'download' || c.kind === 'rpc:replace_manual_search_index'));
});

test('a failure-row cleanup error is checked and logged', async () => {
  const h = harness({ missingRead: read([4]), manuals: [manual(4)], deleteError: 'deadlock detected' });
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, {
    log: (l) => logs.push(l),
    indexer: async () => ({ manualId: '4', ok: true, chars: 1, files: 1 }),
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.indexed, [4]);
  assert.deepEqual(out.cleanupFailed, [4]);
  assert.ok(logs.some((l) => /"event":"manual-index-catchup-cleanup-failed","id":4,"error":"deadlock detected"/.test(l)));
});

test('oversized PDFs are logged and left to the CLI, even when nothing else is eligible', async () => {
  const h = harness({ missingRead: read([], { missing: 2, eligible: 0, oversized: 2, oversized_ids: [1803, 1810] }) });
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, { log: (l) => logs.push(l) });
  assert.equal(out.ok, true);
  assert.equal(out.oversized, 2);
  assert.deepEqual(out.oversizedIds, [1803, 1810]);
  assert.deepEqual(h.calls.map((c) => c.kind), ['rpc:manuals_missing_search_index']);
  const line = logs.find((l) => l.includes('manual-index-catchup-oversized')) || '';
  assert.match(line, /"maxBytes":20971520,"count":2,"ids":\[1803,1810\]/);
});

// ---- QA lows on 10c4e7cc: unknown size and missing files are logged, never
// silently dropped or treated as small. These fail on 10c4e7cc.

test('unknown-size and no-file manuals are logged every run and never picked', async () => {
  const h = harness({
    missingRead: read([], { missing: 3, eligible: 0, unknown_size: 2, unknown_size_ids: [1201, 1202], no_file: 3, no_file_ids: [47, 48, 1758] }),
  });
  const logs: string[] = [];
  const out = await runManualIndexCatchup(h.client, { log: (l) => logs.push(l) });
  assert.equal(out.ok, true);
  assert.deepEqual(out.unknownSizeIds, [1201, 1202]);
  assert.deepEqual(out.noFileIds, [47, 48, 1758]);
  assert.deepEqual(h.calls.map((c) => c.kind), ['rpc:manuals_missing_search_index']);
  assert.ok(logs.some((l) => /"event":"manual-index-catchup-unknown-size","count":2,"ids":\[1201,1202\]/.test(l)));
  assert.ok(logs.some((l) => /"event":"manual-index-catchup-no-file","count":3,"ids":\[47,48,1758\]/.test(l)));
});

test('the scheduled job writes through the chunked path (one append per ~200k chunk)', async () => {
  const h = harness({ missingRead: read([7]), manuals: [manual(7)], files: { 'shared/x/m7.pdf': buildTextPdf(['gamma', 'delta']) } });
  const out = await runManualIndexCatchup(h.client, { log: () => {} });
  assert.deepEqual(out.indexed, [7]);
  const kinds = h.calls.map((c) => c.kind).filter((k) => k.startsWith('rpc:') && !k.includes('missing') && !k.includes('attempt'));
  assert.deepEqual(kinds, ['rpc:begin_manual_search_index_append', 'rpc:append_manual_search_index_chunks', 'rpc:finish_manual_search_index_append']);
});
