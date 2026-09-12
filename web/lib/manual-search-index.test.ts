import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chapterPathsFromMetadata,
  escapeIlike,
  folderPrefixForManual,
  pdfPathsForManual,
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

test('search API is catalog-wide and never returns PDF bodies or signed URLs', () => {
  const api = readFileSync(join(here, '../app/api/manuals/search/route.ts'), 'utf8');
  const reindex = readFileSync(join(here, '../app/api/god/manuals/reindex/route.ts'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260912_000000_manual_search_index.sql'),
    'utf8'
  );
  assert.match(api, /canAccessServiceManuals/);
  assert.doesNotMatch(api, /organization_manuals|user_manuals|get-manual-url/);
  assert.doesNotMatch(api, /select\(['"]search_text|json\.search_text/);
  assert.match(reindex, /requireGodCaller/);
  assert.match(reindex, /indexManualSearchText/);
  assert.match(migration, /manual_search_index/);
  assert.match(migration, /search_tsv/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /search_manual_catalog/);
});
