import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asManualCatalogId,
  chapterPathsFromMetadata,
  escapeIlike,
  folderPrefixForManual,
  indexManualSearchText,
  assembleReindexedManual,
  extractQualityImproves,
  indexTextMd5,
  manualPdfByteLimitError,
  mergeStampedManualPages,
  pdfPathsForManual,
  reindexManualPageRange,
  searchTextWriteRefusal,
  shouldKeepExistingSearchText,
  upsertManualSearchIndex,
  writeManualSearchIndex,
} from './manual-search-index.ts';
import { MANUAL_SEARCH_PDF_MAX_BYTES, storeIndexText } from './manual-pdf-text.ts';
import { spawnSync } from 'node:child_process';
import { buildTextPdf } from './manual-pdf-fixtures.ts';
import { MANUAL_FIXTURE_PATH } from './manuals.ts';
import { containsTextImatch } from './email-match.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('pdf paths prefer chapter_metadata, then a single PDF, then a folder prefix', () => {
  assert.deepEqual(
    pdfPathsForManual({
      storage_path: 'shared/candela/MGL',
      chapter_metadata: [
        { storage_path: 'shared/candela/MGL/a.pdf' },
        { title: 'skip' },
        { storage_path: 'shared/candela/MGL/b.pdf' },
      ],
    }),
    ['shared/candela/MGL/a.pdf', 'shared/candela/MGL/b.pdf']
  );
  assert.deepEqual(pdfPathsForManual({ storage_path: 'shared/ge-oec/9900.pdf' }), [
    'shared/ge-oec/9900.pdf',
  ]);
  assert.equal(folderPrefixForManual({ storage_path: 'shared/candela/MGL', is_folder: true }), 'shared/candela/MGL');
  assert.equal(folderPrefixForManual({ storage_path: 'shared/x.pdf' }), null);
  assert.deepEqual(chapterPathsFromMetadata(null), []);
  assert.equal(escapeIlike('50%_off'), '50\\%\\_off');
});

test('manual body fallback matches star, percent, and underscore as literals', () => {
  const src = readFileSync(join(here, './manual-search-index.ts'), 'utf8');
  assert.match(src, /containsTextImatch\(/);
  assert.doesNotMatch(src, /\.ilike\(/);
  const star = containsTextImatch('a*b');
  assert.equal(new RegExp(star, 'i').test('a*b'), true);
  assert.equal(new RegExp(star, 'i').test('A*B'), true);
  assert.equal(new RegExp(star, 'i').test('axxb'), false);
  const percent = containsTextImatch('a%b');
  assert.equal(new RegExp(percent, 'i').test('a%b'), true);
  assert.equal(new RegExp(percent, 'i').test('axxb'), false);
  const underscore = containsTextImatch('a_b');
  assert.equal(new RegExp(underscore, 'i').test('a_b'), true);
  assert.equal(new RegExp(underscore, 'i').test('axb'), false);
});

test('God Index preserves mixed-case PDF paths for Storage download (Xeo 105)', () => {
  const xeo = {
    id: 105,
    storage_path: 'shared/cutera/xeo',
    is_folder: true,
    chapter_metadata: [
      { storage_path: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf' },
      { storage_path: 'shared/cutera/xeo/Xeo System Schematics RevB.pdf' },
    ],
  };
  assert.deepEqual(pdfPathsForManual(xeo), [
    'shared/cutera/xeo/Xeo Service Manual RevB.pdf',
    'shared/cutera/xeo/Xeo System Schematics RevB.pdf',
  ]);
  assert.equal(folderPrefixForManual(xeo), 'shared/cutera/xeo');
  assert.deepEqual(
    chapterPathsFromMetadata([{ storage_path: '/shared/cutera/xeo/Xeo Service Manual RevB.pdf' }]),
    ['shared/cutera/xeo/Xeo Service Manual RevB.pdf']
  );
});

test('asManualCatalogId accepts bigint catalog ids and rejects uuid', () => {
  assert.equal(asManualCatalogId(42), 42);
  assert.equal(asManualCatalogId('108'), 108);
  assert.equal(asManualCatalogId(108n), 108);
  assert.equal(asManualCatalogId(''), null);
  assert.equal(asManualCatalogId(null), null);
  assert.equal(asManualCatalogId('3fa85f64-5717-4562-b3fc-2c963f66afa6'), null);
  assert.equal(asManualCatalogId('not-a-number'), null);
});

test('reindex keeps a richer manual_search_index row instead of writing a worse extraction', async () => {
  assert.equal(shouldKeepExistingSearchText('short', ''), true);
  assert.equal(shouldKeepExistingSearchText('x'.repeat(2000), ''), true);
  assert.equal(shouldKeepExistingSearchText('x'.repeat(2000), 'y'.repeat(400)), true);
  assert.equal(shouldKeepExistingSearchText('x'.repeat(2000), 'y'.repeat(1200)), true);
  const cleaner = 'Check the laser power supply and replace the thermopile connection. '.repeat(8);
  assert.equal(cleaner.length < 2000 * 0.8, true);
  assert.equal(extractQualityImproves('x'.repeat(2000), cleaner), true);
  assert.equal(shouldKeepExistingSearchText('x'.repeat(2000), cleaner), false);
  assert.equal(searchTextWriteRefusal('x'.repeat(2000), cleaner), null);
  assert.equal(shouldKeepExistingSearchText('', 'fresh text'), false);

  let upserts = 0;
  const existing = 'CO2RE calibration '.repeat(80);
  const client = {
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: 'missing' } }),
          list: async () => ({ data: [], error: null }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { search_text: existing }, error: null }),
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  const result = await indexManualSearchText(client, {
    id: 17,
    storage_path: 'shared/candela/CO2RE.pdf',
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'kept_existing_index');
  assert.equal(result.chars, existing.trim().length);
  assert.equal(upserts, 0);
});

test('index upsert records the clip and retries when the columns are missing', async () => {
  const page1 = '[[pdfpage:1]] hello';
  const stored = storeIndexText(`${page1}\f[[pdfpage:2]] world past the cap`, page1.length + 4);
  assert.equal(stored.clipped, true);
  assert.equal(stored.indexedPageMax, 1);
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    from() {
      return {
        upsert(payload: Record<string, unknown>) {
          calls.push(payload);
          if (calls.length === 1) return { error: { message: 'column index_clipped does not exist' } };
          return { error: null };
        },
      };
    },
  };
  const saved = await upsertManualSearchIndex(db as never, 1, stored.text, stored);
  assert.equal(saved.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].index_clipped, true);
  assert.equal(calls[0].indexed_page_max, 1);
  assert.equal(Object.hasOwn(calls[1], 'index_clipped'), false);
  assert.equal(calls[1].search_text, stored.text);
});

test('stamped page merge is idempotent and ignores unstamped text', () => {
  const first = mergeStampedManualPages('loose text with no stamps', [{ page: 1, text: 'cover' }], 4);
  assert.match(first, /\[\[pdfpage:1\]\] cover/);
  assert.match(first, /\[\[pdfpage:4\]\]/);
  assert.equal((first.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 4);
  assert.doesNotMatch(first, /loose text/);
  const second = mergeStampedManualPages(first, [{ page: 3, text: 'CW Laser Power Too High' }], 4);
  assert.match(second, /\[\[pdfpage:1\]\] cover/);
  assert.match(second, /\[\[pdfpage:3\]\] CW Laser Power Too High/);
  const again = mergeStampedManualPages(second, [{ page: 3, text: 'CW Laser Power Too High' }], 4);
  assert.equal(again, second);
  const blanked = mergeStampedManualPages(second, [{ page: 3, text: '' }], 4);
  assert.match(blanked, /\[\[pdfpage:3\]\] CW Laser Power Too High/);
  const kept = assembleReindexedManual(new Map([[1, 'cover'], [3, '']]), 4, second);
  assert.match(kept, /\[\[pdfpage:3\]\] CW Laser Power Too High/);
});

test('a page-1 reindex drops index pages past the new total', () => {
  const existing = Array.from({ length: 519 }, (_, i) => `[[pdfpage:${i + 1}]] old ${i + 1}`).join('\f');
  const staged = new Map();
  for (let page = 1; page <= 517; page++) staged.set(page, `new ${page}`);
  const next = assembleReindexedManual(staged, 517, existing);
  const stamps = [...next.matchAll(/\[\[pdfpage:(\d+)\]\]/g)].map((match) => Number(match[1]));
  assert.equal(stamps.length, 517);
  assert.equal(Math.max(...stamps), 517);
  assert.equal(stamps.includes(518), false);
  assert.equal(stamps.includes(519), false);
  assert.match(next, /\[\[pdfpage:517\]\] new 517/);
  assert.doesNotMatch(next, /old 519/);

  const extended = assembleReindexedManual(new Map([[1, 'new one'], [6, 'six']]), 4, existing);
  assert.match(extended, /\[\[pdfpage:6\]\] six/);
  assert.match(extended, /\[\[pdfpage:2\]\] old 2/);
  assert.doesNotMatch(extended, /\[\[pdfpage:9\]\]/);
  assert.equal((extended.match(/\[\[pdfpage:/g) || []).length, 6);
});

function reindexHarness(opts?: { failPdf?: boolean; existing?: string }) {
  const pdfBytes = readFileSync(join(here, '..', 'public', MANUAL_FIXTURE_PATH.replace(/^\//, '')));
  const stage = new Map<string, string>();
  let upserts = 0;
  let failPdf = !!opts?.failPdf;
  const existing = opts?.existing ?? '';
  const client = {
    storage: {
      from() {
        return {
          download: async (path: string) => {
            if (String(path).endsWith('.json')) {
              const body = stage.get(path);
              if (!body) return { data: null, error: { message: 'missing' } };
              return { data: new Blob([body]), error: null };
            }
            if (failPdf) return { data: null, error: { message: 'missing' } };
            return { data: new Blob([new Uint8Array(pdfBytes)]), error: null };
          },
          list: async () => ({ data: [], error: null }),
          upload: async (path: string, body: string) => {
            stage.set(path, body);
            return { error: null };
          },
          remove: async (paths: string[]) => {
            for (const path of paths) stage.delete(path);
            return { error: null };
          },
        };
      },
    },
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({
          data: table === 'manual_search_index' ? { search_text: existing } : null,
          error: null,
        }),
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  return {
    client,
    get upserts() {
      return upserts;
    },
    set failPdf(value: boolean) {
      failPdf = value;
    },
    stage,
  };
}

const FIXTURE_MANUAL = { id: 17, storage_path: 'shared/candela/CO2RE.pdf' };

test('first-chunk-no-write', async () => {
  const harness = reindexHarness({ existing: `${'troubleshooting '.repeat(80)}` });
  const result = await reindexManualPageRange(harness.client, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  assert.equal(result.nextPage, 2);
  assert.equal(harness.upserts, 0);
  assert.equal(harness.stage.size, 1);
  const staged = JSON.parse([...harness.stage.values()][0]);
  assert.equal(staged.pages['1'] ? true : false, true);
  assert.equal(staged.pages['2'], undefined);
});

test('partial-failure-no-write', async () => {
  const harness = reindexHarness({ existing: `${'troubleshooting '.repeat(80)}` });
  const first = await reindexManualPageRange(harness.client, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 1 });
  assert.equal(first.ok, true);
  assert.equal(first.done, false);
  harness.failPdf = true;
  const failed = await reindexManualPageRange(harness.client, FIXTURE_MANUAL, { pageFrom: 2, pageCount: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.done, false);
  assert.equal(harness.upserts, 0);
  assert.equal(harness.stage.size, 1);
});

test('thin-result-refused', async () => {
  const existing = `${'troubleshooting thermopile calibration procedure '.repeat(80)}`;
  const harness = reindexHarness({ existing });
  const result = await reindexManualPageRange(harness.client, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 40 });
  assert.equal(result.ok, false);
  assert.equal(result.done, false);
  assert.match(result.error || '', /Refused to replace the manual index/);
  assert.match(result.error || '', /dictionary-word ratio|garbage ratio/);
  assert.doesNotMatch(result.error || '', /80%/);
  assert.equal(harness.upserts, 0);
  const spaced = `${'P o w e r T o o H i g h '.repeat(400)}`;
  assert.match(searchTextWriteRefusal(existing, spaced) || '', /single-letter/);
  assert.match(searchTextWriteRefusal(existing, '[[pdfpage:1]]') || '', /empty/);
  assert.equal(searchTextWriteRefusal('', `${'Power supply troubleshooting notes. '.repeat(30)}`), null);
});

test('single-manual page reindex never attaches the Grok collection', () => {
  const route = readFileSync(join(here, '../app/api/god/manuals/reindex-one/route.ts'), 'utf8');
  const godPage = readFileSync(join(here, '../app/admin/god/manuals/page.tsx'), 'utf8');
  assert.match(route, /requireGodCaller/);
  assert.match(route, /reindexManualPageRange/);
  assert.match(route, /manualId":17/);
  assert.doesNotMatch(route, /attachCollection|grok-assistant|xai_collection/);
  assert.match(godPage, /Reindex pages \(no Grok\)/);
  assert.match(godPage, /reindex-one/);
  assert.match(godPage, /catalog id 17/);
});

test('search API is catalog-wide and never returns PDF bodies or signed URLs', () => {
  const api = readFileSync(join(here, '../app/api/manuals/search/route.ts'), 'utf8');
  const reindex = readFileSync(join(here, '../app/api/god/manuals/reindex/route.ts'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260912_000000_manual_search_index.sql'),
    'utf8'
  );
  const bigintFix = readFileSync(
    join(here, '../supabase/migrations/20260912_000001_manual_search_index_bigint.sql'),
    'utf8'
  );
  assert.match(api, /canAccessServiceManuals|manualsAccess/);
  assert.doesNotMatch(api, /organization_manuals|user_manuals|get-manual-url/);
  assert.doesNotMatch(api, /select\(['"]search_text|json\.search_text/);
  assert.match(reindex, /requireGodCaller/);
  assert.match(reindex, /indexManualSearchText/);
  assert.match(reindex, /attachCollection/);
  assert.match(reindex, /afterId/);
  assert.match(migration, /manual_search_index/);
  assert.match(migration, /search_tsv/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /search_manual_catalog/);
  assert.match(migration, /manual_id bigint/);
  assert.match(migration, /RETURNS TABLE\(manual_id bigint\)/);
  assert.doesNotMatch(migration, /manual_id uuid/);
  assert.match(bigintFix, /DROP TABLE IF EXISTS public\.manual_search_index/);
  assert.match(bigintFix, /manual_id bigint PRIMARY KEY REFERENCES public\.manuals\(id\)/);
  assert.match(bigintFix, /RETURNS TABLE\(manual_id bigint\)/);
  assert.doesNotMatch(bigintFix, /manual_id uuid/);
});

function folderStorage(pdfs: Record<string, Buffer>, opts?: { existingError?: string; throwRead?: boolean }) {
  let upserts = 0;
  let saved = '';
  let downloaded = 0;
  let chapterMetadata: unknown = null;
  let lastUpsert: Record<string, unknown> | null = null;
  const client = {
    storage: {
      from() {
        return {
          download: async (path: string) => {
            downloaded += 1;
            const bytes = pdfs[path];
            if (!bytes) return { data: null, error: { message: 'missing' } };
            return { data: new Blob([new Uint8Array(bytes)]), error: null };
          },
          list: async (prefix: string) => ({
            data: Object.keys(pdfs)
              .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
              .map((path) => ({ name: path.slice(prefix.length + 1), id: path })),
            error: null,
          }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => {
          if (opts?.throwRead) throw new Error('connection reset');
          if (opts?.existingError) return { data: null, error: { message: opts.existingError } };
          return { data: null, error: null };
        },
        update(payload: { chapter_metadata?: unknown }) {
          chapterMetadata = payload?.chapter_metadata ?? null;
          return this;
        },
        upsert(payload: Record<string, unknown>) {
          upserts += 1;
          lastUpsert = payload;
          saved = String(payload?.search_text || '');
          return { error: null };
        },
      };
    },
  };
  return {
    client,
    get upserts() {
      return upserts;
    },
    get saved() {
      return saved;
    },
    get downloaded() {
      return downloaded;
    },
    get chapterMetadata() {
      return chapterMetadata;
    },
    get lastUpsert() {
      return lastUpsert;
    },
  };
}

test('folder manuals concatenate every PDF and continue physical page stamps', async () => {
  const intro = buildTextPdf(['intro reservoir']);
  const later = buildTextPdf(['error forty three', 'optical collimator']);
  const pdfs = {
    'shared/demo/10-later.pdf': later,
    'shared/demo/2-intro.pdf': intro,
  };
  const harness = folderStorage(pdfs);
  const manual = { id: 54, storage_path: 'shared/demo', is_folder: true };
  const indexed = await indexManualSearchText(harness.client, manual);
  assert.equal(indexed.ok, true);
  assert.equal(indexed.files, 2);
  assert.equal(harness.lastUpsert?.index_clipped, false);
  assert.equal(harness.lastUpsert?.indexed_page_max, 3);
  assert.match(harness.saved, /\[\[pdfpage:1\]\] intro reservoir/);
  assert.match(harness.saved, /\[\[pdfpage:2\]\] error forty three/);
  assert.match(harness.saved, /\[\[pdfpage:3\]\] optical collimator/);
  assert.equal((harness.saved.match(/\[\[pdfpage:\d+\]\]/g) || []).length, 3);

  const staged = folderStorage(pdfs);
  const stageClient = staged.client;
  const store = new Map<string, string>();
  const originalFrom = stageClient.storage.from.bind(stageClient.storage);
  stageClient.storage.from = () => {
    const base = originalFrom();
    return {
      ...base,
      download: async (path: string) => {
        if (String(path).endsWith('.json')) {
          const body = store.get(path);
          if (!body) return { data: null, error: { message: 'missing' } };
          return { data: new Blob([body]), error: null };
        }
        return base.download(path);
      },
      upload: async (path: string, body: string) => {
        store.set(path, body);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) store.delete(path);
        return { error: null };
      },
    };
  };
  const first = await reindexManualPageRange(stageClient, manual, { pageFrom: 1, pageCount: 1 });
  assert.equal(first.ok, true);
  assert.equal(first.done, false);
  assert.equal(first.nextPage, 2);
  assert.equal(first.totalPages, 3);
  const second = await reindexManualPageRange(stageClient, manual, { pageFrom: 2, pageCount: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.nextPage, 3);
  const third = await reindexManualPageRange(stageClient, manual, { pageFrom: 3, pageCount: 1 });
  assert.equal(third.ok, true);
  assert.equal(third.done, true);
  assert.match(staged.saved, /\[\[pdfpage:1\]\] intro reservoir/);
  assert.match(staged.saved, /\[\[pdfpage:2\]\] error forty three/);
  assert.match(staged.saved, /\[\[pdfpage:3\]\] optical collimator/);
});

test('chapter_metadata order is kept and page stamps continue across files', async () => {
  const harness = folderStorage({
    'shared/demo/a.pdf': buildTextPdf(['alpha reservoir']),
    'shared/demo/b.pdf': buildTextPdf(['beta collimator']),
  });
  const indexed = await indexManualSearchText(harness.client, {
    id: 8,
    storage_path: 'shared/demo',
    is_folder: true,
    chapter_metadata: [{ storage_path: 'shared/demo/b.pdf' }, { storage_path: 'shared/demo/a.pdf' }],
  });
  assert.equal(indexed.ok, true);
  assert.equal(indexed.files, 2);
  assert.match(harness.saved, /\[\[pdfpage:1\]\] beta collimator/);
  assert.match(harness.saved, /\[\[pdfpage:2\]\] alpha reservoir/);
  const stored = harness.chapterMetadata as Array<{ storage_path: string; page_count: number; page_start: number }>;
  assert.equal(stored[0].storage_path, 'shared/demo/b.pdf');
  assert.equal(stored[0].page_count, 1);
  assert.equal(stored[0].page_start, 1);
  assert.equal(stored[1].page_count, 1);
  assert.equal(stored[1].page_start, 2);
});

test('oversized PDFs fail with a limit message and are not truncated or written', async () => {
  assert.equal(manualPdfByteLimitError(MANUAL_SEARCH_PDF_MAX_BYTES), null);
  const message = manualPdfByteLimitError(MANUAL_SEARCH_PDF_MAX_BYTES + 1) || '';
  assert.match(message, /200 MB/);
  assert.match(message, /Netlify/);
  assert.match(message, /truncated/);
  let reads = 0;
  let upserts = 0;
  const client = {
    storage: {
      from() {
        return {
          download: async () => ({
            data: {
              size: MANUAL_SEARCH_PDF_MAX_BYTES + 1,
              arrayBuffer: async () => {
                reads += 1;
                return new ArrayBuffer(0);
              },
            },
            error: null,
          }),
          list: async () => ({ data: [], error: null }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  const indexed = await indexManualSearchText(client, { id: 9, storage_path: 'shared/huge.pdf' });
  assert.equal(indexed.ok, false);
  assert.match(indexed.skipped || '', /indexer limit/);
  assert.equal(reads, 0);
  assert.equal(upserts, 0);
  const ranged = await reindexManualPageRange(client, { id: 9, storage_path: 'shared/huge.pdf' }, { pageFrom: 1, pageCount: 1 });
  assert.equal(ranged.ok, false);
  assert.match(ranged.error || '', /indexer limit/);
  assert.equal(upserts, 0);
});

test('a manual_search_index read error fails closed and does not upsert', async () => {
  let upserts = 0;
  const client = {
    storage: {
      from() {
        return {
          download: async () => ({ data: null, error: { message: 'missing' } }),
          list: async () => ({ data: [], error: null }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => {
          throw new Error('connection reset');
        },
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  const indexed = await indexManualSearchText(client, { id: 9, storage_path: 'shared/missing.pdf' });
  assert.equal(indexed.ok, false);
  assert.match(indexed.skipped || '', /could not read the existing row/);
  assert.match(indexed.skipped || '', /connection reset/);
  assert.equal(upserts, 0);

  const pdfBytes = readFileSync(join(here, '..', 'public', MANUAL_FIXTURE_PATH.replace(/^\//, '')));
  const rangedClient = {
    storage: {
      from() {
        return {
          download: async (path: string) => {
            if (String(path).endsWith('.json')) return { data: null, error: { message: 'missing' } };
            return { data: new Blob([new Uint8Array(pdfBytes)]), error: null };
          },
          list: async () => ({ data: [], error: null }),
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
        };
      },
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: { message: 'timeout reading manual_search_index' } }),
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  const ranged = await reindexManualPageRange(rangedClient, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 40 });
  assert.equal(ranged.ok, false);
  assert.equal(ranged.done, false);
  assert.match(ranged.error || '', /could not read the existing row/);
  assert.match(ranged.error || '', /timeout reading manual_search_index/);
  assert.equal(upserts, 0);
});

test('md5 guard refuses a changed index and will not clip a multi-chunk write', async () => {
  let upserts = 0;
  const expected = indexTextMd5(['[[pdfpage:519]] tail']);
  const db = {
    rpc(_name, args) {
      assert.equal(args.p_manual_id, 72);
      assert.equal(args.p_expected_md5, expected);
      return { data: false, error: null };
    },
    from() {
      return {
        upsert() {
          upserts += 1;
          return { error: null };
        },
      };
    },
  };
  const refused = await writeManualSearchIndex(
    db,
    72,
    [{ chunkIndex: 0, text: '[[pdfpage:517]] end', clipped: false, indexedPageMax: 517 }],
    expected,
  );
  assert.equal(refused.ok, false);
  assert.match(refused.error || '', /md5/);
  assert.equal(upserts, 0);

  const missing = await writeManualSearchIndex(
    {
      from() {
        return {
          upsert() {
            upserts += 1;
            return { error: null };
          },
        };
      },
    },
    1,
    [
      { chunkIndex: 0, text: '[[pdfpage:1]] a', clipped: false, indexedPageMax: 1 },
      { chunkIndex: 1, text: '[[pdfpage:2]] b', clipped: false, indexedPageMax: 2 },
    ],
    null,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error || '', /Refused to clip/);
  assert.equal(upserts, 0);
});

test('chunk upsert drops chunk_index only for undefined_column', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const denied = {
    from() {
      return {
        upsert(payload: Record<string, unknown>) {
          calls.push(payload);
          return { error: { code: '42501', message: 'permission denied for column chunk_index' } };
        },
      };
    },
  };
  const blocked = await upsertManualSearchIndex(denied as never, 1, '[[pdfpage:1]] hello');
  assert.equal(blocked.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chunk_index, 0);

  const missing = {
    from() {
      return {
        upsert(payload: Record<string, unknown>) {
          calls.push(payload);
          if (payload.chunk_index !== undefined) {
            return {
              error: {
                code: '42703',
                message: 'column "chunk_index" of relation "manual_search_index" does not exist',
              },
            };
          }
          return { error: null };
        },
      };
    },
  };
  const saved = await upsertManualSearchIndex(missing as never, 1, '[[pdfpage:1]] hello');
  assert.equal(saved.ok, true);
  assert.equal(calls[2].chunk_index, undefined);
  assert.equal(calls[2].search_text, '[[pdfpage:1]] hello');
});

test('reindex refuses a chunk_index read that is not undefined_column', async () => {
  const existing = `${'troubleshooting '.repeat(40)}`;
  const harness = reindexHarness({ existing });
  let indexSingles = 0;
  const client = {
    storage: harness.client.storage,
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        order: async () => ({
          data: null,
          error: { code: '42501', message: 'permission denied for column chunk_index' },
        }),
        maybeSingle: async () => {
          if (table === 'manual_search_index') indexSingles += 1;
          return { data: table === 'manual_search_index' ? { search_text: existing } : null, error: null };
        },
        upsert() {
          return { error: null };
        },
      };
      return chain;
    },
  };
  const refused = await reindexManualPageRange(client as never, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.error || '', /could not read the existing row/);
  assert.equal(indexSingles, 0);
  assert.equal(harness.stage.size, 0);

  const fallback = {
    storage: harness.client.storage,
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        order: async () => ({
          data: null,
          error: {
            code: '42703',
            message: 'column "chunk_index" of relation "manual_search_index" does not exist',
          },
        }),
        maybeSingle: async () => ({
          data: table === 'manual_search_index' ? { search_text: existing } : null,
          error: null,
        }),
        upsert() {
          return { error: null };
        },
      };
      return chain;
    },
  };
  const result = await reindexManualPageRange(fallback as never, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  const staged = JSON.parse([...harness.stage.values()][0]);
  assert.equal(staged.expectedMd5, indexTextMd5([existing]));
});

test('page 1 of a reindex stores the md5 of the index it must replace', async () => {
  const existing = Array.from({ length: 3 }, (_, i) => `[[pdfpage:${i + 1}]] old ${i + 1}`).join('\f');
  const harness = reindexHarness({ existing });
  const result = await reindexManualPageRange(harness.client, FIXTURE_MANUAL, { pageFrom: 1, pageCount: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.done, false);
  const staged = JSON.parse([...harness.stage.values()][0]);
  assert.equal(staged.expectedMd5, indexTextMd5([existing]));
  assert.equal(harness.upserts, 0);
});

test('chunk migration keeps the lock timeout and the md5 replace function', () => {
  const migration = readFileSync(
    join(here, '../supabase/migrations/20261011_000913_manual_search_index_chunks.sql'),
    'utf8',
  );
  const rollback = readFileSync(
    join(here, '../supabase/migrations/20261011_000913_manual_search_index_chunks_rollback.sql'),
    'utf8',
  );
  const edge = readFileSync(join(here, '../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  const manualUrl = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /chunk_index/);
  assert.match(migration, /SELECT DISTINCT i\.manual_id/);
  assert.match(migration, /replace_manual_search_index/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /set_config\('lock_timeout', '5s', true\)/);
  assert.match(migration, /IS DISTINCT FROM p_expected_md5/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.replace_manual_search_index/);
  assert.match(migration, /service_role/);
  assert.doesNotMatch(migration, /\bCOMMIT\b/);
  assert.doesNotMatch(migration, /CONCURRENTLY/);
  assert.match(rollback, /SET LOCAL lock_timeout = '5s'/);
  assert.match(rollback, /DELETE FROM public\.manual_search_index WHERE chunk_index > 0/);
  assert.match(rollback, /DROP COLUMN IF EXISTS chunk_index/);
  assert.match(rollback, /PRIMARY KEY \(manual_id\)/);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/);
  assert.doesNotMatch(rollback, /CONCURRENTLY/);
  assert.match(edge, /loadJoinedSearchText/);
  assert.match(edge, /catalogManualIsPublished/);
  assert.match(edge, /reportedMissingColumn\(ordered\.error, 'chunk_index'\)/);
  assert.match(edge, /reportedMissingColumn\(idx\.error, 'chunk_index'\)/);
  assert.doesNotMatch(edge, /\/chunk_index\/i/);
  assert.match(manualUrl, /isMissingColumn\(listed\?\.error, "chunk_index"\)/);
  assert.match(manualUrl, /boundFromIndexRows/);
  const indexer = readFileSync(join(here, 'manual-search-index.ts'), 'utf8');
  assert.match(indexer, /isMissingColumn\(ordered\.error, 'chunk_index'\)/);
  assert.match(indexer, /isMissingColumn\(error, 'chunk_index'\)/);
  assert.match(migration, /20261011_000912_manual_search_index_clip\.sql/);

  const script = readFileSync(join(here, '../scripts/reindex-long-manuals.mjs'), 'utf8');
  assert.match(script, /reindexManualPageRange/);
  assert.match(script, /1157/);
  assert.match(script, /1621/);
  assert.match(script, /1207/);
  assert.match(script, /--apply/);
  assert.match(script, /20261011_000912_manual_search_index_clip\.sql/);
  assert.match(script, /20261011_000913_manual_search_index_chunks\.sql/);
  const dry = spawnSync(process.execPath, ['scripts/reindex-long-manuals.mjs'], {
    cwd: join(here, '..'),
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /manual 1 indexed_page_max 1157/);
  assert.match(dry.stdout, /manual 9 indexed_page_max 1621/);
  assert.match(dry.stdout, /manual 73 indexed_page_max 1207/);
  assert.match(dry.stdout, /Dry run/);
  const refused = spawnSync(process.execPath, ['scripts/reindex-long-manuals.mjs', '--apply'], {
    cwd: join(here, '..'),
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', NEXT_PUBLIC_SUPABASE_URL: '' },
  });
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stdout}\n${refused.stderr}`, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
});
