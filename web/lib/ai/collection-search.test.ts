import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'url';
import {
  applyFileNameMap,
  chapterFileKeys,
  collectionFilenameForPath,
  collectionHitsFromResponse,
  COLLECTION_NAME_FILTER_MAX,
  collectionNameFilters,
  collectionSearchBody,
  displayAttachedName,
  docHasForeignModel,
  docMatchesManual,
  expectedFilenamesForPaths,
  fileIdNameMapFromDocuments,
  filterHitsForManual,
  hasEnoughScopedIds,
  namesAlign,
  pickCollectionAttachments,
  pickFileIdsForManual,
  retrievedFromHits,
} from '../../../supabase/functions/grok-assistant/collection-search.ts';

const here = dirname(fileURLToPath(import.meta.url));

const XEO_HITS = {
  matches: [
    {
      file_id: 'file_xeo_sm',
      chunk_id: 'chunk-322',
      chunk_content:
        'Fault 322 — Flow Switch: Check the cooling-system flow switch and harness. If open, the IPL will not fire.',
      score: 1.2,
      fields: {},
    },
    {
      file_id: 'file_other',
      chunk_content: 'Some other laser error table that is long enough to count as a passage.',
      score: 0.4,
      fields: { filename: 'candela_vbeam_service.pdf' },
    },
  ],
};

const XEO_CHAPTERS = [
  { storage_path: 'shared/cutera/xeo/Xeo Service Manual RevB.pdf' },
  { storage_path: 'shared/cutera/xeo/Xeo System Schematics RevB.pdf' },
];
const XEO_PATHS = XEO_CHAPTERS.map((c) => c.storage_path);
const COOLGLIDE_15 = 'Cutera CoolGlide Service Manual Complete.pdf';
const COOLGLIDE_PATH = 'shared/cutera/coolglide/Cutera CoolGlide Service Manual Complete.pdf';

test('parses live xAI matches/chunk_content (old results/text parser would miss these)', () => {
  const hits = collectionHitsFromResponse(XEO_HITS);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].fileId, 'file_xeo_sm');
  assert.match(hits[0].text, /Fault 322/);
  assert.equal(hits[0].source, '');

  const legacyEmpty = collectionHitsFromResponse({
    results: [],
    documents: [],
    chunks: [],
    data: [],
  });
  assert.equal(legacyEmpty.length, 0);

  const legacyShape = collectionHitsFromResponse({
    results: [{ text: 'Legacy passage about fault 367 that is long enough.', document_name: 'Xeo_Service_Manual_RevB.pdf' }],
  });
  assert.equal(legacyShape[0].source, 'Xeo_Service_Manual_RevB.pdf');
});

test('Xeo 105 chapter keys match sanitized collection filenames without cutera in the name', () => {
  const keys = chapterFileKeys(XEO_CHAPTERS);
  const filename = collectionFilenameForPath('shared/cutera/xeo/Xeo Service Manual RevB.pdf');
  assert.equal(filename, 'Xeo_Service_Manual_RevB.pdf');
  assert.equal(docMatchesManual(filename, ['cutera', 'xeo'], keys), true);
  assert.equal(docMatchesManual('Xeo_System_Schematics_RevB.pdf', ['cutera', 'xeo'], keys), true);
  assert.equal(
    docMatchesManual(filename, ['cutera', 'xeo'], []),
    false,
    'short model token xeo alone is not enough without chapter keys or file_ids'
  );
  assert.equal(docMatchesManual('lumenis_ultrapulse_encore.pdf', ['cutera', 'xeo'], keys), false);
});

test('file_id map scopes collection hits to the selected Xeo PDFs even when search omits names', () => {
  const unnamed = collectionHitsFromResponse(XEO_HITS);
  const docs = {
    documents: [
      { file_metadata: { file_id: 'file_xeo_sm', name: 'Xeo_Service_Manual_RevB.pdf' } },
      { file_metadata: { file_id: 'file_xeo_sch', name: 'Xeo_System_Schematics_RevB.pdf' } },
    ],
  };
  const nameById = fileIdNameMapFromDocuments(docs);
  const expected = XEO_CHAPTERS.map((c) => collectionFilenameForPath(c.storage_path));
  const keys = chapterFileKeys(XEO_CHAPTERS);
  const fileIds = pickFileIdsForManual(nameById, expected, ['cutera', 'xeo'], keys);
  assert.equal(fileIds.has('file_xeo_sm'), true);
  assert.equal(fileIds.has('file_xeo_sch'), true);

  const named = applyFileNameMap(unnamed, nameById);
  const filtered = filterHitsForManual(named, {
    tokens: ['cutera', 'xeo'],
    chapterKeys: keys,
    fileIds,
    requireMatch: true,
  });
  assert.equal(filtered.parts.length, 1);
  assert.match(filtered.parts[0].text, /Fault 322/);
  assert.match(retrievedFromHits(filtered.parts)[0].source, /Xeo_Service_Manual/);
  assert.ok(filtered.filteredOut >= 1);
});

test('search body uses limit so xAI returns more than the default 10 chunks', () => {
  const body = collectionSearchBody('Cutera Xeo fault 322 367', 'collection_4d71cef6-a546-4b8c-9e08-f9c4e77a0c5e');
  assert.equal(body.limit, 20);
  assert.equal(body.retrieval_mode.type, 'hybrid');
  assert.deepEqual(body.source.collection_ids, ['collection_4d71cef6-a546-4b8c-9e08-f9c4e77a0c5e']);
  assert.ok(collectionNameFilters(XEO_CHAPTERS.map((c) => collectionFilenameForPath(c.storage_path)), ['xeo']).includes('Xeo Service Manual RevB'));
});

test('collection attach prefers the service manual unless the question is schematic', () => {
  const names = {
    file_sm: 'Xeo_Service_Manual_RevB.pdf',
    file_sch: 'Xeo_System_Schematics_RevB.pdf',
  };
  const ids = new Set(['file_sm', 'file_sch']);
  assert.equal(pickCollectionAttachments(names, ids, false, 1)[0].fileId, 'file_sm');
  assert.equal(pickCollectionAttachments(names, ids, true, 1)[0].fileId, 'file_sch');
});

test('grok-assistant chat uses collection file_ids and does not require manual_search_index', () => {
  const fn = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');
  assert.match(fn, /from '\.\/collection-search\.ts'/);
  assert.match(fn, /pdfPathsForChat/);
  assert.match(fn, /resolveCollectionManualDocs/);
  assert.match(fn, /collectionSearchBody/);
  assert.match(fn, /hasCollectionPdfs/);
  assert.match(fn, /expectedFilenamesForPaths/);
  assert.match(fn, /already_in_collection/);
  assert.match(fn, /fetchWithTimeout/);
  assert.match(fn, /listCollectionDocumentsAll/);
  assert.match(fn, /collectionDocsCache/);
  assert.match(fn, /Promise\.all\(\[searchP, resolveP\]\)/);
  assert.match(fn, /withBudget/);
});

test('Xeo 105 file_id resolve does not pick CoolGlide 15 from the shared collection', () => {
  const expected = expectedFilenamesForPaths(XEO_PATHS);
  assert.ok(expected.includes('Xeo Service Manual RevB.pdf'));
  assert.ok(expected.includes('Xeo_Service_Manual_RevB.pdf'));

  const filters = collectionNameFilters(expected, ['cutera', 'xeo']);
  assert.ok(filters.some((f) => /xeo service manual/i.test(f)));
  assert.equal(
    filters.some((f) => compactIsBrand(f)),
    false,
    'name:"cutera" must not be used — it lists CoolGlide 15'
  );
  assert.equal(filters.includes('cutera'), false);
  assert.equal(filters.includes('xeo'), false);

  assert.equal(namesAlign('Xeo Service Manual RevB.pdf', 'Xeo_Service_Manual_RevB.pdf'), true);
  assert.equal(namesAlign('cutera', COOLGLIDE_15), false);
  assert.equal(namesAlign('Xeo Service Manual RevB.pdf', COOLGLIDE_15), false);

  const nameById = {
    file_xeo_sm: 'Xeo_Service_Manual_RevB.pdf',
    file_xeo_sch: 'Xeo_System_Schematics_RevB.pdf',
    file_cg_15: COOLGLIDE_15,
  };
  const keys = chapterFileKeys(XEO_CHAPTERS);
  const fileIds = pickFileIdsForManual(nameById, expected, ['cutera', 'xeo'], keys);
  assert.equal(fileIds.has('file_xeo_sm'), true);
  assert.equal(fileIds.has('file_xeo_sch'), true);
  assert.equal(fileIds.has('file_cg_15'), false, 'CoolGlide 15 file_id must stay out of Xeo 105 scope');

  assert.equal(docMatchesManual(COOLGLIDE_15, ['cutera', 'xeo'], keys), false);
  assert.equal(docHasForeignModel(COOLGLIDE_15, ['cutera', 'xeo']), true);
  assert.equal(docHasForeignModel('Xeo_Service_Manual_RevB.pdf', ['cutera', 'xeo']), false);

  const mixedHits = [
    {
      text: 'Fault 322 — Flow Switch: Check the cooling-system flow switch and harness.',
      source: '',
      fileId: 'file_xeo_sm',
    },
    {
      text: 'Fault 322 CoolGlide Ch.12 error-code table that is long enough to keep.',
      source: COOLGLIDE_15,
      fileId: 'file_cg_15',
    },
  ];
  const named = applyFileNameMap(mixedHits, nameById);
  const filtered = filterHitsForManual(named, {
    tokens: ['cutera', 'xeo'],
    chapterKeys: keys,
    fileIds,
    expectedFilenames: expected,
    requireMatch: true,
  });
  assert.equal(filtered.parts.length, 1);
  assert.equal(filtered.parts[0].fileId, 'file_xeo_sm');
  assert.match(retrievedFromHits(filtered.parts, expected)[0].source, /Xeo Service Manual RevB\.pdf/);
  assert.doesNotMatch(retrievedFromHits(filtered.parts, expected)[0].source, /CoolGlide/i);
  assert.equal(displayAttachedName('Xeo_Service_Manual_RevB.pdf', expected), 'Xeo Service Manual RevB.pdf');

  const cgExpected = expectedFilenamesForPaths([COOLGLIDE_PATH]);
  const cgIds = pickFileIdsForManual(nameById, cgExpected, ['cutera', 'coolglide'], []);
  assert.equal(cgIds.has('file_cg_15'), true);
  assert.equal(cgIds.has('file_xeo_sm'), false);
});

test('name filters stay few and compact-deduped so chat does not issue N serial GETs', () => {
  const expected = expectedFilenamesForPaths(XEO_PATHS);
  const filters = collectionNameFilters(expected, ['cutera', 'xeo']);
  assert.ok(filters.length <= COLLECTION_NAME_FILTER_MAX);
  assert.equal(filters.length, 2, 'Xeo service + schematics only — not 4 storage/sanitized variants');
  assert.equal(new Set(filters.map((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, ''))).size, filters.length);
  assert.ok(filters.some((f) => /xeo service manual/i.test(f)));
  assert.equal(filters.some((f) => compactIsBrand(f)), false);

  const many = expectedFilenamesForPaths([
    ...XEO_PATHS,
    'shared/cutera/xeo/Xeo Extra 1.pdf',
    'shared/cutera/xeo/Xeo Extra 2.pdf',
    'shared/cutera/xeo/Xeo Extra 3.pdf',
    'shared/cutera/xeo/Xeo Extra 4.pdf',
    'shared/cutera/xeo/Xeo Extra 5.pdf',
    'shared/cutera/xeo/Xeo Extra 6.pdf',
  ]);
  assert.ok(many.length >= 8);
  assert.equal(collectionNameFilters(many, ['cutera']).length <= COLLECTION_NAME_FILTER_MAX, true);
  assert.equal(hasEnoughScopedIds(new Set(['file_xeo_sm'])), true);
  assert.equal(hasEnoughScopedIds(new Set()), false);
});

function compactIsBrand(value: string): boolean {
  return ['cutera', 'candela', 'cynosure'].includes(value.toLowerCase().replace(/[^a-z0-9]+/g, ''));
}
