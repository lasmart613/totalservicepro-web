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
  mergeStampedManualPages,
  pdfPathsForManual,
  reindexManualPageRange,
  searchTextWriteRefusal,
  shouldKeepExistingSearchText,
} from './manual-search-index.ts';
import { MANUAL_FIXTURE_PATH } from './manuals.ts';

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
  assert.equal(shouldKeepExistingSearchText('x'.repeat(2000), 'y'.repeat(1200)), false);
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
  assert.match(result.error || '', /80%/);
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
