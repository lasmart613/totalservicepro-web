import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchEquipmentCatalog,
  listCatalogManufacturers,
  listCatalogModels,
  manufacturerMatches,
  modelBelongsToManufacturer,
  modelMatchesEquipmentType,
  normalizeManufacturerRow,
  normalizeModelRow,
} from './equipment-dropdown.ts';
import { listManufacturers, listModelsForManufacturer } from './laser-catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** Live DB shape Larry verified — used only as join fixtures, not as a seed. */
const CUTERA = normalizeManufacturerRow({ id: 10, name: 'Cutera', category: 'Medical Laser' });
const CYNOSURE = normalizeManufacturerRow({ id: 3, name: 'Cynosure' });
const CANDELA = normalizeManufacturerRow({ id: 2, name: 'Candela' });
const GE_OEC = normalizeManufacturerRow({ id: 99, name: 'GE OEC' });

const CUTERA_MODELS = [
  { id: 154, name: 'Xeo', label: 'Xeo', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 155, name: 'Excel V', label: 'Excel V', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 156, name: 'Excel V+', label: 'Excel V+', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 157, name: 'Enlighten', label: 'Enlighten', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 158, name: 'Enlighten III', label: 'Enlighten III', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 159, name: 'Excel HR', label: 'Excel HR', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 160, name: 'truSculpt', label: 'truSculpt', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 161, name: 'TruSculpt', label: 'TruSculpt', manufacturer_id: 10, equipment_type: 'laser' },
  { id: 162, name: 'coolglide', label: 'CoolGlide', manufacturer_id: 10, equipment_type: 'laser' },
].map(normalizeModelRow);

const LIVE = {
  manufacturers: [CUTERA, CYNOSURE, CANDELA, GE_OEC],
  models: [
    ...CUTERA_MODELS,
    normalizeModelRow({
      id: 200,
      name: 'Apogee Elite MPX',
      label: 'Apogee Elite MPX',
      manufacturer_id: 3,
      equipment_type: 'laser',
    }),
    normalizeModelRow({
      id: 201,
      name: 'VBeam Perfecta',
      label: 'VBeam Perfecta',
      manufacturer_id: 2,
      equipment_type: 'laser',
    }),
    normalizeModelRow({
      id: 202,
      name: '9900',
      label: 'OEC 9900',
      manufacturer_id: 99,
      equipment_type: 'c_arm',
    }),
  ],
};

test('Cutera live rows appear when joining by manufacturer name (estimate form value)', () => {
  const names = listCatalogModels('Cutera', LIVE);
  assert.ok(names.includes('Xeo'), 'Xeo must appear for Cutera');
  assert.ok(names.includes('Excel V'));
  assert.ok(names.includes('Excel V+'));
  assert.ok(names.includes('Enlighten'));
  assert.ok(names.includes('Enlighten III'));
  assert.ok(names.includes('Excel HR'));
  assert.ok(names.some((n) => /trusculpt/i.test(n)));
  assert.ok(names.some((n) => /coolglide/i.test(n)));
  assert.ok(names.length >= 8);
});

test('Cutera live rows appear when selected value is manufacturer_id 10', () => {
  const names = listCatalogModels('10', LIVE);
  assert.ok(names.includes('Xeo'));
  assert.ok(names.includes('Excel V'));
});

test('manufacturer_id vs name join (tickets / company bug) does not empty Cutera', () => {
  assert.equal(manufacturerMatches('Cutera', CUTERA), true);
  assert.equal(manufacturerMatches('10', CUTERA), true);
  assert.equal(manufacturerMatches('cutera', CUTERA), true);
  for (const model of CUTERA_MODELS) {
    assert.equal(
      modelBelongsToManufacturer(model, 'Cutera', LIVE.manufacturers),
      true,
      `${model.label} should belong to Cutera by name`
    );
  }
  // The broken filter compared manufacturer_id (10) to the selected name.
  assert.equal(String(CUTERA_MODELS[0].manufacturer_id) === 'Cutera', false);
});

test('equipment_type laser does not blank Cutera; c_arm hides laser models', () => {
  const laser = listCatalogModels('Cutera', { ...LIVE, equipmentType: 'laser' });
  assert.ok(laser.includes('Xeo'));
  assert.ok(laser.includes('Excel V'));

  const blankType = listCatalogModels('Cutera', {
    manufacturers: LIVE.manufacturers,
    models: [
      ...CUTERA_MODELS,
      normalizeModelRow({
        id: 163,
        name: 'Legacy Xeo',
        label: 'Legacy Xeo',
        manufacturer_id: 10,
        equipment_type: null,
      }),
    ],
    equipmentType: 'laser',
  });
  assert.ok(blankType.includes('Legacy Xeo'), 'null equipment_type still counts as laser');

  const carm = listCatalogModels('Cutera', { ...LIVE, equipmentType: 'c_arm' });
  assert.equal(carm.includes('Xeo'), false);
  assert.ok(listCatalogModels('GE OEC', { ...LIVE, equipmentType: 'c_arm' }).includes('OEC 9900'));
});

test('Cynosure and Candela still populate with live + static merge', () => {
  const cynosure = listCatalogModels('Cynosure', LIVE);
  assert.ok(cynosure.includes('Apogee Elite MPX'));
  assert.ok(cynosure.includes('PicoSure'));

  const candela = listCatalogModels('Candela', LIVE);
  assert.ok(candela.length > 0);
  assert.ok(candela.some((name) => /gentle|vbeam|v-beam|perfecta/i.test(name)));
});

test('manufacturer list always includes laser brands even with Medical Laser category', () => {
  const mfrs = listCatalogManufacturers(LIVE);
  assert.ok(mfrs.includes('Cutera'));
  assert.ok(mfrs.includes('Cynosure'));
  assert.ok(mfrs.includes('Candela'));
  assert.ok(mfrs.includes('GE OEC'));
});

test('static fallback lists Cutera models without live rows', () => {
  const mfrs = listManufacturers();
  assert.ok(mfrs.includes('Cutera'));
  const cutera = listModelsForManufacturer('Cutera');
  assert.ok(cutera.length > 0, 'static Cutera fallback must not be empty');
  assert.ok(cutera.includes('Xeo'));
});

test('Quanta / GE aliases still resolve biomed catalog models', () => {
  assert.ok(listModelsForManufacturer('Quanta').some((n) => /litho/i.test(n)));
  assert.ok(listModelsForManufacturer('Quanta System').some((n) => /litho/i.test(n)));
  assert.ok(listModelsForManufacturer('GE OEC', { equipmentType: 'c_arm' }).includes('OEC 9900'));
});

test('normalizeModelRow works when live laser_models has no label column', () => {
  const row = normalizeModelRow({
    id: 154,
    name: 'Xeo',
    manufacturer_id: 10,
    equipment_type: 'laser',
  });
  assert.equal(row.label, 'Xeo');
  assert.equal(row.name, 'Xeo');
  assert.equal(row.manufacturer_id, 10);
});

test('modelMatchesEquipmentType treats blank as laser', () => {
  assert.equal(modelMatchesEquipmentType('laser', 'laser'), true);
  assert.equal(modelMatchesEquipmentType(null, 'laser'), true);
  assert.equal(modelMatchesEquipmentType('', 'laser'), true);
  assert.equal(modelMatchesEquipmentType('c_arm', 'laser'), false);
  assert.equal(modelMatchesEquipmentType('c_arm', 'c_arm'), true);
  assert.equal(modelMatchesEquipmentType('laser', null), true);
});

test('fetchEquipmentCatalog pages manufacturers and laser_models', async () => {
  const calls: Array<{ table: string; from: number; to: number }> = [];
  const fake = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        order() {
          return this;
        },
        range(from: number, to: number) {
          calls.push({ table, from, to });
          if (table === 'manufacturers') {
            return Promise.resolve({ data: [{ id: 10, name: 'Cutera' }], error: null });
          }
          return Promise.resolve({
            data: [{ id: 154, name: 'Xeo', label: 'Xeo', manufacturer_id: 10, equipment_type: 'laser' }],
            error: null,
          });
        },
      };
    },
  };
  const cat = await fetchEquipmentCatalog(fake);
  assert.ok(calls.some((c) => c.table === 'manufacturers'));
  assert.ok(calls.some((c) => c.table === 'laser_models'));
  assert.equal(cat.manufacturers[0]?.name, 'Cutera');
  assert.equal(cat.models[0]?.label, 'Xeo');
});

test('estimate form and invoice form load the live catalog join', () => {
  const estimate = readFileSync(join(here, '../app/estimates/new/EstimateFormClient.tsx'), 'utf8');
  assert.match(estimate, /useEquipmentCatalog/);
  assert.match(estimate, /listModelsForManufacturer/);
  assert.match(estimate, /equipmentType|equipment_type/);
  assert.doesNotMatch(estimate, /listManufacturers\(\)/);

  const invoice = readFileSync(join(here, '../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  assert.match(invoice, /useEquipmentCatalog/);
  assert.doesNotMatch(invoice, /listManufacturers\(\)/);
});

test('service tickets join models by manufacturer id or name', () => {
  const tickets = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(tickets, /modelBelongsToManufacturer/);
});

test('Android estimate generator loads manufacturers + laser_models', () => {
  const html = readFileSync(join(here, '../../app/src/main/assets/estimate_generator.html'), 'utf8');
  assert.match(html, /manufacturers/);
  assert.match(html, /laser_models/);
  assert.match(html, /manufacturer_id/);
  assert.match(html, /equipment_type|equipmentType/);
});
