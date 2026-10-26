import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { showManualChaptersButton } from './manuals.ts';
import {
  applyStoredChapterMetadata,
  chapterCardCopy,
  chapterCardPageRange,
  chaptersInReadingOrder,
} from './manual-toc.ts';
import {
  chaptersFromMetadata,
  resolveManualPdfOpen,
} from '../../supabase/functions/get-manual-url/chapters.ts';

const here = dirname(fileURLToPath(import.meta.url));

const FOLDER = 'shared/candela/VBeam2 (Perfecta, Aesthetica, or Platinum)';
const ENTRY = `${FOLDER}/8501-01-1795_01.pdf`;

/** Subset of a real folder row: entry PDF set, service docs, an operator manual, and section-4 drawings. */
const FOLDER_CHAPTERS = [
  { order: 0, title: '8501-01-1795_01', storage_path: ENTRY },
  {
    order: 1,
    title: 'Sect 1 — 8501-00-1794_04',
    storage_path: `${FOLDER}/Sect 1/8501-00-1794_04.pdf`,
  },
  {
    order: 2,
    title: 'Sect 3 — 8503-01-0853_03',
    storage_path: `${FOLDER}/Sect 3/8503-01-0853_03.pdf`,
  },
  {
    order: 3,
    title: '1010-01-0780_C2',
    storage_path: `${FOLDER}/Secion Two/1010-01-0780_C2.pdf`,
  },
  {
    order: 4,
    title: 'GMAX Troubleshooting Guide',
    storage_path: `${FOLDER}/Docs/GMAX Troubleshooting Guide.pdf`,
  },
  {
    order: 5,
    title: 'MGL 12-15-18 cap-Exploded View',
    storage_path: `${FOLDER}/MGL 12-15-18 cap-Exploded View.pdf`,
  },
  {
    order: 6,
    title: 'HA9P5320-5Z',
    storage_path: `${FOLDER}/HA9P5320-5Z.pdf`,
  },
  {
    order: 8,
    title: 'Operator Manual (English) — 8501-00-1800',
    storage_path: `${FOLDER}/Operator's Manuals/8501-00-1800_05.English.pdf`,
  },
  {
    order: 10,
    title: 'Sect 4 — 7111-80-2520_03',
    storage_path: `${FOLDER}/Sect 4/7111-80-2520_03.pdf`,
  },
  {
    order: 21,
    title: 'Sect 4 — 7122-99-0110_05',
    storage_path: `${FOLDER}/Sect 4/7122-99-0110_05.pdf`,
  },
  {
    order: 22,
    title: 'Sect 4 — 7122-99-3316_0A - Copy',
    storage_path: `${FOLDER}/Sect 4/7122-99-3316_0A - Copy.pdf`,
  },
  {
    order: 51,
    title: "Vbeam New Operator's Manual — 8501-01-1780_14",
    storage_path: `${FOLDER}/Vbeam New Operator's Manual/8501-01-1780_14.pdf`,
  },
];

function openFolder(requestedPath: string) {
  return resolveManualPdfOpen({
    requestedPath,
    parentPath: FOLDER,
    entryFilePath: ENTRY,
    isFolder: true,
    chapterMetadata: FOLDER_CHAPTERS,
  });
}

test('a folder row with entry_file_path returns every chapter and still opens the entry PDF', () => {
  const fromFolder = openFolder(FOLDER);
  const fromEntryPdf = openFolder(ENTRY);
  for (const opened of [fromFolder, fromEntryPdf]) {
    assert.equal(opened.storagePath, ENTRY);
    assert.equal(opened.chapters.length, FOLDER_CHAPTERS.length);
    assert.deepEqual(
      opened.chapters.map((chapter) => chapter.storage_path).sort(),
      FOLDER_CHAPTERS.map((chapter) => chapter.storage_path).sort(),
    );
  }
  // Stored order numbers stay put. Joined pageStart is a separate field.
  assert.equal(fromFolder.chapters.find((chapter) => chapter.storage_path.endsWith('7111-80-2520_03.pdf'))?.order, 10);
  assert.equal(fromFolder.chapters.find((chapter) => chapter.storage_path.endsWith('7122-99-0110_05.pdf'))?.order, 21);
});

test('folder chapters lead with the service manual, before operator manuals and drawings', () => {
  const titles = openFolder(FOLDER).chapters.map((chapter) => chapter.title);
  const at = (snippet: string) => titles.findIndex((title) => title.includes(snippet));
  const service = at('8501-01-1795_01');
  const section1 = at('8501-00-1794_04');
  const procedure = at('8503-01-0853_03');
  const software = at('1010-01-0780_C2');
  const troubleshooting = at('GMAX Troubleshooting Guide');
  const operator = at('Operator Manual (English)');
  const vbeamOperator = at("Vbeam New Operator's Manual");
  const exploded = at('Exploded View');
  const drawing = at('HA9P5320-5Z');
  const schematic = at('7111-80-2520_03');
  const parts = at('7122-99-0110_05');
  const partsCopy = at('7122-99-3316_0A');

  assert.deepEqual(
    [service, section1, procedure, software, troubleshooting].sort((a, b) => a - b),
    [0, 1, 2, 3, 4],
  );
  assert.ok(troubleshooting < operator && operator < vbeamOperator);
  assert.ok(vbeamOperator < exploded && exploded < drawing && drawing < schematic);
  assert.ok(schematic < parts && parts < partsCopy);
});

test('part-number filenames get a readable label and real titles are kept', () => {
  const byPath = new Map(openFolder(FOLDER).chapters.map((chapter) => [chapter.storage_path, chapter.title]));
  assert.equal(byPath.get(ENTRY), 'Service manual — 8501-01-1795_01');
  assert.equal(
    byPath.get(`${FOLDER}/Sect 1/8501-00-1794_04.pdf`),
    'Section 1 — Service manual — 8501-00-1794_04',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Sect 3/8503-01-0853_03.pdf`),
    'Section 3 — Service procedure — 8503-01-0853_03',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Secion Two/1010-01-0780_C2.pdf`),
    'Section 2 — Software — 1010-01-0780_C2',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Sect 4/7111-80-2520_03.pdf`),
    'Section 4 — Schematic — 7111-80-2520_03',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Sect 4/7122-99-0110_05.pdf`),
    'Section 4 — Parts list — 7122-99-0110_05',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Sect 4/7122-99-3316_0A - Copy.pdf`),
    'Section 4 — Parts list — 7122-99-3316_0A (copy)',
  );
  assert.equal(byPath.get(`${FOLDER}/Docs/GMAX Troubleshooting Guide.pdf`), 'GMAX Troubleshooting Guide');
  assert.equal(
    byPath.get(`${FOLDER}/Operator's Manuals/8501-00-1800_05.English.pdf`),
    'Operator Manual (English) — 8501-00-1800',
  );
  assert.equal(
    byPath.get(`${FOLDER}/Vbeam New Operator's Manual/8501-01-1780_14.pdf`),
    "Vbeam New Operator's Manual — 8501-01-1780_14",
  );
  assert.equal(
    byPath.get(`${FOLDER}/MGL 12-15-18 cap-Exploded View.pdf`),
    'MGL 12-15-18 cap-Exploded View',
  );

  const drawing = chaptersFromMetadata(
    [{ order: 0, title: 'HA9P5320-5Z', storage_path: 'shared/candela/alex_trivantage/HA9P5320-5Z.pdf' }],
    'shared/candela/alex_trivantage',
    { isFolder: true },
  );
  assert.equal(drawing[0]?.title, 'Drawing — HA9P5320-5Z');

  const joined = chaptersFromMetadata(
    [{ order: 1, title: 'Sect 4 — 7122-00-1131_03', storage_path: 'Sect 4/7122-00-1131_03.pdf' }],
    'shared/candela/alex_trivantage',
    { isFolder: true },
  );
  assert.equal(joined[0]?.storage_path, 'shared/candela/alex_trivantage/Sect 4/7122-00-1131_03.pdf');
  assert.equal(joined[0]?.title, 'Section 4 — Parts list — 7122-00-1131_03');
});

test('Scout titles keep the descriptive name and pass the document number through', () => {
  const chapters = chaptersFromMetadata(
    [
      {
        title: 'Section 9 — Operator controls',
        storage_path: 'operator/8501-00-0002.pdf',
        docNumber: '8501-00-0002',
      },
      {
        title: 'Section 4 — Water cooling',
        storage_path: 'Sect 4/water.pdf',
        document_number: '  7111-80-2520_03  ',
      },
      {
        title: 'Section 1 — Service overview',
        storage_path: 'svc.pdf',
        doc_number: '8502-00-0001',
      },
      {
        title: 'GMAX Troubleshooting Guide',
        storage_path: 'Docs/GMAX Troubleshooting Guide.pdf',
      },
    ],
    'shared/candela/vpyag',
    { isFolder: true },
  );
  const byPath = new Map(chapters.map((chapter) => [chapter.storage_path, chapter]));
  assert.equal(
    byPath.get('shared/candela/vpyag/operator/8501-00-0002.pdf')?.title,
    'Section 9 — Operator controls',
  );
  assert.equal(byPath.get('shared/candela/vpyag/operator/8501-00-0002.pdf')?.doc_number, '8501-00-0002');
  assert.equal(byPath.get('shared/candela/vpyag/Sect 4/water.pdf')?.doc_number, '7111-80-2520_03');
  assert.equal(byPath.get('shared/candela/vpyag/svc.pdf')?.doc_number, '8502-00-0001');
  assert.equal(byPath.get('shared/candela/vpyag/Docs/GMAX Troubleshooting Guide.pdf')?.doc_number, undefined);
});

test('a real chapter_metadata row keeps doc_number and pages, and front matter sorts first', () => {
  // Same shape the indexer writes (order, language, page_count, page_start) plus Scout's
  // doc_number and page_end. Front matter has a document number and no page span, which
  // used to sort it after every numbered chapter.
  const metadata = [
    {
      order: 4,
      title: 'Section 2 — Installation',
      language: 'English',
      page_count: 12,
      page_start: 29,
      storage_path: 'Sect 1/8501-00-1795_01.pdf',
      doc_number: '8501-00-1795_01',
    },
    {
      order: 1,
      title: 'Section 1 — Safety',
      language: 'English',
      page_count: 20,
      page_start: 9,
      page_end: 28,
      storage_path: 'Sect 1/8501-00-1794_04.pdf',
      doc_number: '8501-00-1794_04',
    },
    {
      order: 101,
      title: 'Service Manual — Front Matter & Contents',
      language: 'English',
      storage_path: 'front/front-matter.pdf',
      doc_number: '8502-00-0000',
    },
    {
      order: 80,
      title: 'Section 9 — Calibration',
      language: 'English',
      page_count: 14,
      page_start: 100,
      page_end: 113,
      storage_path: 'Sect 3/8503-01-0853_03.pdf',
      docNumber: '8503-01-0853_03',
    },
  ];
  const chapters = chaptersFromMetadata(metadata, 'shared/candela/VPYAG Mini GentleYAG', { isFolder: true });
  const byFile = (file: string) => chapters.find((chapter) => chapter.storage_path.endsWith(file));

  const front = byFile('front-matter.pdf');
  assert.equal(front?.title, 'Service Manual — Front Matter & Contents');
  assert.equal(front?.doc_number, '8502-00-0000');
  assert.equal(front?.page_start, undefined);
  assert.equal(chapterCardPageRange(front), null);
  assert.equal(chapterCardCopy(front).docNumber, '8502-00-0000');

  const safety = byFile('8501-00-1794_04.pdf');
  assert.equal(safety?.doc_number, '8501-00-1794_04');
  assert.equal(safety?.page_start, 9);
  assert.equal(safety?.page_end, 28);
  assert.equal(safety?.pageStart, 9);
  assert.equal(safety?.pageCount, 20);
  assert.equal(chapterCardCopy(safety).title, 'Section 1 — Safety');
  assert.equal(chapterCardCopy(safety).docNumber, '8501-00-1794_04');
  assert.equal(chapterCardPageRange(safety), 'pp. 9–28');

  const install = byFile('8501-00-1795_01.pdf');
  assert.equal(install?.doc_number, '8501-00-1795_01');
  assert.equal(install?.page_start, 29);
  assert.equal(install?.page_end, 40);
  assert.equal(install?.pageCount, 12);
  assert.equal(chapterCardPageRange(install), 'pp. 29–40');

  const calibration = byFile('8503-01-0853_03.pdf');
  assert.equal(calibration?.doc_number, '8503-01-0853_03');
  assert.equal(chapterCardPageRange(calibration), 'pp. 100–113');

  const ordered = chaptersInReadingOrder(chapters);
  assert.deepEqual(
    ordered.map((chapter) => chapter.storage_path.split('/').pop()),
    ['front-matter.pdf', '8501-00-1794_04.pdf', '8501-00-1795_01.pdf', '8503-01-0853_03.pdf'],
  );

  const lateFront = chaptersInReadingOrder([
    { title: 'Section 1 — Safety', page_start: 9, storage_path: 'safety.pdf' },
    { title: 'Service Manual — Front Matter & Contents', page_start: 900, storage_path: 'front.pdf' },
  ]);
  assert.equal(lateFront[0]?.storage_path, 'front.pdf');
  assert.equal(lateFront[1]?.storage_path, 'safety.pdf');
});

test('manual 9 cards join doc_number and page_start that get-manual-url drops', () => {
  // manuals.id 9 chapter_metadata is a flat JSON array. Every element has
  // these six keys. The deployed get-manual-url (the call /manuals/view makes)
  // returns only order, title, and storage_path.
  const metadata = [
    {
      order: 8,
      title: 'Service Manual — Front Matter & Contents',
      doc_number: '8501-01-1769 Rev B',
      page_count: 22,
      page_start: 1289,
      storage_path: 'shared/candela/VPYag/8501-01-1769_B.pdf',
    },
    {
      order: 9,
      title: 'Section 1 — Theory of Operation',
      doc_number: '8501-00-1770 Rev B',
      page_count: 41,
      page_start: 1311,
      storage_path: 'shared/candela/VPYag/Sect 1/8501-00-1770_B.pdf',
    },
    {
      order: 12,
      title: 'Section 3 — Drawing 1301-00-8291 (title block unreadable)',
      doc_number: '1301-00-8291 Rev A',
      page_count: 1,
      page_start: 1410,
      storage_path: 'shared/candela/VPYag/Sect 3/1301-00-8291_A.pdf',
    },
  ];
  const fromEdge = metadata.map(({ order, title, storage_path }) => ({ order, title, storage_path }));
  const cards = applyStoredChapterMetadata(fromEdge, metadata);
  const front = cards[0];
  const theory = cards[1];
  const drawing = cards[2];
  assert.equal(chapterCardCopy(front).title, 'Service Manual — Front Matter & Contents');
  assert.equal(chapterCardCopy(front).docNumber, '8501-01-1769 Rev B');
  assert.equal(chapterCardPageRange(front), 'pp. 1289–1310');
  assert.equal(chapterCardCopy(theory).title, 'Section 1 — Theory of Operation');
  assert.equal(chapterCardCopy(theory).docNumber, '8501-00-1770 Rev B');
  assert.equal(chapterCardPageRange(theory), 'pp. 1311–1351');
  assert.equal(chapterCardCopy(drawing).docNumber, '1301-00-8291 Rev A');
  assert.equal(chapterCardPageRange(drawing), 'p. 1410');
  assert.equal(chaptersInReadingOrder(cards)[0]?.storage_path, front?.storage_path);

  const wrapped = applyStoredChapterMetadata(fromEdge, { chapters: metadata });
  assert.equal(chapterCardCopy(wrapped[1]).docNumber, '8501-00-1770 Rev B');
  assert.equal(chapterCardPageRange(wrapped[1]), 'pp. 1311–1351');

  const unmatched = applyStoredChapterMetadata(
    [{ order: 1, title: 'Section 9 — Operator controls', storage_path: 'shared/candela/VPYag/operator.pdf' }],
    metadata,
  );
  assert.equal(chapterCardCopy(unmatched[0]).docNumber, null);
  assert.equal(chapterCardPageRange(unmatched[0]), null);
});

test('a single-PDF row is unchanged: same file, no chapter list', () => {
  const pdf = 'shared/candela/GentleMAX PRO PLUS Service Manual 8501-00-2410_A_01.pdf';
  const opened = resolveManualPdfOpen({
    requestedPath: pdf,
    parentPath: pdf,
    entryFilePath: '',
    isFolder: false,
    chapterMetadata: [{ order: 0, title: 'GentleMAX PRO PLUS', storage_path: pdf }],
  });
  assert.equal(opened.storagePath, pdf);
  assert.deepEqual(opened.chapters, []);

  const shelf = resolveManualPdfOpen({
    requestedPath: pdf,
    parentPath: pdf,
    entryFilePath: null,
    isFolder: false,
    chapterMetadata: [{ order: 0, title: pdf.split('/').pop(), storage_path: pdf }],
  });
  assert.equal(shelf.storagePath, pdf);
  assert.deepEqual(shelf.chapters, []);
});

test('the viewer shows Chapters only when more than one chapter comes back', () => {
  assert.equal(showManualChaptersButton(undefined), false);
  assert.equal(showManualChaptersButton([]), false);
  assert.equal(showManualChaptersButton([{ storage_path: 'a.pdf' }]), false);
  assert.equal(
    showManualChaptersButton([{ storage_path: 'a.pdf' }, { storage_path: 'b.pdf' }]),
    true,
  );
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /showManualChaptersButton\(chapters\)/);
  assert.match(viewer, /aria-label="Chapters"/);
  assert.match(viewer, /📚 Chapters/);
  assert.match(viewer, /applyStoredChapterMetadata\(/);
  assert.match(viewer, /select\('chapter_metadata'\)/);
  const edge = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  const resolveAt = edge.indexOf('resolveManualPdfOpen(');
  const folderGuard = edge.indexOf('if (sp && !isStoredFilePath(sp))', resolveAt);
  assert.ok(resolveAt > 0 && folderGuard > resolveAt);
  const signAt = edge.indexOf('createSignedUrl', folderGuard);
  const probeAt = edge.indexOf('probeStorageObject(', folderGuard);
  assert.ok(probeAt > folderGuard && signAt > probeAt);
});
