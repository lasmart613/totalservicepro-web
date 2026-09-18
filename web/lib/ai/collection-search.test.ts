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
  collectionNameFilters,
  collectionSearchBody,
  docMatchesManual,
  fileIdNameMapFromDocuments,
  filterHitsForManual,
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
});
