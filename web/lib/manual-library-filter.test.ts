import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_MANUAL_ROOMS,
  filterManualLibrary,
  groupManualsByBrand,
  manufacturerShelves,
  MANUAL_LIBRARY_SELECT,
  MANUAL_LIBRARY_SELECT_LEGACY,
  MANUAL_LIBRARY_SELECT_WITH_KIND,
  MANUAL_LIBRARY_SELECT_WITH_LANGUAGE,
  fetchManualLibraryRows,
  isManualsSelectSchemaError,
  manualLibraryFiltersActive,
  manualLibrarySearchParams,
  manualMatchesQuery,
  manualSearchBodyQuery,
  parseManualLibrarySearchParams,
  manualLanguageOptionsForView,
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
  {
    id: '4',
    brand: 'Lasering',
    title: 'Lyra 767',
    model: '767',
    equipment_type: 'laser',
    storage_path: 'shared/lasering/lyra-767.pdf',
    doc_kind: 'operator',
  },
  {
    id: '5',
    brand: 'Quanta System',
    title: 'Litho IFU (EN)',
    model: 'Litho',
    equipment_type: 'laser',
    storage_path: 'shared/quanta-system/litho/ifu.pdf',
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
  assert.deepEqual(uniqueManualBrands(CATALOG), ['Candela', 'Dornier', 'GE OEC', 'Lasering', 'Quanta System']);
  assert.deepEqual(Object.keys(groupManualsByBrand(rows)), ['Dornier']);
});

test('manufacturer shelves sort A–Z case-insensitively and keep tie and spine order', () => {
  const rows = [
    { id: 'z', brand: 'Zebra', title: 'last' },
    { id: 'c1', brand: 'Candela', title: 'first-in-shelf' },
    { id: 'a', brand: 'alma' },
    { id: 'c2', brand: 'candela', title: 'other-shelf' },
    { id: 'c1b', brand: 'Candela', title: 'still-after-first' },
    { id: 'n', brand: '10 Medical' },
    { id: 'o', brand: '  ' },
  ];
  const shelves = manufacturerShelves(rows);
  assert.deepEqual(
    shelves.map((shelf) => shelf.brand),
    ['10 Medical', 'alma', 'Candela', 'candela', 'Other', 'Zebra']
  );
  assert.deepEqual(
    shelves.find((shelf) => shelf.brand === 'Candela')?.manuals.map((m) => m.id),
    ['c1', 'c1b']
  );
  assert.deepEqual(
    shelves.find((shelf) => shelf.brand === 'candela')?.manuals.map((m) => m.title),
    ['other-shelf']
  );
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
  assert.equal(parsed.library, 'service');
  assert.equal(manualLibraryFiltersActive({ query: 'x' }), true);
  assert.equal(manualLibraryFiltersActive({ room: 'laser' }), false);

  const opQs = manualLibrarySearchParams({ library: 'operators', room: 'laser' });
  assert.match(opQs, /lib=operators/);
  assert.equal(parseManualLibrarySearchParams(`?${opQs}`).library, 'operators');
});

test('instruction / IFU / operating-instructions rows shelf to Operators; hybrids stay Service', () => {
  const rows = [
    { id: '204', title: 'CL-100 Computerized Lensmeter Instruction Manual' },
    {
      id: '662',
      title: 'Siemens SONOLINE Antares Gebruiksaanwijzing (Dutch IFU/Operator; not service manual)',
    },
    { id: '712', title: 'Matrix CO2 Surgical Laser System Operating Instructions' },
    { id: '716', title: 'VRM III Operating Instructions' },
    { id: '740', title: 'Penlon Sigma Elite Vaporizer User Instruction Manual' },
    {
      id: '769',
      title: 'Ellman Surgitron 4.0 Dual RF 120 Instruction Manual (incomplete; OP/instruction — not full SM)',
    },
    { id: '4', brand: 'Lasering', title: 'Lyra 767' },
    { id: '131', title: 'StarWalker Operator / Service' },
    { id: '545', title: 'Zimmer A.T.S. Operator & Service Manuals' },
    { id: '504', title: 'MRL Portable Defibrillator Service Instruction Manual' },
  ];
  const service = filterManualLibrary(rows, { room: ALL_MANUAL_ROOMS, library: 'service' });
  const operators = filterManualLibrary(rows, { room: ALL_MANUAL_ROOMS, library: 'operators' });
  assert.deepEqual(
    service.map((r) => String(r.id)).sort(),
    ['131', '504', '545']
  );
  assert.deepEqual(
    operators.map((r) => String(r.id)).sort(),
    ['204', '4', '662', '712', '716', '740', '769']
  );
  const lyraOnService = filterManualLibrary(rows, { query: 'lyra', library: 'service', room: ALL_MANUAL_ROOMS });
  assert.equal(lyraOnService.length, 0);
  const lyraOnOps = filterManualLibrary(rows, { query: 'lyra', library: 'operators', room: ALL_MANUAL_ROOMS });
  assert.equal(String(lyraOnOps[0]?.id), '4');
});

test('Service and Operators are separate library shelves', () => {
  const service = filterManualLibrary(CATALOG, { room: ALL_MANUAL_ROOMS, library: 'service' });
  const operators = filterManualLibrary(CATALOG, { room: ALL_MANUAL_ROOMS, library: 'operators' });
  assert.deepEqual(
    service.map((r) => String(r.id)).sort(),
    ['1', '2', '3']
  );
  assert.deepEqual(
    operators.map((r) => String(r.id)).sort(),
    ['4', '5']
  );
  const lyraOnService = filterManualLibrary(CATALOG, { query: 'lyra', library: 'service', room: ALL_MANUAL_ROOMS });
  assert.equal(lyraOnService.length, 0);
  const lyraOnOps = filterManualLibrary(CATALOG, { query: 'lyra', library: 'operators', room: ALL_MANUAL_ROOMS });
  assert.equal(String(lyraOnOps[0]?.id), '4');
});

test('language filter defaults to all and still matches brand and model', () => {
  const rows = [
    { id: 'en', brand: 'Candela', title: 'GentleMax Pro', model: 'GentleMax', language: 'en' },
    { id: 'de', brand: 'Candela', title: 'GentleMax Pro (German)', model: 'GentleMax', language: 'de' },
    { id: 'es', brand: 'Candela', title: 'GentleMax Pro', model: 'GentleMax', language: 'es' },
    { id: 'other', brand: 'Lumenis', title: 'UltraPulse (Spanish)', model: 'UltraPulse', language: 'es' },
  ];
  const all = filterManualLibrary(rows, { query: 'candela gentlemax', room: ALL_MANUAL_ROOMS, language: 'all' });
  assert.deepEqual(
    all.map((r) => String(r.id)),
    ['en', 'de', 'es']
  );
  const german = filterManualLibrary(rows, { query: 'gentlemax', room: ALL_MANUAL_ROOMS, language: 'de' });
  assert.deepEqual(
    german.map((r) => String(r.id)),
    ['de']
  );
  const spanish = filterManualLibrary(rows, { query: 'lumenis', room: ALL_MANUAL_ROOMS, language: 'es' });
  assert.deepEqual(
    spanish.map((r) => String(r.id)),
    ['other']
  );
  assert.equal(manualLibraryFiltersActive({ language: 'de' }), true);
  assert.equal(manualLibraryFiltersActive({ language: 'all' }), false);
  assert.equal(manualLibraryFiltersActive({}), false);
  const qs = manualLibrarySearchParams({ language: 'de', room: 'laser', query: 'gentlemax' });
  assert.match(qs, /lang=de/);
  assert.equal(parseManualLibrarySearchParams(`?${qs}`).language, 'de');
  assert.equal(parseManualLibrarySearchParams('?lang=all').language, '');

  const rowsWithWord = [
    { id: 'en-word', brand: 'Candela', title: 'Spanish Inquisition Laser', model: 'Inquisition', language: 'en' },
    { id: 'es', brand: 'Candela', title: 'GentleMax Pro', model: 'GentleMax', language: 'es' },
    { id: 'es-title', brand: 'Lumenis', title: 'UltraPulse (Spanish)', model: 'UltraPulse', language: 'es' },
    { id: 'de', brand: 'Candela', title: 'GentleMax Pro (German)', model: 'GentleMax', language: 'de' },
  ];
  const bodyHits = new Set(['en-word']);
  assert.deepEqual(
    filterManualLibrary(rowsWithWord, { query: 'spanish', room: ALL_MANUAL_ROOMS }, bodyHits).map((r) => String(r.id)),
    ['es', 'es-title']
  );
  assert.deepEqual(
    filterManualLibrary(rowsWithWord, { query: 'español', room: ALL_MANUAL_ROOMS }, bodyHits).map((r) => String(r.id)),
    ['es', 'es-title']
  );
  assert.deepEqual(
    filterManualLibrary(rowsWithWord, { query: 'candela spanish', room: ALL_MANUAL_ROOMS }, bodyHits).map((r) =>
      String(r.id)
    ),
    ['es']
  );
  assert.deepEqual(
    filterManualLibrary(rowsWithWord, { query: 'deutsch', room: ALL_MANUAL_ROOMS }, bodyHits).map((r) => String(r.id)),
    ['de']
  );
  assert.equal(manualSearchBodyQuery('spanish'), '');
  assert.equal(manualSearchBodyQuery('candela spanish'), 'candela');
});

test('language menu lists only languages in the current room and tab', () => {
  const rows = [
    {
      id: 1043,
      title: 'ACUSON Sequoia Service Manual (Chinese)',
      language: 'zh',
      equipment_type: 'ultrasound',
      brand: 'Siemens',
      model: 'Sequoia',
    },
    {
      id: 2001,
      title: 'Probe (Service Manual, Chinese)',
      language: 'en',
      equipment_type: 'ultrasound',
      brand: 'Siemens',
      model: 'Probe',
    },
    {
      id: 2002,
      title: 'ACUSON Service Manual',
      language: 'en',
      equipment_type: 'ultrasound',
      brand: 'Siemens',
      model: 'ACUSON',
    },
    {
      id: 11,
      title: 'GentleMax Pro (Spanish)',
      language: 'es',
      equipment_type: 'laser',
      brand: 'Candela',
      model: 'GentleMax',
    },
    {
      id: 12,
      title: 'GentleMax Pro (Portuguese)',
      language: 'pt',
      equipment_type: 'laser',
      brand: 'Candela',
      model: 'GentleMax',
    },
    {
      id: 13,
      title: 'Compact Delta Service Manual',
      language: 'en',
      equipment_type: 'lithotriptor',
      brand: 'Dornier',
      model: 'Compact Delta',
    },
    {
      id: 14,
      title: 'Lyra Operator Manual',
      language: 'en',
      equipment_type: 'laser',
      brand: 'Candela',
      model: 'Lyra',
    },
  ];
  const values = (options: { value: string }[]) => options.map((option) => option.value);

  const ultrasound = values(manualLanguageOptionsForView(rows, { room: 'ultrasound', library: 'service' }));
  assert.equal(ultrasound[0], 'all');
  assert.ok(ultrasound.includes('zh'));
  assert.equal(ultrasound.includes('es'), false);
  assert.equal(ultrasound.includes('pt'), false);

  const laser = values(manualLanguageOptionsForView(rows, { room: 'laser', library: 'service' }));
  assert.equal(laser.includes('zh'), false);
  assert.ok(laser.includes('es'));
  assert.ok(laser.includes('pt'));

  const litho = values(manualLanguageOptionsForView(rows, { room: 'lithotriptor', library: 'service' }));
  assert.deepEqual(litho, ['all', 'en']);

  const operators = values(manualLanguageOptionsForView(rows, { room: 'all', library: 'operators' }));
  assert.equal(operators.includes('es'), false);
  assert.equal(operators.includes('pt'), false);
  assert.equal(operators.includes('zh'), false);
  assert.deepEqual(operators, ['all', 'en']);
});

test('mobile spine language badge stays inside its spine and ignores taps', () => {
  const cssPath = join(here, '../app/globals.css');
  const css = readFileSync(cssPath, 'utf8');
  const start = css.indexOf('.book {');
  const end = css.indexOf('.wl-stripes {');
  assert.ok(start > 0 && end > start);
  const rules = css.slice(start, end);
  const dir = mkdtempSync(join(tmpdir(), 'manual-badge-'));
  const htmlPath = join(dir, 'badge.html');
  writeFileSync(
    htmlPath,
    `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${rules}
.book { position: relative; }
.row { display: flex; align-items: flex-end; gap: 0; width: 100px; }
</style>
</head>
<body>
<div class="row">
  <div class="book" style="width:50px">
    <div class="book-spine" style="width:50px;height:138px">
      <div class="book-title">Candela GentleMax Pro Service Manual</div>
    </div>
    <div class="manual-language-badge">DE</div>
  </div>
  <div class="book" id="next" style="width:50px">
    <div class="book-spine" style="width:50px;height:138px">
      <div class="book-title">Next</div>
    </div>
  </div>
</div>
<pre id="measure"></pre>
<script>
  const badge = document.querySelector('.manual-language-badge');
  const spine = document.querySelector('.book-spine');
  const title = document.querySelector('.book-title');
  const next = document.querySelector('#next');
  const br = badge.getBoundingClientRect();
  const sr = spine.getBoundingClientRect();
  const tr = title.getBoundingClientRect();
  const nr = next.getBoundingClientRect();
  const style = getComputedStyle(badge);
  const eps = 0.6;
  const inside = br.width > 0 && br.left >= sr.left - eps && br.right <= sr.right + eps && br.top >= sr.top - eps && br.bottom <= sr.bottom + eps;
  const hitsNext = br.right > nr.left + eps && br.left < nr.right - eps && br.bottom > nr.top + eps && br.top < nr.bottom - eps;
  const hitsTitle = br.right > tr.left + eps && br.left < tr.right - eps && br.bottom > tr.top + eps && br.top < tr.bottom - eps;
  document.getElementById('measure').textContent = JSON.stringify({
    inside, hitsNext, hitsTitle,
    pointer: style.pointerEvents,
    fontSize: parseFloat(style.fontSize),
    height: br.height
  });
</script>
</body>
</html>`
  );
  const chrome = spawnSync(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=390,844',
      '--virtual-time-budget=800',
      '--dump-dom',
      `file://${htmlPath}`,
    ],
    { encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(chrome.status, 0, chrome.stderr || chrome.stdout);
  const match = String(chrome.stdout).match(/<pre id="measure">([^<]+)<\/pre>/);
  assert.ok(match, chrome.stdout.slice(0, 500));
  const box = JSON.parse(match[1].replace(/&quot;/g, '"'));
  assert.equal(box.inside, true);
  assert.equal(box.hitsNext, false);
  assert.equal(box.hitsTitle, false);
  assert.equal(box.pointer, 'none');
  assert.ok(box.height >= 20 && box.height <= 24, `height ${box.height}`);
  assert.ok(box.fontSize >= 10 && box.fontSize <= 11, `font ${box.fontSize}`);
});

test('library page wires search UI and keeps open/get-manual-url gating', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const searchApi = readFileSync(join(here, '../app/api/manuals/search/route.ts'), 'utf8');
  assert.match(page, /manufacturerShelves/);
  assert.match(page, /companyLibraryOpenNeedsAdd/);
  assert.match(page, /filterManualLibrary/);
  assert.match(page, /\/api\/manuals\/search/);
  assert.match(page, /manuals-search/);
  assert.match(page, /manuals-rail/);
  assert.match(page, /All manufacturers|All makes/i);
  assert.match(page, /manuals-language/);
  assert.match(page, /manualLanguageOptionsForView\(sourceManuals, \{ room, library \}\)/);
  assert.match(page, /manualLanguageBadge/);
  assert.match(page, /manualSearchBodyQuery/);
  assert.match(page, /manual-language-badge/);
  assert.match(page, /setSelectedLanguage\(''\)/);
  assert.match(page, /syncFilterUrl\(\{ language: '' \}\)/);
  const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
  assert.match(css, /\.manual-language-badge/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /\.manual-language-chip[\s\S]*min-height:\s*44px/);
  assert.doesNotMatch(css, /\.manual-language-badge[\s\S]{0,400}min-width:\s*44px/);
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /manual-language-chip/);
  const languageLib = readFileSync(join(here, 'manual-language.ts'), 'utf8');
  assert.match(languageLib, /All languages/);
  assert.match(page, /ALL_MANUAL_ROOMS|room === 'all'/);
  assert.match(page, /Clear filters/);
  assert.match(page, /Operators Manuals/);
  assert.match(page, /selectLibrary/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /get-manual-url/);
  assert.match(page, /openInAppViewer|stashManualView/);
  assert.doesNotMatch(page, /search_text/);
  assert.match(page, /fetchManualLibraryRows/);
  assert.match(searchApi, /findManualIdsByBodyText|search_manual_catalog/);
  assert.match(searchApi, /canAccessServiceManuals|manualsAccess/);
  assert.match(searchApi, /filterManualsForCaller|manualsAccess/);
  assert.doesNotMatch(searchApi, /organization_manuals|user_manuals|get-manual-url/);
  assert.match(MANUAL_LIBRARY_SELECT, /brand, title, model/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT, /search_text/);
  const filterLib = readFileSync(join(here, 'manual-library-filter.ts'), 'utf8');
  assert.doesNotMatch(filterLib, /manual-pdf-text|node:zlib|inflateSync/);
});

test('catalog select matches live manuals columns and retries only on schema errors', async () => {
  assert.match(MANUAL_LIBRARY_SELECT_WITH_LANGUAGE, /language/);
  assert.match(MANUAL_LIBRARY_SELECT_WITH_LANGUAGE, /doc_kind/);
  assert.match(MANUAL_LIBRARY_SELECT_WITH_KIND, /doc_kind/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT_WITH_KIND, /\blanguage\b/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT, /doc_kind|description|completeness_note|language/);
  assert.doesNotMatch(MANUAL_LIBRARY_SELECT_LEGACY, /doc_kind/);
  assert.match(MANUAL_LIBRARY_SELECT, /equipment_type/);
  assert.match(MANUAL_LIBRARY_SELECT, /wavelengths/);
  assert.equal(
    isManualsSelectSchemaError("Could not find the 'doc_kind' column of 'manuals' in the schema cache"),
    true
  );
  assert.equal(
    isManualsSelectSchemaError("Could not find the 'language' column of 'manuals' in the schema cache"),
    true
  );
  assert.equal(isManualsSelectSchemaError('JWT expired'), false);

  const ok = await fetchManualLibraryRows(async (select) => {
    assert.equal(select, MANUAL_LIBRARY_SELECT_WITH_LANGUAGE);
    return { data: [{ id: 1 }, { id: 2 }], error: null };
  });
  assert.equal(ok.error, null);
  assert.equal(ok.data.length, 2);

  const languageMissing: string[] = [];
  const withoutLanguage = await fetchManualLibraryRows(async (select) => {
    languageMissing.push(select);
    if (select.includes('language')) {
      return {
        data: [],
        error: { message: "Could not find the 'language' column of 'manuals' in the schema cache" },
      };
    }
    return { data: [{ id: 9 }], error: null };
  });
  assert.equal(withoutLanguage.error, null);
  assert.deepEqual(
    withoutLanguage.data.map((r) => (r as { id: number }).id),
    [9]
  );
  assert.deepEqual(languageMissing, [MANUAL_LIBRARY_SELECT_WITH_LANGUAGE, MANUAL_LIBRARY_SELECT_WITH_KIND]);

  const calls: string[] = [];
  const retried = await fetchManualLibraryRows(async (select) => {
    calls.push(select);
    if (select.includes('language') || select.includes('doc_kind')) {
      return {
        data: [],
        error: { message: "Could not find the 'doc_kind' column of 'manuals' in the schema cache" },
      };
    }
    return { data: [{ id: 4 }], error: null };
  });
  assert.equal(retried.error, null);
  assert.deepEqual(
    retried.data.map((r) => (r as { id: number }).id),
    [4]
  );
  assert.deepEqual(calls, [
    MANUAL_LIBRARY_SELECT_WITH_LANGUAGE,
    MANUAL_LIBRARY_SELECT_WITH_KIND,
    MANUAL_LIBRARY_SELECT,
  ]);
});
