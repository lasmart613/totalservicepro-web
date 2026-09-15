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
  isKnownMisShelvedOperator,
  isVbeamFamily,
  isVbeamModelSpecificTitle,
  manualLibraryShelf,
  presentManual,
  isManualIncomplete,
  showIncompleteBadge,
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

test('stored doc_kind=operator shelves non-VBeam rows on Operators', () => {
  const row = { title: 'Lyra', brand: 'Lasering', doc_kind: 'operator' };
  assert.equal(catalogManualKind(row), 'operator');
  assert.equal(manualLibraryShelf(row), 'operators');
  assert.equal(showOperatorBadge(row), true);
});

test('IFU / Instructions for Use are Operators, not Service', () => {
  assert.equal(catalogManualKind({ title: 'Litho IFU (EN)' }), 'operator');
  assert.equal(manualLibraryShelf({ title: 'Litho IFU (EN)' }), 'operators');
  assert.equal(inferKindFromDocumentText('Instructions for Use'), 'operator');
  assert.equal(catalogManualKind({ title: 'Quanta Litho IFU' }), 'operator');
});

test('Operating Instructions and Instruction Manual are Operators', () => {
  assert.equal(inferKindFromDocumentText('Operating Instructions'), 'operator');
  assert.equal(inferKindFromDocumentText('User Instruction Manual'), 'operator');
  assert.equal(catalogManualKind({ title: 'CL-100 Computerized Lensmeter Instruction Manual' }), 'operator');
  assert.equal(manualLibraryShelf({ title: 'CL-100 Computerized Lensmeter Instruction Manual' }), 'operators');
  assert.equal(showOperatorBadge({ title: 'CL-100 Computerized Lensmeter Instruction Manual' }), true);
  assert.equal(catalogManualTitle({ title: 'CL-100 Computerized Lensmeter Instruction Manual' }), 'CL-100 Computerized Lensmeter Instruction Manual');
  assert.equal(catalogManualKind({ title: 'Matrix CO2 Surgical Laser System Operating Instructions' }), 'operator');
  assert.equal(manualLibraryShelf({ title: 'VRM III Operating Instructions' }), 'operators');
  assert.equal(catalogManualKind({ title: 'Penlon Sigma Elite Vaporizer User Instruction Manual' }), 'operator');
  assert.equal(catalogManualKind({ title: 'Ellman Surgitron 4.0 Dual RF 120 Instruction Manual' }), 'operator');
});

test('negated service phrases do not count as service', () => {
  const sonoline = {
    title: 'Siemens SONOLINE Antares Gebruiksaanwijzing (Dutch IFU/Operator; not service manual)',
  };
  assert.equal(inferKindFromDocumentText(sonoline.title), 'operator');
  assert.equal(catalogManualKind(sonoline), 'operator');
  assert.equal(manualLibraryShelf(sonoline), 'operators');
  assert.equal(showOperatorBadge(sonoline), true);
  const ellman = {
    title: 'Ellman Surgitron 4.0 Dual RF 120 Instruction Manual (incomplete; OP/instruction — not full SM)',
  };
  assert.equal(inferKindFromDocumentText(ellman.title), 'operator');
  assert.equal(manualLibraryShelf(ellman), 'operators');
  assert.equal(showOperatorBadge(ellman), true);
});

test('hybrid Operator & Service stays on the Service shelf with no OP badge', () => {
  const starwalker = { title: 'StarWalker Operator / Service' };
  assert.equal(inferKindFromDocumentText(starwalker.title), 'service');
  assert.equal(catalogManualKind(starwalker), 'service');
  assert.equal(manualLibraryShelf(starwalker), 'service');
  assert.equal(showOperatorBadge(starwalker), false);
  const zimmer = { title: 'Zimmer A.T.S. Operator & Service Manuals' };
  assert.equal(catalogManualKind(zimmer), 'service');
  assert.equal(manualLibraryShelf(zimmer), 'service');
  assert.equal(showOperatorBadge(zimmer), false);
  const mrl = { title: 'MRL Portable Defibrillator Service Instruction Manual' };
  assert.equal(inferKindFromDocumentText(mrl.title), 'service');
  assert.equal(catalogManualKind(mrl), 'service');
  assert.equal(manualLibraryShelf(mrl), 'service');
  assert.equal(showOperatorBadge(mrl), false);
});

test('Lyra 767 OP-in-SM-shelf cases go to the Operators library', () => {
  const row = { title: 'Lyra 767', brand: 'Lasering', storage_path: 'shared/lasering/lyra-767.pdf' };
  assert.equal(isKnownMisShelvedOperator(row), true);
  assert.equal(catalogManualKind(row), 'operator');
  assert.equal(manualLibraryShelf(row), 'operators');
  assert.equal(showOperatorBadge(row), true);
  assert.equal(catalogManualKind({ title: 'Lyra-767 Service Manual' }), 'operator');
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

test('operator-shelf migration adds doc_kind and backfills the verified instruction/IFU rows', () => {
  const sql = readFileSync(
    join(here, '../supabase/migrations/20260915_000000_manuals_doc_kind_operator_shelf.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS doc_kind/);
  assert.match(sql, /doc_kind = 'operator'/);
  assert.match(sql, /204,\s*662,\s*712,\s*716,\s*740,\s*769/);
  assert.match(sql, /operating\\s\+instructions/);
  assert.match(sql, /instruction\\s\+manuals/);
  assert.match(sql, /gebruiksaanwijzing/);
  assert.match(sql, /not\\s\+\(a\(n\)\?\\s\+\|the\\s\+\|full\\s\+\)\*\(service\\s\+manuals\?\|sm\)/);
  assert.match(sql, /131,\s*504,\s*545,\s*546,\s*547/);
});

test('bookshelf gates the OP badge on catalogManualKind / showOperatorBadge', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const catalog = readFileSync(join(here, 'manual-catalog.ts'), 'utf8');
  assert.match(page, /catalogManualTitle/);
  assert.match(page, /showOperatorBadge/);
  assert.match(page, /Operators Manuals/);
  assert.match(page, /selectLibrary|library === 'operators'/);
  assert.match(page, /role="tablist" aria-label="Manual libraries"/);
  assert.match(page, /canService !== false/);
  assert.match(page, /mayOpenManual/);
  assert.match(catalog, /isBareVbeamOperatorTitle/);
  assert.match(catalog, /isKnownMisShelvedOperator/);
  assert.doesNotMatch(catalog, /isVbeamFamily\(manual\) return 'operator'/);
});

test('Incomplete badge follows is_incomplete, not the H20/H30 title', () => {
  assert.equal(showIncompleteBadge({ title: 'Dornier H20/H30' }), false);
  assert.equal(isManualIncomplete({ title: 'Dornier H20/H30', is_incomplete: true }), true);
  assert.equal(showIncompleteBadge({ title: 'Any title', isIncomplete: true }), true);
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const viewer = readFileSync(join(here, '../components/ManualPdfViewer.tsx'), 'utf8');
  assert.match(page, /showIncompleteBadge/);
  assert.match(page, />\s*Incomplete\s*</);
  assert.match(viewer, /Incomplete/);
  assert.match(viewer, /is_incomplete/);
});
