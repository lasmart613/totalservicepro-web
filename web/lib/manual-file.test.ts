import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateChaptersWithPageMap,
  viewerTargetForJoinedPage,
} from './manual-page-map.ts';
import {
  MANUAL_FILE_MISSING,
  chooseManualObject,
  manualContentType,
  manualDownloadSentence,
  manualFileKind,
  storageResponseIsMissing,
} from './manual-file.ts';
import {
  indexOrderPdfParts,
  resolveManualPdfOpen,
} from '../../supabase/functions/get-manual-url/chapters.ts';

const here = dirname(fileURLToPath(import.meta.url));

const CP690 = 'shared/nidek/cp_690/CP 690.pdf';
const CP690_META = [
  {
    order: 0,
    title: 'CP 690',
    language: 'English',
    page_count: 68,
    page_start: 1,
    storage_path: CP690,
  },
  {
    order: 1,
    title: 'CP 690',
    language: 'English',
    page_count: 68,
    page_start: 1,
    storage_path: CP690,
  },
];

test('a missing single file is file_missing and is not signed', () => {
  assert.deepEqual(
    chooseManualObject({
      storagePath: 'shared/biolitec/Edge One - Technical Manual 2.0.pdf',
      exists: 'no',
      isFolder: false,
      requestedFile: false,
      chapters: [],
      listedPdfs: null,
    }),
    { action: 'missing' },
  );
  assert.equal(
    chooseManualObject({
      storagePath: 'shared/quanta-system/litho/DGM001063.pdf',
      exists: 'yes',
      isFolder: false,
      requestedFile: true,
      chapters: [],
      listedPdfs: null,
    }).action,
    'serve',
  );
  assert.equal(
    chooseManualObject({
      storagePath: 'shared/live.pdf',
      exists: 'unknown',
      isFolder: false,
      requestedFile: false,
      chapters: [],
      listedPdfs: null,
    }).action,
    'serve',
  );
});

test('a missing folder entry falls back to the first chapter the list actually has', () => {
  const chapters = [
    { storage_path: 'shared/folder/entry.pdf' },
    { storage_path: 'shared/folder/Sect 1/service.pdf' },
    { storage_path: 'shared/folder/notes.docx' },
  ];
  const unchecked = chooseManualObject({
    storagePath: 'shared/folder/entry.pdf',
    exists: 'no',
    isFolder: true,
    requestedFile: false,
    chapters,
    listedPdfs: null,
  });
  assert.equal(unchecked.action, 'needs_list');
  assert.deepEqual(
    chooseManualObject({
      storagePath: 'shared/folder/entry.pdf',
      exists: 'no',
      isFolder: true,
      requestedFile: false,
      chapters,
      listedPdfs: ['shared/folder/Sect 1/service.pdf'],
    }),
    { action: 'serve', storagePath: 'shared/folder/Sect 1/service.pdf' },
  );
  assert.equal(
    chooseManualObject({
      storagePath: 'shared/folder/entry.pdf',
      exists: 'no',
      isFolder: true,
      requestedFile: false,
      chapters,
      listedPdfs: [],
    }).action,
    'missing',
  );
  assert.equal(
    chooseManualObject({
      storagePath: 'shared/folder/Sect 1/service.pdf',
      exists: 'no',
      isFolder: true,
      requestedFile: true,
      chapters,
      listedPdfs: ['shared/folder/entry.pdf'],
    }).action,
    'missing',
  );
});

test('storage not-found is 404 file_missing and a generic failure is not', () => {
  assert.equal(storageResponseIsMissing(404, ''), true);
  assert.equal(
    storageResponseIsMissing(400, '{"statusCode":"404","error":"not_found","message":"Object not found"}'),
    true,
  );
  assert.equal(storageResponseIsMissing(500, 'Could not stream manual bytes'), false);
  assert.equal(storageResponseIsMissing(502, 'Manual file is unavailable'), false);
  assert.equal(MANUAL_FILE_MISSING, "This manual's file is missing. We've been notified.");
});

test('non-PDF manuals keep their type and are not rendered as PDFs', () => {
  const docx = 'shared/nidek/ar600_ark700/Nidek AR-600 ARK-700 Calibration.docx';
  const opened = resolveManualPdfOpen({
    requestedPath: docx,
    parentPath: docx,
    entryFilePath: docx,
    isFolder: false,
    chapterMetadata: [{ order: 0, title: 'Calibration', storage_path: docx }],
  });
  assert.equal(opened.storagePath, docx);
  assert.deepEqual(opened.chapters, []);
  assert.deepEqual(opened.downloads, []);
  assert.equal(manualFileKind(docx), 'word');
  assert.equal(manualDownloadSentence('word'), 'This manual is a Word document.');
  assert.equal(
    manualContentType(docx),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  assert.equal(manualFileKind('shared/fotona/starwalker/StarWalker CE ENG.docx'), 'word');
  assert.equal(manualFileKind('sheet.xlsx'), 'excel');
  assert.equal(manualDownloadSentence('excel'), 'This manual is an Excel spreadsheet.');
  assert.equal(manualFileKind('deck.pptx'), 'powerpoint');
  assert.equal(manualFileKind('photo.png'), 'image');
  assert.equal(manualFileKind('bundle.zip'), 'zip');
  assert.equal(manualFileKind('notes.txt'), 'text');
  assert.equal(manualDownloadSentence('other'), 'This manual is a {type} file.');
  assert.equal(manualFileKind('shared/jeisys/Greenlight XPS'), 'other');
});

test('folder chapters are PDF-only and deduped; other files are downloads', () => {
  const folder = 'shared/nidek/cp_690';
  const opened = resolveManualPdfOpen({
    requestedPath: folder,
    parentPath: folder,
    entryFilePath: CP690,
    isFolder: true,
    chapterMetadata: [
      ...CP690_META,
      { order: 2, title: 'Calibration notes', storage_path: `${folder}/notes.docx` },
      { order: 3, title: 'Calibration notes', storage_path: `${folder}/notes.docx` },
    ],
  });
  assert.equal(opened.storagePath, CP690);
  assert.equal(opened.chapters.length, 1);
  assert.equal(opened.chapters[0]?.storage_path, CP690);
  assert.deepEqual(
    opened.downloads.map((item) => item.storage_path),
    [`${folder}/notes.docx`],
  );
  assert.equal(opened.downloads[0]?.file_type, 'docx');
});

test('row 153 keeps one chapter and joined pages 1-68 after the duplicate is dropped', () => {
  const folder = 'shared/nidek/cp_690';
  const opened = resolveManualPdfOpen({
    requestedPath: folder,
    parentPath: folder,
    entryFilePath: CP690,
    isFolder: true,
    chapterMetadata: CP690_META,
  });
  assert.equal(opened.chapters.length, 1);
  const parts = indexOrderPdfParts(CP690_META, folder);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.pageCount, 68);
  const mapped = annotateChaptersWithPageMap(opened.chapters, parts);
  assert.equal(mapped.joinedPageCount, 68);
  assert.equal(mapped.chapters[0]?.pageStart, 1);
  assert.equal(mapped.chapters[0]?.pageCount, 68);
  const first = viewerTargetForJoinedPage(mapped.chapters, 1);
  const last = viewerTargetForJoinedPage(mapped.chapters, 68);
  assert.equal(first.kind, 'hit');
  assert.equal(last.kind, 'hit');
  if (first.kind === 'hit') {
    assert.equal(first.storagePath, CP690);
    assert.equal(first.localPage, 1);
    assert.equal(first.pageStart, 1);
  }
  if (last.kind === 'hit') {
    assert.equal(last.localPage, 68);
    assert.equal(last.pageCount, 68);
  }
  assert.equal(viewerTargetForJoinedPage(mapped.chapters, 69).kind, 'out-of-range');
  assert.equal(viewerTargetForJoinedPage(mapped.chapters, 136).kind, 'out-of-range');
});

test('get-manual-url probes metadata before signing and the viewer does not render a download', () => {
  const edge = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  const probeStart = edge.indexOf('async function probeStorageObject');
  const probeEnd = edge.indexOf('async function listPdfsUnderPrefix', probeStart);
  const probe = edge.slice(probeStart, probeEnd);
  assert.ok(probeStart > 0 && probeEnd > probeStart);
  assert.match(probe, /\/object\/info\/manuals\//);
  assert.match(probe, /\/object\/list\/manuals/);
  assert.match(probe, /search: name/);
  assert.doesNotMatch(probe, /\/storage\/v1\/object\/manuals\//);
  assert.match(edge, /error: "file_missing"/);
  assert.match(edge, /render: "download"/);
  assert.match(edge, /file_kind: kind/);
  const stream = edge.slice(edge.indexOf('async function streamPdfFromStorage'), edge.indexOf('Deno.serve'));
  assert.match(stream, /return "missing"/);
  assert.match(edge, /streamed === "missing"/);

  const route = readFileSync(join(here, '../app/api/manuals/file/route.ts'), 'utf8');
  assert.match(route, /error: 'file_missing'/);
  assert.match(route, /storageResponseIsMissing/);
  assert.match(route, /status: 404/);
  const missingBranch = route.indexOf("resolved.json?.error === 'file_missing'");
  const unavailable = route.indexOf("error: 'Manual file is unavailable'");
  assert.ok(missingBranch > 0 && unavailable > missingBranch);

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /MANUAL_FILE_MISSING/);
  assert.match(viewer, /data-testid="manual-file-missing"/);
  assert.match(viewer, /data-testid="manual-download"/);
  assert.match(viewer, /manualDownloadSentence/);
  assert.match(viewer, /render === 'download'/);
  const openAt = viewer.indexOf('const openPath = useCallback');
  const openPath = viewer.slice(openAt, viewer.indexOf('useEffect(() => {', openAt));
  const downloadAt = openPath.indexOf("json.render === 'download'");
  const paintAt = openPath.indexOf('openSrc(');
  assert.ok(downloadAt > 0 && paintAt > downloadAt);
  assert.doesNotMatch(viewer, /window\.open/);
});
