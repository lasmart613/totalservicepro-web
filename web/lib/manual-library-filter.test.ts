import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_MANUAL_ROOMS,
  filterManualLibrary,
  groupManualsByBrand,
  MANUAL_LIBRARY_SELECT,
  manualLibraryFiltersActive,
  manualLibrarySearchParams,
  manualMatchesQuery,
  parseManualLibrarySearchParams,
  uniqueManualBrands,
} from './manual-library-filter.ts';

const here = dirname(fileURLToPath(import.meta.url));

const CATALOG = [
  {
    id: '1',
    brand: 'Candela',
    title: 'VBeam Perfecta',
    model: 'Perfecta',
    equipment_type: 'laser',
    storage_path: 'shared/candela/vbeam-perfecta.pdf',
  },
  {
    id: '2',
    brand: 'GE OEC',
    title: 'OEC 9900',
    model: '9900',
    equipment_type: 'c_arm',
    storage_path: 'shared/ge-oec/9900.pdf',
  },
  {
    id: '3',
    brand: 'Dornier',
    title: 'H20 Service Manual',
    model: 'H20',
    equipment_type: 'laser',
    is_incomplete: true,
    storage_path: 'shared/dornier/h20.pdf',
  },
];

test('query matches title, make, and model (AND tokens)', () => {
  assert.equal(manualMatchesQuery(CATALOG[0], 'vbeam candela'), true);
  assert.equal(manualMatchesQuery(CATALOG[0], '9900'), false);
  assert.equal(manualMatchesQuery(CATALOG[1], 'oec 9900'), true);
});

test('filters AND together and search the full catalog, not owned ids', () => {
  const owned = new Set(['1']);
  const rows = filterManualLibrary(CATALOG, { query: '9900', room: 'c_arm' });
  assert.deepEqual(
    rows.map((r) => String(r.id)),
    ['2']
  );
  assert.equal(owned.has('2'), false);

  const narrowed = filterManualLibrary(CATALOG, { query: 'service', brand: 'Dornier', room: 'laser' });
  assert.deepEqual(
    narrowed.map((r) => String(r.id)),
    ['3']
  );

  const withBody = filterManualLibrary(CATALOG, { query: 'collimator', room: ALL_MANUAL_ROOMS }, new Set(['2']));
  assert.deepEqual(
    withBody.map((r) => String(r.id)),
    ['2']
  );
});

test('incomplete + make + all rooms', () => {
  const rows = filterManualLibrary(CATALOG, {
    brand: 'Dornier',
    room: ALL_MANUAL_ROOMS,
    incompleteOnly: true,
  });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].id), '3');
  assert.deepEqual(uniqueManualBrands(CATALOG), ['Candela', 'Dornier', 'GE OEC']);
  assert.deepEqual(Object.keys(groupManualsByBrand(rows)), ['Dornier']);
});

test('url params round-trip q / make / room=all', () => {
  const qs = manualLibrarySearchParams({
    query: 'collimator',
    brand: 'Candela',
    room: 'all',
    incompleteOnly: true,
  });
  assert.match(qs, /q=collimator/);
  assert.match(qs, /make=Candela/);
  assert.match(qs, /room=all/);
  assert.match(qs, /incomplete=1/);
  const parsed = parseManualLibrarySearchParams(`?${qs}`);
  assert.equal(parsed.query, 'collimator');
  assert.equal(parsed.brand, 'Candela');
  assert.equal(parsed.room, 'all');
  assert.equal(parsed.incompleteOnly, true);
  assert.equal(manualLibraryFiltersActive({ query: 'x' }), true);
  assert.equal(manualLibraryFiltersActive({ room: 'laser' }), false);
});

test('library page wires search UI and keeps open/get-manual-url gating', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const searchApi = readFileSync(join(here, '../app/api/manuals/search/route.ts'), 'utf8');
  assert.match(page, /filterManualLibrary/);
  assert.match(page, /\/api\/manuals\/search/);
  assert.match(page, /manuals-search/);
  assert.match(page, /All manufacturers|All makes/i);
  assert.match(page, /ALL_MANUAL_ROOMS|room === 'all'/);
  assert.match(page, /Clear filters/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /get-manual-url/);
  assert.match(page, /openInAppViewer|stashManualView/);
  assert.doesNotMatch(page, /search_text/);
  assert.match(page, /MANUAL_LIBRARY_SELECT/);
  assert.match(searchApi, /findManualIdsByBodyText|search_manual_catalog/);
  assert.match(searchApi, /canAccessServiceManuals/);
  assert.doesNotMatch(searchApi, /organization_manuals|user_manuals|get-manual-url/);
  assert.match(MANUAL_LIBRARY_SELECT, /brand, title, model/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT, /search_text/);
});
