import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chapterPageRangeLabel,
  chapterTileNumber,
  fittedPageBoxHeight,
  viewerCitedPageNotice,
  viewerFolderOutOfRangeNotice,
  viewerPageOutOfRangeNotice,
  viewerPhysicalPage,
} from './pdf-viewer-page.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('viewer deep link uses the physical page and does not clamp early', () => {
  assert.equal(viewerPhysicalPage(7, 161), 7);
  assert.equal(viewerPhysicalPage(150, 161), 150);
  assert.equal(viewerPhysicalPage(142, 178), 142);
  assert.equal(viewerPhysicalPage(150, 64), null);
  assert.equal(viewerPhysicalPage(120, 15), null);
  assert.equal(viewerPhysicalPage(0, 161), null);
  assert.equal(viewerPageOutOfRangeNotice(120, 15), "Page 120 isn't in this PDF");
  assert.equal(viewerPageOutOfRangeNotice(142, 178), null);
  assert.equal(viewerPageOutOfRangeNotice(1, 15), null);
  assert.equal(viewerCitedPageNotice(88, 15, true), "Page 88 isn't in this PDF");
  assert.equal(viewerCitedPageNotice(2, 3, true), "Page 2 isn't in this PDF");
  assert.equal(viewerCitedPageNotice(2, 3, false), null);
  assert.equal(viewerCitedPageNotice(120, 0, false), null);
  const letter = fittedPageBoxHeight(612, 792, 800, 1);
  assert.ok(letter > 900, `fitted page box should be a real page, got ${letter}`);

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /viewerPhysicalPage/);
  assert.match(viewer, /viewerCitedPageNotice/);
  assert.match(viewer, /if \(pageOutOfRange\) return/);
  assert.match(viewer, /pdf-page-notice/);
  assert.match(viewer, /Do not clamp the deep link onto page 1/);
  const pageLib = readFileSync(join(here, 'pdf-viewer-page.ts'), 'utf8');
  assert.match(pageLib, /isn't in this PDF/);
  assert.match(viewer, /fittedPageBoxHeight/);
  assert.match(viewer, /scrollToPage\(n, 'auto'\)/);
  assert.doesNotMatch(viewer, /goToPage\(Math\.min\(target/);
  assert.doesNotMatch(viewer, /minHeight: ready \? undefined : 480/);

  const viewPage = readFileSync(join(here, '../app/manuals/view/page.tsx'), 'utf8');
  assert.match(viewPage, /params\.get\('page'\)/);
  assert.match(viewPage, /initialPage=\{page\}/);
  assert.match(viewPage, /params\.get\('oor'\) === '1'/);
});

test('chapter tiles number by page order and a one-page file is p. N', () => {
  const chapters = [
    { pageStart: 919, pageCount: 6 },
    { pageStart: 1, pageCount: 40 },
    { pageStart: 107, pageCount: 1 },
  ];
  assert.equal(chapterTileNumber(chapters, 0), 3);
  assert.equal(chapterTileNumber(chapters, 1), 1);
  assert.equal(chapterTileNumber(chapters, 2), 2);
  assert.equal(chapterPageRangeLabel(919, 6), 'pp. 919–924');
  assert.equal(chapterPageRangeLabel(107, 1), 'p. 107');
  assert.equal(chapterPageRangeLabel(107, 2), 'pp. 107–108');
  assert.equal(viewerFolderOutOfRangeNotice(305), "Page 305 isn't in this manual");
  assert.equal(viewerPageOutOfRangeNotice(305, 40), "Page 305 isn't in this PDF");
  assert.equal(viewerCitedPageNotice(88, 15, true), "Page 88 isn't in this PDF");

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /aria-current=\{current \? 'true' : undefined\}/);
  assert.match(viewer, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(viewer, /chapterTileNumber\(/);
  assert.doesNotMatch(viewer, /Chapter \{tileNumber\}/);
  assert.match(viewer, /chapterPageRangeLabel/);
  assert.match(viewer, /viewerFolderOutOfRangeNotice/);
  assert.match(viewer, /Page \{page\} isn't in this manual/);
  assert.match(viewer, /viewerCitedPageNotice/);
  assert.doesNotMatch(viewer, /Chapter \{i \+ 1\}/);
  assert.doesNotMatch(viewer, /pp\. \{ch\.pageStart\}/);
});
