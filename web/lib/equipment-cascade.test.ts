import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changeEquipmentType,
  changeManufacturer,
  changeModel,
  emptyCascade,
  guessEquipmentType,
  hydrateCascade,
  manufacturerChoicesForType,
  modelChoicesFor,
  OTHER_VALUE,
  resolveCascade,
} from './equipment-cascade.ts';
import { listCatalogManufacturers } from './equipment-dropdown.ts';
import { EQUIPMENT_TYPE_VALUES } from './equipment-types.ts';

const empty = { manufacturers: [], models: [] };
const names = (type: any) => manufacturerChoicesForType(empty, type).map((c) => c.value);

test('Beds lists bed / table makers, not laser brands (Larry Oct 20)', () => {
  const beds = names('beds');
  assert.ok(beds.includes('Midmark'));
  assert.ok(beds.includes('Hill-Rom'));
  assert.ok(beds.includes('Stryker'));
  for (const laser of ['Candela', 'Cutera', 'Cynosure', 'Lumenis (Coherent)', 'Sciton', 'Alma']) {
    assert.ok(!beds.includes(laser), `${laser} must not be a Beds manufacturer`);
  }
});

test('Midmark under Beds offers Ritter 112; under Sterile processing offers UltraClave', () => {
  const beds = modelChoicesFor(empty, 'beds', 'Midmark').map((c) => c.value);
  assert.ok(beds.includes('Ritter 112'));
  assert.ok(!beds.some((m) => /UltraClave/.test(m)));
  const spd = modelChoicesFor(empty, 'sterile_processing', 'Midmark').map((c) => c.value);
  assert.ok(spd.includes('M11 UltraClave'));
  assert.ok(!spd.includes('Ritter 112'));
});

test('every equipment type has at least one manufacturer with models', () => {
  for (const type of EQUIPMENT_TYPE_VALUES) {
    const mfrs = names(type);
    assert.ok(mfrs.length > 0, `${type} has no manufacturers`);
    assert.ok(
      mfrs.some((m) => modelChoicesFor(empty, type, m).length > 0),
      `${type} has no models`
    );
  }
});

test('Laser list keeps laser brands and drops biomed-only brands', () => {
  const laser = names('laser');
  for (const b of ['Candela', 'Cutera', 'Cynosure', 'Sciton', 'Quanta System', 'Dornier']) {
    assert.ok(laser.includes(b), `${b} missing from Laser`);
  }
  for (const b of ['Midmark', 'Hill-Rom', 'Stryker', 'ZOLL', 'GE OEC', 'Olympus']) {
    assert.ok(!laser.includes(b), `${b} should not be a Laser manufacturer`);
  }
});

test('live laser_models rows typed beds move a brand to Beds only', () => {
  const live = {
    manufacturers: [{ id: 900, name: 'Acme Beds' }],
    models: [{ name: 'AB-1', label: 'AB-1', manufacturer_id: 900, equipment_type: 'beds' }],
  };
  assert.ok(listCatalogManufacturers({ ...live, equipmentType: 'beds' }).includes('Acme Beds'));
  assert.ok(!listCatalogManufacturers({ ...live, equipmentType: 'laser' }).includes('Acme Beds'));
  // Untyped callers still see everything.
  assert.ok(listCatalogManufacturers(live).includes('Acme Beds'));
});

test('type change resets manufacturer and model; manufacturer change resets model', () => {
  let s = emptyCascade('beds');
  s = changeManufacturer(s, 'Midmark');
  s = changeModel(s, 'Ritter 112');
  const sameType = changeEquipmentType(s, 'beds');
  assert.equal(sameType, s);
  const t = changeEquipmentType(s, 'ultrasound');
  assert.deepEqual(t, emptyCascade('ultrasound'));
  const m = changeManufacturer(s, 'Stryker');
  assert.equal(m.model, '');
  assert.equal(m.customModel, '');
});

test('Other + free text is kept for manufacturer and model', () => {
  let s = emptyCascade('beds');
  s = changeManufacturer(s, OTHER_VALUE);
  assert.equal(s.model, OTHER_VALUE);
  s = { ...s, customManufacturer: ' Hausted ', customModel: ' APC ' };
  assert.deepEqual(resolveCascade(s), { equipment_type: 'beds', manufacturer: 'Hausted', model: 'APC' });
  let k = changeManufacturer(emptyCascade('beds'), 'Midmark');
  k = changeModel(k, OTHER_VALUE);
  k = { ...k, customModel: '75L' };
  assert.deepEqual(resolveCascade(k), { equipment_type: 'beds', manufacturer: 'Midmark', model: '75L' });
});

test('hydrate keeps saved values; unknown ones become Other + text', () => {
  const s = hydrateCascade(empty, { equipmentType: 'beds', manufacturer: 'Midmark', model: 'Ritter 112' });
  assert.equal(s.manufacturer, 'Midmark');
  assert.equal(s.model, 'Ritter 112');
  const u = hydrateCascade(empty, { equipmentType: 'beds', manufacturer: 'Hausted', model: 'APC' });
  assert.equal(u.manufacturer, OTHER_VALUE);
  assert.equal(u.customManufacturer, 'Hausted');
  assert.equal(u.model, OTHER_VALUE);
  assert.deepEqual(resolveCascade(u), { equipment_type: 'beds', manufacturer: 'Hausted', model: 'APC' });
});

test('legacy rows with no saved type are guessed from the catalog', () => {
  assert.equal(guessEquipmentType(empty, 'Midmark', 'Ritter 112'), 'beds');
  assert.equal(guessEquipmentType(empty, 'Midmark', 'M11 UltraClave'), 'sterile_processing');
  assert.equal(guessEquipmentType(empty, 'Candela', 'GentleMax Pro'), 'laser');
  assert.equal(guessEquipmentType(empty, '', ''), 'laser');
  const h = hydrateCascade(empty, { manufacturer: 'ZOLL', model: 'R Series' });
  assert.equal(h.equipmentType, 'defibrillator');
  assert.equal(h.model, 'R Series');
});

test('000937 seed rows match BIOMED_CATALOG exactly (web and DB agree)', async () => {
  const { readFileSync } = await import('node:fs');
  const { BIOMED_CATALOG } = await import('./equipment-catalog.ts');
  const sql = readFileSync(
    new URL('../supabase/migrations/20261020_000937_biomed_equipment_catalog.sql', import.meta.url),
    'utf8'
  );
  const block = sql.slice(sql.indexOf('INSERT INTO _l937'), sql.indexOf(';', sql.indexOf('INSERT INTO _l937')));
  const rows = [...block.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)', '([a-z_]+)'\)/g)].map(
    (m) => `${m[1]}|${m[2]}|${m[3]}`
  );
  const fromTs = BIOMED_CATALOG.flatMap((mfr) => mfr.models.map((m) => `${mfr.name}|${m.name}|${m.equipmentType}`));
  assert.equal(rows.length, 128);
  assert.deepEqual([...rows].sort(), [...fromTs].sort());
});
