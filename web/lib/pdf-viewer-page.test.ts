import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fittedPageBoxHeight, viewerPageOutOfRangeNotice, viewerPhysicalPage } from './pdf-viewer-page.ts';

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
  const letter = fittedPageBoxHeight(612, 792, 800, 1);
  assert.ok(letter > 900, `fitted page box should be a real page, got ${letter}`);

  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(viewer, /viewerPhysicalPage/);
  assert.match(viewer, /viewerPageOutOfRangeNotice/);
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
});
