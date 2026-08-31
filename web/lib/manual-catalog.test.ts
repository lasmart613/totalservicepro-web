import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogManualKind,
  catalogManualKindLabel,
  catalogManualTitle,
  isVbeamFamily,
  presentManual,
} from './manual-catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('VBeam Service Manual title is retitled to Operator\'s Manual', () => {
  const row = { brand: 'Candela', title: 'VBeam Service Manual', storage_path: 'shared/candela/vbeam.pdf' };
  assert.equal(isVbeamFamily(row), true);
  assert.equal(catalogManualKind(row), 'operator');
  assert.equal(catalogManualTitle(row), "VBeam Operator's Manual");
  assert.equal(catalogManualKindLabel(catalogManualKind(row)), "Operator's Manual");
});

test('VBeam Perfecta / V-Beam 1 / Platinum / Aesthetica are the same family', () => {
  assert.equal(catalogManualTitle({ title: 'VBeam Perfecta Service Manual' }), "VBeam Perfecta Operator's Manual");
  assert.equal(catalogManualTitle({ title: 'Candela V-Beam 1 Service Manual' }), "Candela V-Beam 1 Operator's Manual");
  assert.equal(catalogManualTitle({ brand: 'Candela', title: 'Perfecta', model: 'Perfecta' }), "Perfecta Operator's Manual");
  assert.equal(
    catalogManualTitle({ brand: 'Candela', title: 'Aesthetica Service Manual' }),
    "Aesthetica Operator's Manual"
  );
  assert.equal(
    catalogManualKind({ brand: 'Candela', title: 'VBeam Platinum', model: 'Platinum' }),
    'operator'
  );
});

test('bare VBeam title still gets an Operator\'s Manual suffix (library is otherwise all service manuals)', () => {
  assert.equal(catalogManualTitle({ title: 'VBeam Perfecta' }), "VBeam Perfecta Operator's Manual");
  assert.equal(catalogManualTitle({ title: "VBeam Perfecta Operator's Manual" }), "VBeam Perfecta Operator's Manual");
});

test('explicit doc_kind=service leaves a future real VBeam service manual alone', () => {
  const row = { title: 'VBeam Service Manual', doc_kind: 'service' };
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(catalogManualTitle(row), 'VBeam Service Manual');
});

test('non-VBeam service manuals are unchanged', () => {
  const row = { brand: 'Lumenis', title: 'AcuPulse Service Manual' };
  assert.equal(isVbeamFamily(row), false);
  assert.equal(catalogManualKind(row), 'service');
  assert.equal(catalogManualTitle(row), 'AcuPulse Service Manual');
});

test('presentManual exposes display fields without mutating storage_path', () => {
  const shown = presentManual({
    id: 9,
    title: 'VBeam Service Manual',
    storage_path: 'shared/candela/vbeam.pdf',
  });
  assert.equal(shown.displayTitle, "VBeam Operator's Manual");
  assert.equal(shown.docKind, 'operator');
  assert.equal(shown.storage_path, 'shared/candela/vbeam.pdf');
  assert.equal(shown.title, 'VBeam Service Manual');
});

test('bookshelf and AI picker use catalog titles, not raw Service Manual for VBeam', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const ai = readFileSync(join(here, '../app/ai-assistant/AIAssistantClient.tsx'), 'utf8');
  assert.match(page, /catalogManualTitle/);
  assert.match(page, /catalogManualKind/);
  assert.match(ai, /catalogManualTitle/);
});
