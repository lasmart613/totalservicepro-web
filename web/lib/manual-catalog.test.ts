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
  isVbeamFamily,
  presentManual,
  showOperatorBadge,
} from './manual-catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('VBeam Service Manual stays Service Manual with no OP badge', () => {
  const row = { brand: 'Candela', title: 'VBeam Service Manual', storage_path: 'shared/candela/vbeam.pdf' };
  assert.equal(isVbeamFamily(row), true);
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(catalogManualTitle(row), 'VBeam Service Manual');
  assert.equal(showOperatorBadge(row), false);
  assert.equal(catalogManualKindLabel(catalogManualKind(row)), 'Service Manual');
});

test('VBeam Perfecta / V-Beam 1 / Platinum / Aesthetica service titles are not remapped', () => {
  assert.equal(catalogManualTitle({ title: 'VBeam Perfecta Service Manual' }), 'VBeam Perfecta Service Manual');
  assert.equal(catalogManualKind({ title: 'VBeam Perfecta Service Manual' }), 'service');
  assert.equal(showOperatorBadge({ title: 'VBeam Perfecta Service Manual' }), false);
  assert.equal(catalogManualKind({ title: 'Candela V-Beam 1 Service Manual' }), 'service');
  assert.equal(catalogManualKind({ brand: 'Candela', title: 'Aesthetica Service Manual' }), 'service');
  assert.equal(catalogManualKind({ brand: 'Candela', title: 'VBeam Platinum', model: 'Platinum' }), 'service');
  assert.equal(showOperatorBadge({ brand: 'Candela', title: 'Perfecta', model: 'Perfecta' }), false);
});

test('only titles that already say Operator / User Manual get OP', () => {
  const op = { title: "VBeam Perfecta Operator's Manual" };
  assert.equal(catalogManualKind(op), 'operator');
  assert.equal(catalogManualTitle(op), "VBeam Perfecta Operator's Manual");
  assert.equal(showOperatorBadge(op), true);

  assert.equal(catalogManualKind({ title: 'VBeam Operator Manual' }), 'operator');
  assert.equal(showOperatorBadge({ title: 'Candela VBeam User Manual' }), true);
  assert.equal(catalogManualTitle({ title: 'VBeam Perfecta' }), 'VBeam Perfecta');
  assert.equal(showOperatorBadge({ title: 'VBeam Perfecta' }), false);
});

test('storage_path Operator Manual is enough when title is a model-only name', () => {
  const row = {
    title: 'VBeam Perfecta',
    storage_path: "shared/candela/VBeam Operator's Manual/8501-00-0000.pdf",
  };
  assert.equal(catalogManualKind(row), 'operator');
  assert.equal(showOperatorBadge(row), true);
  assert.equal(catalogManualTitle(row), 'VBeam Perfecta');
});

test('storage_path Service Manual does not get OP even if doc_kind was blanket-set', () => {
  const row = {
    title: 'VBeam',
    storage_path: 'shared/candela/VBeam Service Manual/foo.pdf',
    doc_kind: 'operator',
  };
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(showOperatorBadge(row), false);
});

test('PDF first-page text can classify when title is ambiguous', () => {
  const op = { title: 'VBeam Perfecta', pdfText: "OPERATOR'S MANUAL\nVBeam Perfecta" };
  assert.equal(inferKindFromDocumentText(op.pdfText), 'operator');
  assert.equal(catalogManualKind(op), 'operator');
  assert.equal(showOperatorBadge(op), true);

  const svc = { title: 'VBeam Perfecta', pdfText: 'Service Manual\nRepair procedures' };
  assert.equal(catalogManualKind(svc), 'service');
  assert.equal(showOperatorBadge(svc), false);
});

test('blanket doc_kind=operator without title evidence does not apply OP', () => {
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

test('presentManual keeps storage_path and the stored service title', () => {
  const shown = presentManual({
    id: 9,
    title: 'VBeam Service Manual',
    storage_path: 'shared/candela/vbeam.pdf',
  });
  assert.equal(shown.displayTitle, 'VBeam Service Manual');
  assert.equal(shown.docKind, 'service');
  assert.equal(shown.storage_path, 'shared/candela/vbeam.pdf');
  assert.equal(shown.title, 'VBeam Service Manual');
});

test('bookshelf gates the OP badge on catalogManualKind / showOperatorBadge', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const catalog = readFileSync(join(here, 'manual-catalog.ts'), 'utf8');
  assert.match(page, /catalogManualTitle/);
  assert.match(page, /catalogManualKind/);
  assert.match(page, /showOperatorBadge/);
  assert.doesNotMatch(catalog, /isVbeamFamily\(manual\) return 'operator'/);
});
