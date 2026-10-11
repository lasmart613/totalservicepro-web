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
  MANUAL_PATH_NOT_COVERED,
  chooseManualObject,
  manualContentType,
  manualDownloadSentence,
  manualFileKind,
  manualPathCovered,
  normalizeStoragePath,
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

const FOLDER = 'shared/candela/VBeam2 (Perfecta, Aesthetica, or Platinum)';
const ENTRY = `${FOLDER}/8501-01-1795_01.pdf`;
const CHAPTER = `${FOLDER}/Sect 1/8501-00-1794_04.pdf`;
const IN_FOLDER_DOCX = `${FOLDER}/calibration-notes.docx`;
const FOREIGN_DOCX = 'shared/nidek/ar600_ark700/Nidek AR-600 ARK-700 Calibration.docx';
const FOREIGN_PDF = 'shared/asclepion/auriga/Auriga XL.pdf';
const SINGLE_PDF = 'shared/biolitec/Edge One - Technical Manual 2.0.pdf';

function covered(
  storagePath: string,
  opts: {
    row: string;
    entry?: string;
    chapters?: string[];
    downloads?: string[];
    isFolder: boolean;
  },
) {
  return manualPathCovered({
    storagePath,
    rowStoragePath: opts.row,
    entryFilePath: opts.entry,
    chapterPaths: opts.chapters,
    downloadPaths: opts.downloads,
    isFolder: opts.isFolder,
    parentPath: opts.row,
  });
}

test('storage paths collapse dot segments, encoding, and duplicate slashes', () => {
  assert.equal(normalizeStoragePath('/shared//a//file.pdf'), 'shared/a/file.pdf');
  assert.equal(normalizeStoragePath('manuals/shared/a/file.pdf'), 'shared/a/file.pdf');
  assert.equal(normalizeStoragePath('shared/a/./file.pdf'), 'shared/a/file.pdf');
  assert.equal(normalizeStoragePath('shared/folder/../../other/secret.docx'), 'other/secret.docx');
  assert.equal(normalizeStoragePath('shared/folder/%2e%2e/%2e%2e/other/secret.docx'), 'other/secret.docx');
  assert.equal(normalizeStoragePath('shared/folder/%252e%252e/secret.docx'), 'shared/secret.docx');
  assert.equal(normalizeStoragePath('../secret.docx'), '');
  assert.equal(normalizeStoragePath('shared/folder/sub/../notes.docx'), 'shared/folder/notes.docx');
});

test('an out-of-manual docx is refused for an owned row and for an ai_context read', () => {
  const ownedFile = { row: SINGLE_PDF, entry: SINGLE_PDF, isFolder: false };
  const catalogFolder = {
    row: FOLDER,
    entry: ENTRY,
    chapters: [ENTRY, CHAPTER],
    downloads: [`${FOLDER}/kept.docx`],
    isFolder: true,
  };
  assert.equal(covered(FOREIGN_DOCX, ownedFile), false);
  assert.equal(covered(FOREIGN_DOCX, catalogFolder), false);
  assert.equal(MANUAL_PATH_NOT_COVERED, 'Path not covered by this manual');
});

test('an out-of-manual PDF is refused when the manual id is only an ai_context grant', () => {
  assert.equal(
    covered(FOREIGN_PDF, {
      row: FOLDER,
      entry: ENTRY,
      chapters: [ENTRY, CHAPTER],
      isFolder: true,
    }),
    false,
  );
});

test('a traversal path is not inside the manual prefix', () => {
  const folder = {
    row: FOLDER,
    entry: ENTRY,
    chapters: [ENTRY, CHAPTER],
    isFolder: true,
  };
  assert.equal(covered(`${FOLDER}/../../other/secret.docx`, folder), false);
  assert.equal(covered(`${FOLDER}/%2e%2e/%2e%2e/other/secret.docx`, folder), false);
  assert.equal(covered(`${FOLDER}/%252e%252e/%252e%252e/other/secret.pdf`, folder), false);
  assert.equal(covered('../secret.pdf', folder), false);
  assert.equal(covered(`${SINGLE_PDF}/evil.docx`, { row: SINGLE_PDF, entry: SINGLE_PDF, isFolder: false }), false);
});

test('an in-folder docx still signs, and a single PDF or folder chapter still opens', () => {
  const folder = {
    row: FOLDER,
    entry: ENTRY,
    chapters: [ENTRY, CHAPTER],
    downloads: [] as string[],
    isFolder: true,
  };
  assert.equal(covered(IN_FOLDER_DOCX, folder), true);
  assert.equal(covered(ENTRY, folder), true);
  assert.equal(covered(CHAPTER, folder), true);
  assert.equal(covered(FOLDER, folder), true);
  assert.equal(covered(`${FOLDER}/sub/../calibration-notes.docx`, folder), true);
  assert.equal(covered(SINGLE_PDF, { row: SINGLE_PDF, entry: SINGLE_PDF, isFolder: false }), true);
  assert.equal(covered(FOREIGN_PDF, { row: SINGLE_PDF, entry: SINGLE_PDF, isFolder: false }), false);

  const opened = resolveManualPdfOpen({
    requestedPath: CHAPTER,
    parentPath: FOLDER,
    entryFilePath: ENTRY,
    isFolder: true,
    chapterMetadata: [
      { order: 0, title: 'Entry', storage_path: ENTRY },
      { order: 1, title: 'Service', storage_path: CHAPTER },
    ],
  });
  assert.equal(opened.storagePath, CHAPTER);
  assert.equal(
    covered(opened.storagePath, { ...folder, chapters: opened.chapters.map((chapter) => chapter.storage_path) }),
    true,
  );
});

function objectBodies(source: string, marker: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(marker, from);
    if (at < 0) break;
    const open = source.lastIndexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(open, end + 1));
    from = end + 1;
  }
  return bodies;
}

test('file_missing bodies carry no path, and uncovered keys are refused before storage', () => {
  const edge = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  const missing = objectBodies(edge, 'error: "file_missing"');
  assert.ok(missing.length >= 3);
  for (const body of missing) {
    assert.doesNotMatch(body, /storage_path/);
    assert.doesNotMatch(body, /prefix/);
  }
  const denied = objectBodies(edge, 'MANUAL_PATH_NOT_COVERED');
  assert.ok(denied.length >= 2);
  for (const body of denied) {
    assert.equal(body.includes('storage_path'), false);
    assert.equal(body.includes('prefix'), false);
  }

  const grant = edge.indexOf('if (!allowed && aiContext)');
  const openedAt = edge.indexOf('const opened = resolveManualPdfOpen');
  const coverAt = edge.indexOf('if ((sentPath && !pathCovered(requestedNorm)) || !pathCovered(sp))');
  const folderAt = edge.indexOf('if (sp && !isStoredFilePath(sp))', openedAt);
  const probeAt = edge.indexOf('await probeStorageObject(', openedAt);
  const signAt = edge.indexOf('.createSignedUrl(', openedAt);
  const ticketAt = edge.indexOf('mintStreamTicket(', openedAt);
  assert.ok(grant > 0 && openedAt > grant && coverAt > openedAt);
  assert.ok(coverAt < folderAt && coverAt < probeAt && coverAt < signAt && coverAt < ticketAt);
  const gate = edge.slice(edge.indexOf('Chapter under owned folder'), edge.indexOf('const inLibrary'));
  assert.doesNotMatch(gate, /isPdfPath/);

  const streamStart = edge.indexOf('if (req.method === "GET" && isStream)');
  const postStart = edge.indexOf('// ---------- POST ----------');
  const stream = edge.slice(streamStart, postStart);
  const streamGate = stream.indexOf('streamCovered(sp)');
  const streamBytes = stream.indexOf('streamPdfFromStorage(');
  assert.ok(streamGate > 0 && streamGate < streamBytes);

  const route = readFileSync(join(here, '../app/api/manuals/file/route.ts'), 'utf8');
  const preSign = route.indexOf('if (scoped && !catalogCoversPath(scoped, storagePath))');
  const signed = route.indexOf('const resolved = await resolveSignedUrl');
  const uncovered = route.indexOf('resolved.json?.error === MANUAL_PATH_NOT_COVERED');
  const fallback = route.indexOf('await streamAiCatalogPdf');
  assert.ok(preSign > 0 && preSign < signed && uncovered > signed && uncovered < fallback);
  assert.match(route, /!catalogCoversPath\(catalog, asked\)/);
  assert.doesNotMatch(route, /if \(isPdfPath\(asked\)\) return asked/);
});
