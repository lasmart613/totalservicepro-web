import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAP_STRINGS } from './i18n/gap-copy.ts';
import {
  chapterNeighbors,
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
