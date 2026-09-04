import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_EQUIPMENT_TYPE,
  EQUIPMENT_TYPES,
  EQUIPMENT_TYPE_VALUES,
  equipmentTypeLabel,
  equipmentTypeOrDefault,
  inferEquipmentType,
  normalizeEquipmentType,
} from './equipment-types.ts';
import {
  BIOMED_MANUAL_SEEDS,
  EQUIPMENT_CATALOG,
  suggestedManualStoragePath,
} from './equipment-catalog.ts';
import { parseManualCatalogInsert } from './manual-catalog-admin.ts';
import { catalogManualKind, isManualIncomplete, showOperatorBadge } from './manual-catalog.ts';
import { CLINIC_LEAD_EQUIPMENT_TYPES } from './clinic-service-lead.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('equipment types match find-a-rep and default to Laser', () => {
  assert.deepEqual([...EQUIPMENT_TYPE_VALUES], ['laser', 'lithotriptor', 'c_arm', 'other']);
  assert.equal(DEFAULT_EQUIPMENT_TYPE, 'laser');
  assert.deepEqual(
    EQUIPMENT_TYPES.map((t) => t.value),
    CLINIC_LEAD_EQUIPMENT_TYPES.map((t) => t.value)
  );
  assert.equal(normalizeEquipmentType('C-arm'), 'c_arm');
  assert.equal(normalizeEquipmentType('litho'), 'lithotriptor');
  assert.equal(equipmentTypeOrDefault(null), 'laser');
  assert.equal(equipmentTypeLabel('c_arm'), 'C-arm');
});

test('Quanta Litho / Cyber Ho / Litho IFU are laser; Dornier ESWL is lithotriptor', () => {
  assert.equal(inferEquipmentType({ title: 'VBeam Perfecta Service Manual' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Quanta System Litho Service Manual DGM001063' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Cyber Ho 60 Service Manual' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Litho EVO User Manual' }), 'laser');
  assert.equal(
    inferEquipmentType({ title: 'Litho IFU (EN)', equipment_type: 'lithotriptor' }),
    'laser'
  );
  assert.equal(inferEquipmentType({ brand: 'GE OEC', model: '9900', title: 'OEC 9900 Service Manual' }), 'c_arm');
  assert.equal(inferEquipmentType({ title: 'PowerSuite 100W Holmium', brand: 'Lumenis' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Dornier Compact Delta Lithotripter' }), 'lithotriptor');
  assert.equal(inferEquipmentType({ title: 'Shockwave ESWL Service Manual', brand: 'Dornier' }), 'lithotriptor');
  assert.equal(
    inferEquipmentType({ equipment_type: 'lithotriptor', title: 'Something laser-ish' }),
    'lithotriptor'
  );
});

test('Dornier H20 / H30 / Medilas are laser, not lithotriptor', () => {
  assert.equal(
    inferEquipmentType({ title: 'Dornier H20 Service Manual', equipment_type: 'lithotriptor' }),
    'laser'
  );
  assert.equal(inferEquipmentType({ title: 'Dornier H30', brand: 'Dornier' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Medilas H20/H30', brand: 'Dornier' }), 'laser');
  assert.equal(inferEquipmentType({ model: 'H-20', brand: 'Dornier MedTech' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Dornier Compact Delta' }), 'lithotriptor');
});

test('seed catalog covers Larry’s first five manuals without PDF binaries', () => {
  assert.equal(BIOMED_MANUAL_SEEDS.length, 5);
  assert.equal(BIOMED_MANUAL_SEEDS[0].manufacturer, 'GE OEC');
  assert.equal(BIOMED_MANUAL_SEEDS[0].model, '9900');
  assert.equal(BIOMED_MANUAL_SEEDS[0].equipmentType, 'c_arm');
  assert.ok(EQUIPMENT_CATALOG.some((m) => m.name === 'Quanta System'));
  assert.ok(EQUIPMENT_CATALOG.some((m) => m.name === 'GE OEC'));
  const dornier = EQUIPMENT_CATALOG.find((m) => m.name === 'Dornier');
  assert.ok(dornier);
  assert.ok((dornier?.models || []).every((m) => m.equipmentType === 'laser'));
  assert.deepEqual((dornier?.models || []).map((m) => m.name), ['H20', 'H30']);
  const quanta = EQUIPMENT_CATALOG.find((m) => m.name === 'Quanta System');
  assert.deepEqual(
    (quanta?.models || []).map((m) => m.name),
    ['Litho', 'Litho 60', 'Litho 100', 'Litho EVO']
  );
  assert.ok((quanta?.models || []).every((m) => m.equipmentType === 'laser'));
  assert.ok(BIOMED_MANUAL_SEEDS.filter((s) => s.manufacturer === 'Quanta System').every((s) => s.equipmentType === 'laser'));
  assert.equal(suggestedManualStoragePath({ brand: 'GE OEC', model: '9900' }), 'shared/ge-oec/9900/9900.pdf');
});

test('Litho EVO user manual is operator/user, not service', () => {
  const evo = { title: 'Quanta System Litho EVO User Manual DGM001435', brand: 'Quanta System' };
  assert.equal(catalogManualKind(evo), 'operator');
  assert.equal(showOperatorBadge(evo), true);
});

test('catalog insert requires type, brand, model, title, and a bucket path', () => {
  const ok = parseManualCatalogInsert({
    equipmentType: 'c_arm',
    brand: 'GE OEC',
    model: '9900',
    title: 'GE OEC 9900 Service Manual',
    storage_path: 'shared/ge-oec/9900/GE-OEC-9900-Service-Manual.pdf',
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.row.equipment_type, 'c_arm');
    assert.equal(ok.row.doc_kind, 'service');
    assert.equal(ok.row.is_incomplete, false);
  }

  const incomplete = parseManualCatalogInsert({
    equipmentType: 'laser',
    brand: 'Dornier',
    model: 'H20',
    title: 'Dornier H20/H30 Service Manual',
    storage_path: 'shared/dornier/h20/dornier-h20-h30.pdf',
    is_incomplete: true,
  });
  assert.equal(incomplete.ok, true);
  if (incomplete.ok) {
    assert.equal(incomplete.row.equipment_type, 'laser');
    assert.equal(incomplete.row.is_incomplete, true);
  }

  const missing = parseManualCatalogInsert({ brand: 'GE OEC', title: 'x' });
  assert.equal(missing.ok, false);

  const badPath = parseManualCatalogInsert({
    brand: 'GE OEC',
    model: '9900',
    title: 'GE OEC 9900 Service Manual',
    storage_path: 'https://example.com/secret.pdf',
  });
  assert.equal(badPath.ok, false);

  const inferredPath = parseManualCatalogInsert({
    equipment_type: 'laser',
    manufacturer: 'Quanta System',
    model: 'Litho EVO',
    title: 'Quanta System Litho EVO User Manual DGM001435',
    filename: 'DGM001435.pdf',
  });
  assert.equal(inferredPath.ok, true);
  if (inferredPath.ok) {
    assert.equal(inferredPath.row.doc_kind, 'user');
    assert.equal(inferredPath.row.storage_path, 'shared/quanta-system/litho-evo/DGM001435.pdf');
  }
});

test('migration backfills lasers and seeds Quanta / GE OEC models', () => {
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260905_000000_equipment_type_manuals.sql'),
    'utf8'
  );
  assert.match(migration, /equipment_type/);
  assert.match(migration, /DEFAULT 'laser'/);
  assert.match(migration, /UPDATE public\.manuals/);
  assert.match(migration, /Quanta System/);
  assert.match(migration, /GE OEC/);
  assert.match(migration, /Litho EVO/);
  assert.match(migration, /Cyber Ho 60/);
  assert.match(migration, /OEC 9900/);
  assert.match(migration, /laser_models/);
  assert.match(migration, /m\.id, 'laser'/);
  assert.doesNotMatch(migration, /m\.id, 'lithotriptor'/);
  assert.doesNotMatch(migration, /\.pdf['"]\s*,/);

  const fix = readFileSync(
    join(here, '../supabase/migrations/20260905_000001_quanta_litho_is_laser.sql'),
    'utf8'
  );
  assert.match(fix, /id::text = '144'/);
  assert.match(fix, /equipment_type = 'laser'/);
  assert.match(fix, /dornier/);

  const h20 = readFileSync(
    join(here, '../supabase/migrations/20260905_000002_dornier_h20_h30_laser_incomplete.sql'),
    'utf8'
  );
  assert.match(h20, /is_incomplete/);
  assert.match(h20, /equipment_type = 'laser'/);
  assert.match(h20, /h\[- \]\?20/);
  assert.match(h20, /h\[- \]\?30/);
  assert.match(h20, /medilas/i);
  assert.match(h20, /compact\\s\+delta/);
  assert.doesNotMatch(h20, /\.pdf['"]\s*,/);
});

test('incomplete badge is a stored flag, not a hardcoded H20 title', () => {
  assert.equal(isManualIncomplete({ title: 'Dornier H20 Service Manual' }), false);
  assert.equal(isManualIncomplete({ title: 'Dornier H20 Service Manual', is_incomplete: true }), true);
  assert.equal(isManualIncomplete({ title: 'Other', is_incomplete: false }), false);
});

test('library rooms default to Laser and keep access + bookshelf', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  assert.match(page, /equipmentTypeOrDefault|DEFAULT_EQUIPMENT_TYPE|room=/);
  assert.match(page, /Laser room|Lithotriptor|C-arm/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /ShelfScroller/);
  assert.match(page, /empty.*room|No manuals in this room|bookshelf is empty/i);
  assert.match(page, /showIncompleteBadge/);
  assert.match(page, /Incomplete/);
});

test('god catalog form requires equipment type and does not commit PDFs', () => {
  const page = readFileSync(join(here, '../app/admin/god/manuals/page.tsx'), 'utf8');
  const api = readFileSync(join(here, '../app/api/god/manuals/route.ts'), 'utf8');
  assert.match(page, /equipment_type|equipmentType/);
  assert.match(page, /storage_path/);
  assert.match(page, /is_incomplete|isIncomplete/);
  assert.match(api, /requireGodCaller/);
  assert.match(api, /parseManualCatalogInsert/);
  assert.match(api, /equipment_type/);
  assert.doesNotMatch(page, /sample-service-manual|\.pdf'/);
});
