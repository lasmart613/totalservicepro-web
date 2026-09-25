import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listModelsForManufacturer, OTHER_MODEL } from './laser-catalog.ts';
import {
  OTHER_MANUFACTURER,
  resolveTicketEquipment,
  selectionAfterManufacturerChange,
} from './ticket-equipment.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('known catalog make and model are stored as those labels', () => {
  const candela = listModelsForManufacturer('Candela');
  const model = candela.find((name) => /GentleMAX PRO/i.test(name));
  assert.ok(model, 'Candela catalog should include GentleMAX PRO');
  assert.equal(listModelsForManufacturer('Sciton').includes(model!), false);

  const fields = resolveTicketEquipment({
    manufacturer: 'Candela',
    customManufacturer: 'ignored',
    model: model!,
    customModel: 'ignored',
  });
  assert.equal(fields.equipment_make, 'Candela');
  assert.equal(fields.equipment_model, model);
  assert.notEqual(fields.equipment_make, OTHER_MANUFACTURER);
  assert.notEqual(fields.equipment_model, OTHER_MODEL);
});

test('Other stores the typed manufacturer and model, never the sentinel', () => {
  const fields = resolveTicketEquipment({
    manufacturer: OTHER_MANUFACTURER,
    customManufacturer: '  Acme Lasers  ',
    model: OTHER_MODEL,
    customModel: ' ZX-9 ',
  });
  assert.equal(fields.equipment_make, 'Acme Lasers');
  assert.equal(fields.equipment_model, 'ZX-9');
});

test('catalog manufacturer with Other model stores the custom model only', () => {
  const fields = resolveTicketEquipment({
    manufacturer: 'Cutera',
    customManufacturer: 'nope',
    model: OTHER_MODEL,
    customModel: 'Secret Handpiece',
  });
  assert.equal(fields.equipment_make, 'Cutera');
  assert.equal(fields.equipment_model, 'Secret Handpiece');
});

test('blank Other values are stored as null', () => {
  const fields = resolveTicketEquipment({
    manufacturer: OTHER_MANUFACTURER,
    customManufacturer: '   ',
    model: OTHER_MODEL,
    customModel: '',
  });
  assert.equal(fields.equipment_make, null);
  assert.equal(fields.equipment_model, null);
});

test('Other manufacturer stores the typed model when the model dropdown is cleared', () => {
  const fields = resolveTicketEquipment({
    manufacturer: OTHER_MANUFACTURER,
    customManufacturer: 'New IPL Co',
    model: '',
    customModel: 'Handheld 2',
  });
  assert.equal(fields.equipment_make, 'New IPL Co');
  assert.equal(fields.equipment_model, 'Handheld 2');
});

test('clearing or changing manufacturer resets model', () => {
  const cleared = selectionAfterManufacturerChange('', 'Acme');
  assert.equal(cleared.equipment_make, '');
  assert.equal(cleared.equipment_model, '');
  assert.equal(cleared.equipment_model_other, '');

  const changed = selectionAfterManufacturerChange('Cutera', '');
  assert.equal(changed.equipment_make, 'Cutera');
  assert.equal(changed.equipment_model, '');
  assert.equal(changed.equipment_make_other, '');

  const other = selectionAfterManufacturerChange(OTHER_MANUFACTURER, 'Acme Lasers');
  assert.equal(other.equipment_make, OTHER_MANUFACTURER);
  assert.equal(other.equipment_make_other, 'Acme Lasers');
  assert.equal(other.equipment_model, OTHER_MODEL);
  assert.equal(other.equipment_model_other, '');
});

test('calendar add-ticket form uses the shared catalog dropdowns and persists resolved values', () => {
  const src = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(src, /useEquipmentCatalog/);
  assert.match(src, /listManufacturerChoices\(catalog\)/);
  assert.match(src, /listModelChoices\(form\.equipment_make, catalog\)/);
  assert.match(src, /OTHER_MANUFACTURER/);
  assert.match(src, /OTHER_MODEL/);
  assert.match(src, /selectionAfterManufacturerChange/);
  assert.match(src, /resolveTicketEquipment/);
  assert.match(src, /equipment_make: equipment\.equipment_make/);
  assert.match(src, /equipment_model: equipment\.equipment_model/);
  assert.match(src, /Other \/ custom…/);
  assert.doesNotMatch(src, /equipment_make: form\.equipment_make\.trim\(\)/);
  assert.doesNotMatch(src, /placeholder="e\.g\. Candela"/);
  assert.doesNotMatch(src, /placeholder="e\.g\. GentleMAX Pro"/);
});
