import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manualViewHref, pdfInlineHeaders } from './manuals.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('manual PDFs are served inline, not as attachments', () => {
  const headers = pdfInlineHeaders('GentleMax Pro.pdf');
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /^inline; filename="GentleMax-Pro\.pdf"$/);
  assert.doesNotMatch(headers['Content-Disposition'], /attachment/i);
  const withQuote = pdfInlineHeaders('bad"name.pdf');
  assert.match(withQuote['Content-Disposition'], /^inline; filename="badname\.pdf"$/);
});

test('manual view href stays on the in-app route', () => {
  assert.equal(manualViewHref({ id: 9, title: 'Vbeam' }), '/manuals/view?id=9&title=Vbeam');
  assert.equal(manualViewHref({}), '/manuals/view');
});

test('bookshelf opens the in-app viewer and does not window.open the PDF', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  const fileRoute = readFileSync(join(here, '../app/api/manuals/file/route.ts'), 'utf8');
  assert.match(page, /openInAppViewer|stashManualView/);
  assert.match(page, /manualViewHref/);
  assert.match(page, /\/api\/manuals\/library/);
  assert.match(page, /manualSlotLimit/);
  assert.doesNotMatch(page, /window\.open/);
  assert.match(viewer, /pdf\.js|pdfjs/);
  assert.doesNotMatch(viewer, /Download|Save as|Open in (Acrobat|Adobe)|window\.open/i);
  assert.match(fileRoute, /pdfInlineHeaders/);
  assert.match(fileRoute, /Content-Disposition/);
});
