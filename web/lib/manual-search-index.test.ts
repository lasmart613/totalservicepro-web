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
  pdfPathsForManual,
  shouldKeepExistingSearchText,
} from './manual-search-index.ts';

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
