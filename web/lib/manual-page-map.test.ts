import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { citationViewerHref } from './ai/citations.ts';
import { buildOcrXObjectPdf, buildTextPdf, buildToUnicodePdf } from './manual-pdf-fixtures.ts';
import { extractPdfPageSlice } from './manual-pdf-text.ts';
import { chapterPathsFromMetadata, pdfPathsForManual } from './manual-search-index.ts';
import {
  annotateChaptersWithPageMap,
  buildJoinedPageMap,
  resolveJoinedPage,
  viewerTargetForJoinedPage,
  type JoinedPagePart,
} from './manual-page-map.ts';
import { indexOrderPdfPaths } from '../../supabase/functions/get-manual-url/chapters.ts';
import { countPdfPages } from '../../supabase/functions/get-manual-url/pdf-page-count.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FOLDER = 'shared/candela/VBeam2 (Perfecta, Aesthetica, or Platinum)';

/** Page counts aligned to manual 27's joined index (52 files, 273 stamps). */
const VBEAM2_COUNTS = [
  14, 39, 2, 4, 6, 4, 5, 5, 3, 5, 1, 16, 1, 1, 1, 2, 1, 8, 1, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 2,
  1, 1, 1, 3, 2, 1, 1, 4, 2, 2, 1, 2, 1, 3, 2, 1, 2, 7, 6, 3, 93,
];

const VBEAM2_NAMES: Record<number, string> = {
  0: '8501-01-1795_01.pdf',
  1: 'Sect 1/8501-00-1794_04.pdf',
  21: 'Sect 4/7122-99-0110_05.pdf',
  51: "Vbeam New Operator's Manual/8501-01-1780_14.pdf",
};

function vbeam2Parts(): JoinedPagePart[] {
  return VBEAM2_COUNTS.map((pageCount, index) => ({
    storagePath: `${FOLDER}/${VBEAM2_NAMES[index] || `file-${index}.pdf`}`,
    pageCount,
  }));
}

function hit(page: number) {
  const target = viewerTargetForJoinedPage(
    annotateChaptersWithPageMap(
      vbeam2Parts().map((part) => ({ storage_path: part.storagePath })),
      vbeam2Parts(),
    ).chapters,
    page,
  );
  assert.equal(target.kind, 'hit');
  if (target.kind !== 'hit') throw new Error('expected a hit');
  return target;
}

test('joined map follows metadata order and skips empty files', () => {
  assert.equal(VBEAM2_COUNTS.length, 52);
  assert.equal(VBEAM2_COUNTS.reduce((sum, n) => sum + n, 0), 273);
  const parts = vbeam2Parts();
  const map = buildJoinedPageMap(parts);
  assert.equal(map.length, 52);
  assert.equal(map[0].pageStart, 1);
  assert.equal(map[1].pageStart, 15);
  assert.equal(map[map.length - 1].pageStart, 181);

  const withBlank = buildJoinedPageMap([
    { storagePath: 'a.pdf', pageCount: 2 },
    { storagePath: 'blank.pdf', pageCount: 0 },
    { storagePath: 'b.pdf', pageCount: 3 },
  ]);
  assert.deepEqual(
    withBlank.map((span) => span.storagePath),
    ['a.pdf', 'b.pdf'],
  );
  assert.equal(resolveJoinedPage(withBlank, 3)?.storagePath, 'b.pdf');
  assert.equal(resolveJoinedPage(withBlank, 3)?.localPage, 1);

  const duplicate = buildJoinedPageMap([
    { storagePath: 'a.pdf', pageCount: 2 },
    { storagePath: 'a.pdf', pageCount: 9 },
    { storagePath: 'b.pdf', pageCount: 1 },
  ]);
  assert.equal(duplicate.length, 2);
  assert.equal(resolveJoinedPage(duplicate, 3)?.storagePath, 'b.pdf');
});

test('manual 27 joined pages resolve to the chapter file and local page', () => {
  const first = hit(1);
  assert.equal(first.localPage, 1);
  assert.match(first.storagePath, /8501-01-1795_01\.pdf$/);
  assert.equal(hit(14).localPage, 14);
  assert.match(hit(14).storagePath, /8501-01-1795_01\.pdf$/);

  const section = hit(15);
  assert.equal(section.localPage, 1);
  assert.match(section.storagePath, /8501-00-1794_04\.pdf$/);
  const di = hit(23);
  assert.equal(di.localPage, 9);
  assert.match(di.storagePath, /Sect 1\/8501-00-1794_04\.pdf$/);
  assert.equal(hit(53).localPage, 39);
  assert.match(hit(53).storagePath, /8501-00-1794_04\.pdf$/);

  const emptyDrawing = hit(122);
  assert.equal(emptyDrawing.localPage, 1);
  assert.match(emptyDrawing.storagePath, /7122-99-0110_05\.pdf$/);

  const operator = hit(181);
  assert.equal(operator.localPage, 1);
  assert.match(operator.storagePath, /8501-01-1780_14\.pdf$/);
  assert.equal(hit(273).localPage, 93);
  assert.match(hit(273).storagePath, /8501-01-1780_14\.pdf$/);

  assert.equal(
    viewerTargetForJoinedPage(
      annotateChaptersWithPageMap(
        vbeam2Parts().map((part) => ({ storage_path: part.storagePath })),
        vbeam2Parts(),
      ).chapters,
      274,
    ).kind,
    'out-of-range',
  );
  assert.equal(viewerTargetForJoinedPage([], 0).kind, 'unmapped');
  assert.equal(viewerTargetForJoinedPage([], Number.NaN).kind, 'unmapped');
});

test('display order does not change joined page resolution', () => {
  const annotated = annotateChaptersWithPageMap(
    vbeam2Parts().map((part) => ({ storage_path: part.storagePath, title: part.storagePath })),
    vbeam2Parts(),
  );
  assert.equal(annotated.joinedPageCount, 273);
  const reversed = [...annotated.chapters].reverse();
  const target = viewerTargetForJoinedPage(reversed, 23);
  assert.equal(target.kind, 'hit');
  if (target.kind !== 'hit') return;
  assert.equal(target.localPage, 9);
  assert.match(target.storagePath, /8501-00-1794_04\.pdf$/);
});

test('an unreadable chapter omits the whole map', () => {
  const parts = vbeam2Parts();
  parts[3] = { ...parts[3], pageCount: null };
  const annotated = annotateChaptersWithPageMap(
    parts.map((part) => ({ storage_path: part.storagePath })),
    parts,
  );
  assert.equal(annotated.joinedPageCount, null);
  assert.equal(annotated.chapters.some((chapter) => chapter.pageStart != null), false);
  assert.equal(viewerTargetForJoinedPage(annotated.chapters, 23).kind, 'unmapped');
});

test('index order matches the search indexer for absolute chapter paths', () => {
  const meta = vbeam2Parts().map((part, index) => ({
    order: 52 - index,
    storage_path: part.storagePath,
    title: `chapter ${index}`,
  }));
  const parent = FOLDER;
  assert.deepEqual(indexOrderPdfPaths(meta, parent), [...new Set(chapterPathsFromMetadata(meta))]);
  assert.deepEqual(
    indexOrderPdfPaths(meta, parent),
    pdfPathsForManual({
      id: 27,
      title: 'VBeam2',
      storage_path: parent,
      chapter_metadata: meta,
      is_folder: true,
    }),
  );
  const duped = [...meta, meta[0]];
  assert.equal(indexOrderPdfPaths(duped, parent).length, meta.length);
});

test('countPdfPages matches pdf.js and ignores a content-stream decoy', async () => {
  const three = buildTextPdf(['intro reservoir', 'error forty three', 'optical collimator']);
  assert.equal(countPdfPages(three), 3);
  assert.equal(countPdfPages(three), (await extractPdfPageSlice(three)).total);
  assert.equal(countPdfPages(buildOcrXObjectPdf()), 1);
  assert.equal(countPdfPages(buildToUnicodePdf()), (await extractPdfPageSlice(buildToUnicodePdf())).total);

  const sample = readFileSync(join(here, '../public/fixtures/sample-service-manual.pdf'));
  assert.equal(countPdfPages(sample), 3);
  assert.equal(countPdfPages(sample), (await extractPdfPageSlice(sample)).total);

  const decoy = buildTextPdf(['/Count 99 /Type /Pages still one page']);
  assert.equal(countPdfPages(decoy), 1);
  assert.equal((await extractPdfPageSlice(decoy)).total, 1);

  const indirect = new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 8 0 R /Kids [3 0 R] >>\nendobj\n%%EOF\n',
  );
  assert.equal(countPdfPages(indirect), null);
  assert.equal(countPdfPages(new Uint8Array([1, 2, 3, 4])), null);
});

test('a folder citation chip keeps the joined page and the viewer resolves it', () => {
  const href = citationViewerHref({ manualId: 27, page: 23, title: 'VBeam2' });
  const qs = new URLSearchParams(href.split('?')[1]);
  assert.equal(qs.get('id'), '27');
  assert.equal(qs.get('page'), '23');
  const target = viewerTargetForJoinedPage(
    annotateChaptersWithPageMap(
      vbeam2Parts().map((part) => ({ storage_path: part.storagePath })),
      vbeam2Parts(),
    ).chapters,
    23,
  );
  assert.equal(target.kind, 'hit');
  if (target.kind !== 'hit') return;
  assert.equal(target.localPage, 9);
  assert.match(target.storagePath, /8501-00-1794_04\.pdf$/);

  const single = citationViewerHref({ manualId: 5, page: 13, title: 'GentleMAX PRO PLUS' });
  const singleQs = new URLSearchParams(single.split('?')[1]);
  assert.equal(singleQs.get('id'), '5');
  assert.equal(singleQs.get('page'), '13');
  assert.equal(viewerTargetForJoinedPage([], 13).kind, 'unmapped');

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  const edge = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  assert.match(viewer, /viewerTargetForJoinedPage/);
  assert.match(viewer, /data-testid="joined-page"/);
  assert.match(viewer, /if \(pageOutOfRange\) return/);
  assert.match(edge, /joined_page_count/);
  assert.match(edge, /pageStart/);
});
