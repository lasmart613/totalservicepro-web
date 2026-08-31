import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogManualKind,
  catalogManualKindLabel,
  catalogManualTitle,
  inferKindFromDocumentText,
  isBareVbeamOperatorTitle,
  isVbeamFamily,
  isVbeamModelSpecificTitle,
  presentManual,
  showOperatorBadge,
} from './manual-catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('title "VBeam" is the Operator\'s Manual and gets the OP badge', () => {
  const row = { brand: 'Candela', title: 'VBeam' };
  assert.equal(isBareVbeamOperatorTitle(row.title), true);
  assert.equal(catalogManualKind(row), 'operator');
  assert.equal(showOperatorBadge(row), true);
  assert.equal(catalogManualTitle(row), "VBeam Operator's Manual");
  assert.equal(catalogManualKindLabel(catalogManualKind(row)), "Operator's Manual");
  assert.equal(catalogManualKind({ title: 'V-Beam' }), 'operator');
  assert.equal(showOperatorBadge({ title: 'Vbeam' }), true);
  assert.equal(catalogManualKind({ title: 'Candela VBeam' }), 'operator');
});

test('title "VBeam Perfecta" is the Service Manual and has no OP badge', () => {
  const row = { brand: 'Candela', title: 'VBeam Perfecta' };
  assert.equal(isVbeamModelSpecificTitle(row.title), true);
  assert.equal(isBareVbeamOperatorTitle(row.title), false);
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(showOperatorBadge(row), false);
  assert.equal(catalogManualTitle(row), 'VBeam Perfecta');
  assert.equal(catalogManualKindLabel(catalogManualKind(row)), 'Service Manual');
});

test('VBeam Service Manual stays Service Manual with no OP badge', () => {
  const row = { brand: 'Candela', title: 'VBeam Service Manual', storage_path: 'shared/candela/vbeam.pdf' };
  assert.equal(isVbeamFamily(row), true);
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(catalogManualTitle(row), 'VBeam Service Manual');
  assert.equal(showOperatorBadge(row), false);
});

test('model-specific VBeam titles stay service (no family blanket)', () => {
  assert.equal(catalogManualKind({ title: 'VBeam Perfecta Service Manual' }), 'service');
  assert.equal(showOperatorBadge({ title: 'VBeam Perfecta Service Manual' }), false);
  assert.equal(catalogManualKind({ title: 'VBeam Platinum' }), 'service');
  assert.equal(showOperatorBadge({ title: 'VBeam Aesthetica' }), false);
  assert.equal(catalogManualKind({ title: 'VBeam 2' }), 'service');
  assert.equal(showOperatorBadge({ title: 'V-Beam 1' }), false);
});

test('stored Operator / User Manual wording keeps OP', () => {
  const op = { title: "VBeam Perfecta Operator's Manual" };
  assert.equal(catalogManualKind(op), 'operator');
  assert.equal(catalogManualTitle(op), "VBeam Perfecta Operator's Manual");
  assert.equal(showOperatorBadge(op), true);
  assert.equal(showOperatorBadge({ title: 'Candela VBeam User Manual' }), true);
});

test('path or PDF text does not flip the two named VBeam rows', () => {
  assert.equal(
    catalogManualKind({
      title: 'VBeam Perfecta',
      storage_path: "shared/candela/VBeam Operator's Manual/8501-00-0000.pdf",
    }),
    'service'
  );
  assert.equal(showOperatorBadge({ title: 'VBeam Perfecta', pdfText: "OPERATOR'S MANUAL" }), false);
  assert.equal(
    catalogManualKind({
      title: 'VBeam',
      storage_path: 'shared/candela/VBeam Service Manual/foo.pdf',
    }),
    'operator'
  );
  assert.equal(showOperatorBadge({ title: 'VBeam', pdfText: 'Service Manual' }), true);
});

test('PDF first-page text can still classify unrelated ambiguous titles', () => {
  const op = { title: 'Unknown dye laser', pdfText: "OPERATOR'S MANUAL\nVBeam Perfecta" };
  assert.equal(inferKindFromDocumentText(op.pdfText), 'operator');
  assert.equal(catalogManualKind(op), 'operator');
});

test('blanket doc_kind=operator does not OP VBeam Perfecta', () => {
  const row = { title: 'VBeam Perfecta', doc_kind: 'operator' };
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(showOperatorBadge(row), false);
});

test('non-VBeam service manuals are unchanged', () => {
  const row = { brand: 'Lumenis', title: 'AcuPulse Service Manual' };
  assert.equal(isVbeamFamily(row), false);
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(catalogManualTitle(row), 'AcuPulse Service Manual');
  assert.equal(showOperatorBadge(row), false);
});

test('presentManual keeps a service title and remaps bare VBeam for display', () => {
  const svc = presentManual({
    id: 9,
    title: 'VBeam Service Manual',
    storage_path: 'shared/candela/vbeam.pdf',
  });
  assert.equal(svc.displayTitle, 'VBeam Service Manual');
  assert.equal(svc.docKind, 'service');

  const op = presentManual({ id: 10, title: 'VBeam' });
  assert.equal(op.displayTitle, "VBeam Operator's Manual");
  assert.equal(op.docKind, 'operator');
});

test('bookshelf gates the OP badge on catalogManualKind / showOperatorBadge', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const catalog = readFileSync(join(here, 'manual-catalog.ts'), 'utf8');
  assert.match(page, /catalogManualTitle/);
  assert.match(page, /showOperatorBadge/);
  assert.match(catalog, /isBareVbeamOperatorTitle/);
  assert.doesNotMatch(catalog, /isVbeamFamily\(manual\) return 'operator'/);
});
