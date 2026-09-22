import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { companyLibraryOpenNeedsAdd } from './manuals-access.ts';
import {
  MANUAL_FIXTURE_PAGE_COUNT,
  MANUAL_FIXTURE_PATH,
  manualViewHref,
  pageTextMatches,
  pdfInlineHeaders,
  PDFJS_SCRIPT_SRC,
  PDFJS_WORKER_SRC,
} from './manuals.ts';

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
  assert.equal(manualViewHref({ id: 105, page: 42, section: '4.2' }), '/manuals/view?id=105&page=42&section=4.2');
  assert.equal(manualViewHref({}), '/manuals/view');
});

test('in-viewer find is a case-insensitive substring match', () => {
  assert.equal(pageTextMatches('Inspect the reservoir cap', 'Reservoir'), true);
  assert.equal(pageTextMatches('Optical train', 'collimator'), false);
  assert.equal(pageTextMatches('Align the collimator', '  COLLIMATOR '), true);
  assert.equal(pageTextMatches('page text', '   '), false);
});

test('bookshelf opens the in-app viewer and does not window.open the PDF', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  const fileRoute = readFileSync(join(here, '../app/api/manuals/file/route.ts'), 'utf8');
  assert.match(page, /openInAppViewer|stashManualView/);
  assert.match(page, /manualViewHref/);
  assert.match(page, /catalogManualTitle/);
  assert.match(page, /\/api\/manuals\/library/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /manualSlotLimit/);
  assert.match(page, /DEFAULT_EQUIPMENT_TYPE|equipmentTypeOrDefault/);
  assert.match(page, /manual-rooms/);
  assert.match(page, /manuals-rail/);
  assert.match(page, /manuals-search|Search manuals/);
  assert.match(page, /filterManualLibrary/);
  assert.doesNotMatch(page, /window\.open/);
  assert.match(viewer, /pdf\.js|pdfjs/);
  assert.doesNotMatch(viewer, /Download|Save as|Open in (Acrobat|Adobe)|window\.open/i);
  assert.match(fileRoute, /pdfInlineHeaders/);
  assert.match(fileRoute, /Content-Disposition/);
  assert.match(fileRoute, /mayViewAiScopedManual|streamAiCatalogPdf/);
});

test('library shelf prompts add when the company does not own the manual', () => {
  assert.equal(companyLibraryOpenNeedsAdd({ owned: false }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: false, inLibrary: true }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true }), false);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, suggestAdd: true }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, inLibrary: false }), true);
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, requiresAdd: true }), true);
  assert.equal(
    companyLibraryOpenNeedsAdd({ owned: true, error: 'Access denied — manual not in company library' }),
    true
  );
  assert.equal(companyLibraryOpenNeedsAdd({ owned: true, error: 'No PDF files found' }), false);
});

test('get-manual-url catalog bypass is only an explicit AI cite read', () => {
  const edge = readFileSync(join(here, '../../supabase/functions/get-manual-url/index.ts'), 'utf8');
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const fileRoute = readFileSync(join(here, '../app/api/manuals/file/route.ts'), 'utf8');
  assert.match(edge, /function wantsAiCatalogRead/);
  assert.match(edge, /function mayViewAiCatalog/);
  assert.match(edge, /if \(!allowed && aiContext\)/);
  assert.match(edge, /wantsAiCatalogRead\(body\)/);
  assert.match(edge, /in_library: false/);
  assert.match(edge, /suggest_add: true/);
  assert.match(edge, /Access denied — manual not in company library/);
  assert.match(edge, /requires_add: true/);
  assert.match(edge, /shared\//);
  assert.doesNotMatch(edge, /storage_path is required/);
  // Unconditional catalog grant (no cite signal) must not remain.
  assert.doesNotMatch(edge, /if \(!allowed\) \{\s*allowed = mayViewAiCatalog/);
  assert.match(viewer, /ai_context:\s*true/);
  assert.match(fileRoute, /ai_context:\s*true/);
  const openFn = page.slice(page.indexOf('async function openManual'), page.indexOf('const discoveryActive'));
  assert.match(openFn, /companyLibraryOpenNeedsAdd/);
  assert.doesNotMatch(openFn, /ai_context:\s*true/);
  const gate = openFn.indexOf('companyLibraryOpenNeedsAdd');
  const stream = openFn.indexOf('openPayloadUrl');
  assert.ok(gate !== -1 && stream !== -1 && gate < stream);
});

test('viewer loads same-origin pdf.js, not a CDN, and can turn pages', () => {
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  const viewPage = readFileSync(join(here, '../app/manuals/view/page.tsx'), 'utf8');
  assert.equal(PDFJS_SCRIPT_SRC, '/pdfjs/pdf.min.js');
  assert.equal(PDFJS_WORKER_SRC, '/pdfjs/pdf.worker.min.js');
  assert.match(viewer, /PDFJS_SCRIPT_SRC/);
  assert.match(viewer, /PDFJS_WORKER_SRC/);
  assert.match(viewer, /disableWorker/);
  assert.match(viewer, /openSrc\(\{ url:/);
  assert.match(viewer, /data-pdf-page/);
  assert.match(viewer, /Find in manual/);
  assert.match(viewer, /viewer-rail|Ask about this manual|ViewerAiPanel/);
  assert.match(viewer, /initialPage/);
  assert.match(viewPage, /initialPage|params\.get\('page'\)/);
  assert.match(viewer, /Incomplete/);
  assert.match(viewer, /isIncomplete|is_incomplete/);
  assert.match(viewer, /Next ►/);
  assert.match(viewer, /◄ Prev/);
  assert.doesNotMatch(viewer, /cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com/);
  assert.doesNotMatch(viewer, /<iframe|<embed |<object /i);
  assert.match(viewPage, /fixed inset-0/);
  assert.match(viewPage, /ManualPdfViewer/);
});

test('repo fixture is a searchable three-page PDF (not a live org file)', () => {
  const fixtureRel = join(here, '..', 'public', MANUAL_FIXTURE_PATH.replace(/^\//, ''));
  assert.equal(existsSync(fixtureRel), true);
  const bytes = readFileSync(fixtureRel);
  const text = bytes.toString('latin1');
  assert.match(text, /^%PDF-1\./);
  assert.match(text, /\/Count 3/);
  assert.equal(MANUAL_FIXTURE_PAGE_COUNT, 3);
  assert.match(text, /reservoir/);
  assert.match(text, /collimator/);
  assert.match(text, /Page 1 of 3/);
  assert.match(text, /Page 2 of 3/);
  assert.match(text, /Page 3 of 3/);
});

test('fixture demo page uses the in-repo PDF and the same viewer', () => {
  const demo = readFileSync(join(here, '../app/pdf-viewer-demo/page.tsx'), 'utf8');
  assert.match(demo, /ManualPdfViewer/);
  assert.match(demo, /MANUAL_FIXTURE_PATH|sample-service-manual\.pdf/);
  assert.match(demo, /initialPage|params\.get\('page'\)/);
  assert.doesNotMatch(demo, /get-manual-url|repairplanet|window\.open/i);
});

test('Owner Hub does not expose Service Manuals or repair AI tiles', () => {
  const hub = readFileSync(join(here, '../app/hub/page.tsx'), 'utf8');
  const ownerBlock = hub.split('const techCards')[1].split(': supplier')[0];
  const serviceBlock = hub.split(': supplier')[1];
  assert.match(ownerBlock, /href: '\/manuals'/);
  assert.match(ownerBlock, /Operators Manuals/);
  assert.doesNotMatch(ownerBlock, /Service Manuals/);
  assert.doesNotMatch(ownerBlock, /href: '\/ai-assistant'/);
  assert.match(serviceBlock, /href: '\/manuals'/);
  assert.doesNotMatch(serviceBlock, /href: '\/manuals\?lib=operators'/);
  assert.match(serviceBlock, /href: '\/ai-assistant'/);
  const header = readFileSync(join(here, '../components/Header.tsx'), 'utf8');
  assert.doesNotMatch(header, /href: '\/manuals\?lib=operators'/);
  assert.match(header, /Operators Manuals/);
});
