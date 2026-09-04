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
import { catalogManualKind, showOperatorBadge } from './manual-catalog.ts';
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

test('infer litho and C-arm from titles; existing lasers stay Laser', () => {
  assert.equal(inferEquipmentType({ title: 'VBeam Perfecta Service Manual' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'Quanta System Litho Service Manual DGM001063' }), 'lithotriptor');
  assert.equal(inferEquipmentType({ title: 'Cyber Ho 60 Service Manual' }), 'lithotriptor');
  assert.equal(inferEquipmentType({ brand: 'GE OEC', model: '9900', title: 'OEC 9900 Service Manual' }), 'c_arm');
  assert.equal(inferEquipmentType({ title: 'PowerSuite 100W Holmium', brand: 'Lumenis' }), 'laser');
  assert.equal(
    inferEquipmentType({ equipment_type: 'lithotriptor', title: 'Something laser-ish' }),
    'lithotriptor'
  );
});

test('seed catalog covers Larry’s first five manuals without PDF binaries', () => {
  assert.equal(BIOMED_MANUAL_SEEDS.length, 5);
  assert.equal(BIOMED_MANUAL_SEEDS[0].manufacturer, 'GE OEC');
  assert.equal(BIOMED_MANUAL_SEEDS[0].model, '9900');
  assert.equal(BIOMED_MANUAL_SEEDS[0].equipmentType, 'c_arm');
  assert.ok(EQUIPMENT_CATALOG.some((m) => m.name === 'Quanta System'));
  assert.ok(EQUIPMENT_CATALOG.some((m) => m.name === 'GE OEC'));
  const quanta = EQUIPMENT_CATALOG.find((m) => m.name === 'Quanta System');
  assert.deepEqual(
    (quanta?.models || []).map((m) => m.name),
    ['Litho', 'Litho 60', 'Litho 100', 'Litho EVO']
  );
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
    equipment_type: 'lithotriptor',
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
  assert.doesNotMatch(migration, /\.pdf['"]\s*,/);
});

test('library rooms default to Laser and keep access + bookshelf', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  assert.match(page, /equipmentTypeOrDefault|DEFAULT_EQUIPMENT_TYPE|room=/);
  assert.match(page, /Laser room|Lithotriptor|C-arm/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /ShelfScroller/);
  assert.match(page, /empty.*room|No manuals in this room|bookshelf is empty/i);
});

test('god catalog form requires equipment type and does not commit PDFs', () => {
  const page = readFileSync(join(here, '../app/admin/god/manuals/page.tsx'), 'utf8');
  const api = readFileSync(join(here, '../app/api/god/manuals/route.ts'), 'utf8');
  assert.match(page, /equipment_type|equipmentType/);
  assert.match(page, /storage_path/);
  assert.match(api, /requireGodCaller/);
  assert.match(api, /parseManualCatalogInsert/);
  assert.match(api, /equipment_type/);
  assert.doesNotMatch(page, /sample-service-manual|\.pdf'/);
});
