/**
 * The manual index writers driven through a REAL @supabase/supabase-js client
 * (createClient) against a local fake HTTP API (test/fake-supabase-http.ts).
 *
 * Regression: e6913763 shipped `const rpc = db.rpc;` in
 * writeChunkedManualSearchIndex. SupabaseClient.rpc reads `this.rest`, so the
 * detached call threw "Cannot read properties of undefined (reading 'rest')"
 * before begin_manual_search_index_append, and the 1195/1210 backfill wrote
 * nothing. The in-memory fakes in the other suites have rpc/from functions
 * that ignore `this`, so they could not catch it; these tests can.
 *
 * Covers every writer path: writeChunkedManualSearchIndex,
 * indexMissingManualSearchText (scripts/index-missing-manuals.mjs and the
 * catch-up), runManualIndexCatchup, the Netlify scheduled function, the God
 * reindex (indexManualSearchText) and reindex-one (reindexManualPageRange)
 * routes, and the CLI script end to end on a 2-chunk manual.
 * Catalog ids 4201-4209 are made up; no real org or manual is used.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  ALREADY_INDEXED,
  INDEX_WRITE_BUSY,
  indexManualSearchText,
  indexMissingManualSearchText,
  reindexManualPageRange,
  writeChunkedManualSearchIndex,
} from './manual-search-index.ts';
import { runManualIndexCatchup, type CatchupClient } from './manual-index-catchup.ts';
import { extractPdfPages, PDF_INDEX_APPEND_CHUNK_CHARS } from './manual-pdf-text.ts';
import { buildPdf, buildTextPdf } from './manual-pdf-fixtures.ts';
import { FAKE_SERVICE_KEY, startFakeSupabase, type FakeSupabase } from '../test/fake-supabase-http.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');

function realClient(fake: FakeSupabase) {
  return createClient(fake.url, FAKE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * A PDF whose extracted text needs 2 append chunks (> 200,000 chars).
 * 100 short lines a page in 6 pt type: pdf.js drops glyphs past the page's
 * right edge, so one long Tj line per page would extract only ~85 chars.
 */
function twoChunkPdf(): Buffer {
  const pages = Math.ceil((PDF_INDEX_APPEND_CHUNK_CHARS * 1.3) / 7000);
  const kids = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (let p = 1; p <= pages; p += 1) {
    const lines: string[] = [];
    for (let l = 0; l < 100; l += 1) {
      const words: string[] = [];
      for (let w = 0; words.join(' ').length < 64; w += 1) words.push(`p${p}l${l}w${w}`);
      lines.push(`(${words.join(' ')}) Tj 0 -7 Td`);
    }
    const stream = `BT /F1 6 Tf 20 780 Td ${lines.join(' ')} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + (p - 1) * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  return buildPdf(objects);
}
const BIG_PDF = twoChunkPdf();

function manualRow(id: number, path: string) {
  return { id, storage_path: path, is_folder: false, chapter_metadata: null, entry_file_path: null, published: true };
}

async function withFake(
  setup: { manuals?: ReturnType<typeof manualRow>[]; index?: Record<string, unknown>[]; files?: Record<string, Buffer> },
  fn: (fake: FakeSupabase) => Promise<void>,
) {
  const fake = await startFakeSupabase({
    tables: { manuals: setup.manuals || [], manual_search_index: setup.index || [] },
    storage: { manuals: setup.files || {} },
  });
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

const fns = (fake: FakeSupabase) => fake.state.rpcCalls.map((c) => c.fn);

test('real client: the 2-chunk fixture extracts to more than one append chunk of text', async () => {
  const pages = await extractPdfPages(new Uint8Array(BIG_PDF));
  const chars = pages.reduce((n, pg) => n + pg.text.length, 0);
  assert.ok(chars > PDF_INDEX_APPEND_CHUNK_CHARS * 1.1, `only ${chars} chars`);
  assert.ok(chars < PDF_INDEX_APPEND_CHUNK_CHARS * 2, `${chars} chars would need 3 chunks`);
});

test('real client: writeChunkedManualSearchIndex begins, appends 2 chunks, finishes (rpc keeps its this)', async () => {
  await withFake({}, async (fake) => {
    const db = realClient(fake);
    const out = await writeChunkedManualSearchIndex(db, 4201, [
      { chunkIndex: 0, text: 'alpha chunk', clipped: false, indexedPageMax: 3 },
      { chunkIndex: 1, text: 'beta chunk', clipped: false, indexedPageMax: 6 },
    ]);
    assert.deepEqual(out, { ok: true, chunks: 2, calls: 4 });
    assert.deepEqual(fns(fake), [
      'begin_manual_search_index_append',
      'append_manual_search_index_chunks',
      'append_manual_search_index_chunks',
      'finish_manual_search_index_append',
    ]);
    assert.deepEqual(
      fake.indexRows(4201).map((r) => [r.chunk_index, r.search_text]),
      [
        [0, 'alpha chunk'],
        [1, 'beta chunk'],
      ],
    );
    assert.equal(fake.state.pending.size, 0);
    assert.deepEqual(fake.state.unhandled, []);
  });
});

test('real client: writeChunkedManualSearchIndex reports already_indexed and busy from begin', async () => {
  await withFake({ index: [{ manual_id: 4202, chunk_index: 0, search_text: 'kept' }] }, async (fake) => {
    const db = realClient(fake);
    const indexed = await writeChunkedManualSearchIndex(db, 4202, [{ chunkIndex: 0, text: 'new', clipped: false, indexedPageMax: 1 }]);
    assert.deepEqual(indexed, { ok: false, reason: ALREADY_INDEXED });
    fake.state.pending.set(4203, { token: 'other-writer', total: 1 });
    const busy = await writeChunkedManualSearchIndex(db, 4203, [{ chunkIndex: 0, text: 'new', clipped: false, indexedPageMax: 1 }]);
    assert.deepEqual(busy, { ok: false, reason: INDEX_WRITE_BUSY });
    assert.equal(fake.indexRows(4202)[0].search_text, 'kept');
    assert.deepEqual(fake.indexRows(4203), []);
  });
});

test('real client: a refused append aborts through the bound rpc and leaves no rows', async () => {
  await withFake({}, async (fake) => {
    const chunks = [
      { chunkIndex: 0, text: 'one', clipped: false, indexedPageMax: 1 },
      { chunkIndex: 1, text: 'two', clipped: false, indexedPageMax: 2 },
    ];
    // A stray row lands after begin, so append 1 sees the wrong row count.
    const realFetch = globalThis.fetch;
    let injected = false;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const res = await realFetch(input, init);
      if (!injected && String(input).endsWith('/rpc/begin_manual_search_index_append')) {
        injected = true;
        fake.state.tables.manual_search_index.push({ manual_id: 4204, chunk_index: 0, search_text: 'stray' });
      }
      return res;
    }) as typeof fetch;
    let out;
    try {
      out = await writeChunkedManualSearchIndex(realClient(fake), 4204, chunks);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(out.ok, false);
    assert.match(String(out.ok === false && out.reason), /append chunk 1\/2 refused/);
    assert.equal(fns(fake).at(-1), 'abort_manual_search_index_append');
    assert.deepEqual(fake.indexRows(4204), []);
    assert.equal(fake.state.pending.size, 0);
  });
});

test('real client: indexMissingManualSearchText writes a 2-chunk manual (the 1195/1210 path)', async () => {
  await withFake({ manuals: [manualRow(4205, 'acme/big.pdf')], files: { 'acme/big.pdf': BIG_PDF } }, async (fake) => {
    const out = await indexMissingManualSearchText(realClient(fake), manualRow(4205, 'acme/big.pdf'));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(out.chars > PDF_INDEX_APPEND_CHUNK_CHARS);
    const rows = fake.indexRows(4205);
    assert.equal(rows.length, 2);
    assert.match(String(rows[0].search_text), /p1l0w0/);
    assert.equal(fns(fake).filter((f) => f === 'append_manual_search_index_chunks').length, 2);
    assert.ok(!fns(fake).includes('replace_manual_search_index'));
    assert.equal(fake.state.pending.size, 0);
    assert.deepEqual(fake.state.unhandled, []);
  });
});

test('real client: runManualIndexCatchup indexes through the chunked writer', async () => {
  await withFake({ manuals: [manualRow(4206, 'acme/c.pdf')], files: { 'acme/c.pdf': BIG_PDF } }, async (fake) => {
    const lines: string[] = [];
    const summary = await runManualIndexCatchup(realClient(fake) as unknown as CatchupClient, { log: (l) => lines.push(l) });
    assert.equal(summary.ok, true, summary.error);
    assert.deepEqual(summary.indexed, [4206]);
    assert.deepEqual(summary.failed, []);
    assert.equal(fake.indexRows(4206).length, 2);
    assert.ok(fns(fake).includes('record_manual_search_index_attempt'));
    assert.deepEqual(fake.state.unhandled, []);
  });
});

test('real client: the Netlify manual-index-catchup function indexes with its own createClient', async () => {
  await withFake({ manuals: [manualRow(4207, 'acme/n.pdf')], files: { 'acme/n.pdf': BIG_PDF } }, async (fake) => {
    const keys = ['MANUAL_INDEX_CATCHUP_DISABLED', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    delete process.env.MANUAL_INDEX_CATCHUP_DISABLED;
    process.env.SUPABASE_URL = fake.url;
    process.env.NEXT_PUBLIC_SUPABASE_URL = fake.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
    const log = console.log;
    const err = console.error;
    const errors: unknown[] = [];
    console.log = () => {};
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      const mod = await import('../netlify/functions/manual-index-catchup.mts');
      await mod.default();
    } finally {
      console.log = log;
      console.error = err;
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(fake.indexRows(4207).length, 2);
    assert.equal(fake.state.pending.size, 0);
  });
});

test('real client: God reindex (indexManualSearchText) writes through the real rpc', async () => {
  await withFake({ manuals: [manualRow(4208, 'acme/g.pdf')], files: { 'acme/g.pdf': buildTextPdf(['god page one', 'god page two']) } }, async (fake) => {
    const out = await indexManualSearchText(realClient(fake), manualRow(4208, 'acme/g.pdf'));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(fake.indexRows(4208).map((r) => r.search_text).join(' '), /god page two/);
    assert.deepEqual(fake.state.unhandled, []);
  });
});

test('real client: God reindex-one (reindexManualPageRange) runs on the real client', async () => {
  await withFake({ manuals: [manualRow(4209, 'acme/r.pdf')], files: { 'acme/r.pdf': buildTextPdf(['range one', 'range two']) } }, async (fake) => {
    const out = await reindexManualPageRange(realClient(fake), manualRow(4209, 'acme/r.pdf'), { pageFrom: 1, pageCount: 40 });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.match(fake.indexRows(4209).map((r) => r.search_text).join(' '), /range two/);
    assert.deepEqual(fake.state.unhandled, []);
  });
});

function runScript(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/index-missing-manuals.mjs', ...args], {
      cwd: webRoot,
      env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('real client: scripts/index-missing-manuals.mjs --apply indexes a 2-chunk manual end to end', async () => {
  await withFake(
    {
      manuals: [manualRow(4205, 'acme/big.pdf'), manualRow(4206, 'acme/other.pdf')],
      index: [{ manual_id: 4206, chunk_index: 0, search_text: 'already here' }],
      files: { 'acme/big.pdf': BIG_PDF, 'acme/other.pdf': buildTextPdf(['x']) },
    },
    async (fake) => {
      const dir = mkdtempSync(join(tmpdir(), 'index-missing-'));
      try {
        const report = join(dir, 'report.json');
        const run = await runScript(['--apply', '--ids=4205,4206', `--report=${report}`], {
          SUPABASE_URL: fake.url,
          SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY,
        });
        assert.equal(run.code, 0, `${run.stdout}\n${run.stderr}`);
        const out = JSON.parse(readFileSync(report, 'utf8'));
        assert.deepEqual(out.summary.toIndexIds, [4205]);
        assert.equal(out.done.indexed, 1);
        assert.deepEqual(out.done.failed, []);
        assert.equal(out.done.indexedDistinctAfter, 2);
        const rows = fake.indexRows(4205);
        assert.equal(rows.length, 2);
        assert.ok(rows.reduce((n, r) => n + String(r.search_text).length, 0) > PDF_INDEX_APPEND_CHUNK_CHARS);
        assert.equal(fake.indexRows(4206)[0].search_text, 'already here');
        assert.deepEqual(fns(fake), [
          'begin_manual_search_index_append',
          'append_manual_search_index_chunks',
          'append_manual_search_index_chunks',
          'finish_manual_search_index_append',
        ]);
        assert.equal(fake.state.pending.size, 0);
        assert.deepEqual(fake.state.unhandled, []);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
