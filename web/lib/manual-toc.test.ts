import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAP_STRINGS } from './i18n/gap-copy.ts';
import { chapterTileNumber } from './pdf-viewer-page.ts';
import {
  chapterCardCopy,
  chapterHistoryUrl,
  chapterNeighbors,
  chaptersInReadingOrder,
  chooseDocumentToc,
  manualChapterHref,
  manualTocPageHref,
  tocEntriesFromMetadata,
  tocFromPdfOutline,
  viewerPageFromHash,
  type PdfOutlineItem,
} from './manual-toc.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Catalog row 9 is the multi-file Candela VPYAG / Mini GentleYAG manual.
 * These titles stand in for that chapter list: service manual, operator
 * manual, then drawings. Display order is the order the viewer receives.
 */
const VPYAG = [
  {
    title: 'Service manual — Mini GentleYAG',
    storage_path: 'shared/candela/VPYAG Mini GentleYAG/8502-00-0001_service.pdf',
  },
  {
    title: 'Operator manual — Mini GentleYAG',
    storage_path: 'shared/candela/VPYAG Mini GentleYAG/operator/8501-00-0002_op.pdf',
  },
  {
    title: 'Section 4 — Schematic — 7111-80-2520_03',
    storage_path: 'shared/candela/VPYAG Mini GentleYAG/Sect 4/7111-80-2520_03.pdf',
  },
];

test('VPYAG chapter navigation stops at the ends and links each chapter', () => {
  const first = chapterNeighbors(VPYAG, VPYAG[0].storage_path);
  assert.equal(first.index, 0);
  assert.equal(first.previous, null);
  assert.equal(first.next, VPYAG[1]);

  const middle = chapterNeighbors(VPYAG, `/${VPYAG[1].storage_path}/`);
  assert.equal(middle.index, 1);
  assert.equal(middle.previous, VPYAG[0]);
  assert.equal(middle.next, VPYAG[2]);

  const last = chapterNeighbors(VPYAG, VPYAG[2].storage_path);
  assert.equal(last.index, 2);
  assert.equal(last.previous, VPYAG[1]);
  assert.equal(last.next, null);

  assert.deepEqual(chapterNeighbors(VPYAG, 'shared/other/missing.pdf'), {
    index: -1,
    previous: null,
    next: null,
  });
  assert.equal(chapterNeighbors([VPYAG[0]], VPYAG[0].storage_path).index, -1);
  assert.equal(chapterNeighbors(undefined, VPYAG[0].storage_path).index, -1);

  assert.equal(
    manualChapterHref({ id: 9, storagePath: VPYAG[1].storage_path, title: 'Mini GentleYAG' }),
    '/manuals/view?id=9&title=Mini+GentleYAG&storage_path=shared%2Fcandela%2FVPYAG+Mini+GentleYAG%2Foperator%2F8501-00-0002_op.pdf',
  );
  assert.equal(manualChapterHref({ id: 9, storagePath: '   ' }), null);

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /data-testid="back-to-chapters"/);
  assert.match(viewer, /t\('Back to chapters'\)/);
  assert.match(viewer, /data-testid="previous-chapter"/);
  assert.match(viewer, /data-testid="next-chapter"/);
  assert.match(viewer, /hidden=\{chapterNav\.previous == null\}/);
  assert.match(viewer, /hidden=\{chapterNav\.next == null\}/);
  assert.match(viewer, /disabled=\{chapterNav\.previous == null \|\| loading\}/);
  assert.match(viewer, /disabled=\{chapterNav\.next == null \|\| loading\}/);
  assert.match(viewer, /data-testid="chapter-link"/);
  assert.match(viewer, /manualChapterHref\(/);
  assert.match(viewer, /showManualChaptersButton\(chapters\) && !showChapters/);
  assert.doesNotMatch(viewer, /target=["']_blank["']/);
});

test('manual 9 chapters follow page order for the list and Previous/Next', () => {
  // Arrival order matches the folder ranks: service 9–30, operator 1–8, then 31–109.
  // Operator manuals own the earliest joined pages, so their chapter numbers are 1–8.
  const chapters: { title: string; storage_path: string; pageStart?: number | string | null }[] = [];
  for (let n = 9; n <= 30; n++) {
    chapters.push({ title: `Chapter ${n}`, storage_path: `shared/candela/ch-${n}.pdf`, pageStart: 1000 + n });
  }
  for (let n = 1; n <= 8; n++) {
    chapters.push({ title: `Chapter ${n}`, storage_path: `shared/candela/ch-${n}.pdf`, pageStart: n * 10 });
  }
  for (let n = 31; n <= 109; n++) {
    chapters.push({ title: `Chapter ${n}`, storage_path: `shared/candela/ch-${n}.pdf`, pageStart: 3000 + n });
  }
  assert.equal(chapters[0]?.title, 'Chapter 9');
  assert.equal(chapters[22]?.title, 'Chapter 1');

  const ordered = chaptersInReadingOrder(chapters);
  assert.deepEqual(
    ordered.map((chapter) => chapter.title),
    Array.from({ length: 109 }, (_, i) => `Chapter ${i + 1}`),
  );
  for (let i = 0; i < ordered.length; i++) {
    assert.equal(chapterTileNumber(ordered, i), i + 1);
  }

  const first = chapterNeighbors(ordered, ordered[0]?.storage_path);
  assert.equal(first.previous, null);
  assert.equal(first.next?.title, 'Chapter 2');

  const chapter8 = chapterNeighbors(ordered, ordered[7]?.storage_path);
  assert.equal(chapter8.previous?.title, 'Chapter 7');
  assert.equal(chapter8.next?.title, 'Chapter 9');

  const last = chapterNeighbors(ordered, ordered[108]?.storage_path);
  assert.equal(last.previous?.title, 'Chapter 108');
  assert.equal(last.next, null);

  const numeric = chaptersInReadingOrder([
    { storage_path: 'ten', pageStart: '10' },
    { storage_path: 'two', pageStart: 2 },
    { storage_path: 'nine', pageStart: '9' },
  ]);
  assert.deepEqual(
    numeric.map((chapter) => chapter.storage_path),
    ['two', 'nine', 'ten'],
  );

  const stable = chaptersInReadingOrder([
    { storage_path: 'late', pageStart: 5 },
    { storage_path: 'first-missing' },
    { storage_path: 'tie-a', pageStart: 5 },
    { storage_path: 'early', pageStart: 1 },
    { storage_path: 'second-missing', pageStart: null },
  ]);
  assert.deepEqual(
    stable.map((chapter) => chapter.storage_path),
    ['early', 'late', 'tie-a', 'first-missing', 'second-missing'],
  );
  assert.deepEqual(chaptersInReadingOrder(undefined), []);
  assert.deepEqual(chaptersInReadingOrder([]), []);

  const current = 'https://repairplanet.net/manuals/view?id=9&title=Mini+GentleYAG&page=4#page=4';
  assert.equal(
    chapterHistoryUrl(current, { manualId: 9, storagePath: 'shared/candela/ch-2.pdf' }),
    '/manuals/view?id=9&title=Mini+GentleYAG&storage_path=shared%2Fcandela%2Fch-2.pdf',
  );
  assert.equal(
    chapterHistoryUrl(
      'https://repairplanet.net/manuals/view?id=9&title=Mini+GentleYAG&storage_path=shared%2Fcandela%2Fch-2.pdf',
      { manualId: 9, storagePath: 'shared/candela/ch-2.pdf' },
    ),
    null,
  );
  assert.equal(
    chapterHistoryUrl(current, { manualId: 9, storagePath: 'shared/candela/ch-1.pdf', keepPage: true }),
    '/manuals/view?id=9&title=Mini+GentleYAG&page=4&storage_path=shared%2Fcandela%2Fch-1.pdf#page=4',
  );
  assert.equal(chapterHistoryUrl(current, { manualId: 9, storagePath: '  ' }), null);

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /chaptersInReadingOrder\(chapters\)/);
  assert.match(viewer, /chapterNeighbors\(readingChapters, openStoragePath\)/);
  assert.match(viewer, /window\.history\.pushState/);
  assert.match(viewer, /addEventListener\('popstate'/);
  assert.match(viewer, /openChapterRef\.current\(ch, 'none'\)/);
  assert.match(viewer, /userChapterNav\.current = true/);
  assert.match(viewer, /writeChapterHistory\(ch, 'replace', \{ keepPage: true \}\)/);
  assert.match(viewer, /chapters\.findIndex\(\(c\) => c\?\.storage_path && c\.storage_path === openStoragePath\)/);
});

test('Scout section titles show the descriptive name and document number', () => {
  assert.deepEqual(
    chapterCardCopy({
      title: 'Section 4 — Water cooling',
      doc_number: '7111-80-2520_03',
    }),
    { title: 'Water cooling', docNumber: '7111-80-2520_03' },
  );
  assert.deepEqual(
    chapterCardCopy({
      title: 'Section 12 - Laser calibration',
      docNumber: '  8501-00-0002  ',
    }),
    { title: 'Laser calibration', docNumber: '8501-00-0002' },
  );
  assert.deepEqual(
    chapterCardCopy({
      title: 'Section 8 – Operator controls',
      document_number: '8501-00-1800',
    }),
    { title: 'Operator controls', docNumber: '8501-00-1800' },
  );
  assert.deepEqual(
    chapterCardCopy({ title: 'Section 4 — Schematic — power board', doc_number: '7122-99-0110_05' }),
    { title: 'Schematic — power board', docNumber: '7122-99-0110_05' },
  );

  assert.deepEqual(chapterCardCopy({ title: 'Section 4 — Water cooling' }), {
    title: 'Section 4 — Water cooling',
    docNumber: null,
  });
  assert.deepEqual(
    chapterCardCopy({ title: 'Operator manual — Mini GentleYAG', doc_number: '8501-00-0002' }),
    { title: 'Operator manual — Mini GentleYAG', docNumber: null },
  );
  assert.deepEqual(chapterCardCopy({ title: 'Section 4 —', doc_number: '7111-80-2520_03' }), {
    title: 'Section 4 —',
    docNumber: null,
  });
  assert.deepEqual(chapterCardCopy({ title: 'Section 4 — Schematic — 7111-80-2520_03' }), {
    title: 'Section 4 — Schematic — 7111-80-2520_03',
    docNumber: null,
  });

  // Arrival order is not section order. The two Section 8 files keep that arrival order.
  const sections = [
    { title: 'Section 30 — Drawings', storage_path: 'drawings.pdf' },
    { title: 'Section 8 — Earlier operator', storage_path: 'op8-early.pdf' },
    { title: 'Section 1 — Operator', storage_path: 'op.pdf' },
    { title: 'Section 10 — Next service', storage_path: 'ten.pdf' },
    { title: 'Section 2 — Setup', storage_path: 'setup.pdf' },
    { title: 'Section 9 — Service', storage_path: 'svc.pdf' },
    { title: 'Section 8 — Last operator', storage_path: 'op8.pdf' },
    { title: 'Notes', storage_path: 'notes.pdf' },
  ];
  const bySection = chaptersInReadingOrder(sections);
  assert.deepEqual(
    bySection.map((chapter) => chapter.storage_path),
    ['op.pdf', 'setup.pdf', 'op8-early.pdf', 'op8.pdf', 'svc.pdf', 'ten.pdf', 'drawings.pdf', 'notes.pdf'],
  );
  const section8 = chapterNeighbors(bySection, 'op8.pdf');
  assert.equal(section8.previous?.storage_path, 'op8-early.pdf');
  assert.equal(section8.next?.storage_path, 'svc.pdf');
  assert.equal(chapterNeighbors(bySection, 'op.pdf').previous, null);

  const pageWins = chaptersInReadingOrder([
    { title: 'Section 1 — Early label', pageStart: 50, storage_path: 'late-page.pdf' },
    { title: 'Section 30 — Late label', pageStart: 1, storage_path: 'early-page.pdf' },
  ]);
  assert.deepEqual(
    pageWins.map((chapter) => chapter.storage_path),
    ['early-page.pdf', 'late-page.pdf'],
  );

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /chapterCardCopy\(ch\)/);
  assert.match(viewer, /data-testid="chapter-doc-number"/);
  assert.match(viewer, /card\.title/);
  assert.doesNotMatch(viewer, /target=["']_blank["']/);
});

test('a single-PDF outline or extracted TOC links to that page', () => {
  assert.equal(
    manualTocPageHref({ id: 105, page: 42, title: 'Service Manual' }),
    '/manuals/view?id=105&title=Service+Manual&page=42#page=42',
  );
  assert.equal(manualTocPageHref({ id: 105, page: 0 }), null);
  assert.equal(viewerPageFromHash('#page=42'), 42);
  assert.equal(viewerPageFromHash('#Page=7'), 7);
  assert.equal(viewerPageFromHash('#page=0'), null);
  assert.equal(viewerPageFromHash('#section'), null);
  assert.equal(viewerPageFromHash(''), null);

  const extracted = tocEntriesFromMetadata([
    { title: 'Safety', page: 4 },
    { title: '  Calibration  ', page: '18' },
    { title: 'Skip me', page: 0 },
    { title: 'External', page: 'https://example.com/page=3' },
    {
      title: 'Installation',
      page_start: 9,
      children: [{ title: 'Water', dest: '#page=11' }],
    },
  ]);
  assert.deepEqual(extracted, [
    { title: 'Safety', page: 4, depth: 0 },
    { title: 'Calibration', page: 18, depth: 0 },
    { title: 'Installation', page: 9, depth: 0 },
    { title: 'Water', page: 11, depth: 1 },
  ]);

  const nested = tocEntriesFromMetadata({
    toc: [{ label: 'Troubleshooting', page_number: 30, items: [{ name: 'Codes', printed_page: 'p. 32' }] }],
  });
  assert.deepEqual(nested, [
    { title: 'Troubleshooting', page: 30, depth: 0 },
    { title: 'Codes', page: 32, depth: 1 },
  ]);

  const sameFile = tocEntriesFromMetadata([
    { title: 'Cover', storage_path: 'shared/candela/one.pdf', page: 1 },
    { title: 'Optics', storage_path: 'shared/candela/one.pdf', page: 22 },
  ]);
  assert.equal(sameFile.length, 2);
  assert.equal(sameFile[1]?.page, 22);

  assert.deepEqual(tocEntriesFromMetadata(VPYAG), []);
  assert.deepEqual(tocEntriesFromMetadata('not json'), []);
  assert.deepEqual(tocEntriesFromMetadata('{'), []);
  assert.deepEqual(tocEntriesFromMetadata(null), []);
  assert.deepEqual(
    tocEntriesFromMetadata([{ title: 'Whole file', storage_path: 'shared/a.pdf', page_start: 1, page_count: 80 }]),
    [],
  );

  const outline: PdfOutlineItem[] = [
    { title: 'Safety', dest: 'safety', items: [{ title: 'Labels', dest: [3] }] },
    { title: 'No destination', dest: null },
    { title: 'Site', url: 'https://example.com/manual?page=9' },
    { title: 'Hash', url: '#page=15' },
  ];
  const pdf = {
    async getDestination(name: string) {
      if (name !== 'safety') return null;
      return [{ num: 5, gen: 0 }, { name: 'XYZ' }, 0, 0, 0];
    },
    async getPageIndex(ref: { num?: number }) {
      if (!ref || ref.num == null) throw new Error('bad ref');
      return ref.num;
    },
  };
  return tocFromPdfOutline(outline, pdf).then((entries) => {
    assert.deepEqual(entries, [
      { title: 'Safety', page: 6, depth: 0 },
      { title: 'Labels', page: 3, depth: 1 },
      { title: 'Hash', page: 15, depth: 0 },
    ]);
    assert.deepEqual(chooseDocumentToc(extracted, entries), entries);
    assert.deepEqual(chooseDocumentToc(extracted, []), extracted);
    assert.deepEqual(chooseDocumentToc([], []), []);
  });
});

test('a broken outline lookup keeps the entries that did resolve', async () => {
  const entries = await tocFromPdfOutline(
    [
      { title: 'Good', dest: [{ num: 1 }] },
      { title: 'Bad', dest: [{ num: 2 }] },
      { title: 'Later', dest: [8] },
    ],
    {
      async getPageIndex(ref: { num?: number }) {
        if (ref?.num === 2) throw new Error('unresolved');
        return ref?.num ?? -1;
      },
    },
  );
  assert.deepEqual(entries, [
    { title: 'Good', page: 2, depth: 0 },
    { title: 'Later', page: 8, depth: 0 },
  ]);
  assert.deepEqual(await tocFromPdfOutline(null, {}), []);
  assert.deepEqual(await tocFromPdfOutline([], {}), []);
});

test('the viewer links single-PDF contents and reads the page hash', () => {
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /chooseDocumentToc\(storedToc, pdfOutline\)/);
  assert.match(viewer, /tocEntriesFromMetadata\(/);
  assert.match(viewer, /tocFromPdfOutline\(/);
  assert.match(viewer, /data-testid="toc-link"/);
  assert.match(viewer, /manualTocPageHref\(/);
  assert.match(viewer, /t\('Contents'\)/);
  assert.match(viewer, /showManualChaptersButton\(chapters\) \? \[\] : chooseDocumentToc/);

  const viewPage = readFileSync(join(here, '../app/manuals/view/page.tsx'), 'utf8');
  assert.match(viewPage, /viewerPageFromHash/);
  assert.match(viewPage, /params\.get\('page'\) \|\| params\.get\('p'\) \|\| hashPage/);

  for (const key of ['Back to chapters', 'Previous chapter', 'Next chapter', 'Contents']) {
    const row = GAP_STRINGS[key];
    assert.ok(row, key);
    for (const locale of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) {
      assert.equal(typeof row[locale], 'string', `${locale} ${key}`);
      assert.notEqual(row[locale], key, `${locale} left English: ${key}`);
    }
  }
});
