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
  isHvPowerSupply,
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
import { catalogModelsForManufacturer } from './equipment-catalog.ts';
import { GAP_STRINGS } from './i18n/gap-copy.ts';
import { FA_COPY } from './fa/copy.ts';
import { ES_COPY } from './es/copy.ts';
import { FR_COPY } from './fr/copy.ts';
import { HE_COPY } from './he/copy.ts';
import { IT_COPY } from './it/copy.ts';
import { DE_COPY } from './de/copy.ts';
import { PT_COPY } from './pt/copy.ts';
import { AR_COPY } from './ar/copy.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('equipment types match find-a-rep and default to Laser', () => {
  assert.deepEqual(
    [...EQUIPMENT_TYPE_VALUES],
    [
      'laser',
      'lithotriptor',
      'c_arm',
      'anesthesia',
      'beds',
      'defibrillator',
      'endoscope',
      'infusion_pump',
      'patient_monitor',
      'sterile_processing',
      'ultrasound',
      'ventilator',
      'hv_power_supply',
    ]
  );
  assert.ok(!EQUIPMENT_TYPE_VALUES.includes('other' as never));
  assert.ok(EQUIPMENT_TYPES.every((t) => t.value !== 'other'));
  assert.equal(DEFAULT_EQUIPMENT_TYPE, 'laser');
  assert.deepEqual(
    EQUIPMENT_TYPES.map((t) => t.value),
    CLINIC_LEAD_EQUIPMENT_TYPES.map((t) => t.value)
  );
  assert.equal(normalizeEquipmentType('C-arm'), 'c_arm');
  assert.equal(normalizeEquipmentType('litho'), 'lithotriptor');
  assert.equal(normalizeEquipmentType('other'), null);
  assert.equal(equipmentTypeOrDefault('other'), 'laser');
  assert.equal(equipmentTypeOrDefault(null), 'laser');
  assert.equal(equipmentTypeLabel('c_arm'), 'C-arm');
  assert.equal(equipmentTypeLabel('ventilator'), 'Ventilator');
  assert.equal(equipmentTypeLabel('hv_power_supply'), 'High Voltage Power Supply');
});

test('capacitor charger / HVPS manuals are their own room, not Laser', () => {
  assert.equal(isHvPowerSupply('Candela capacitor charger'), true);
  assert.equal(inferEquipmentType({ title: 'Candela GentleMax Capacitor Charger' }), 'hv_power_supply');
  assert.equal(
    inferEquipmentType({ title: 'Capacitor charging power supply', equipment_type: 'laser' }),
    'hv_power_supply'
  );
  assert.equal(inferEquipmentType({ title: 'Cap charger service manual' }), 'hv_power_supply');
  assert.equal(inferEquipmentType({ title: 'Alex HVPS', brand: 'Candela' }), 'hv_power_supply');
  assert.equal(inferEquipmentType({ title: 'CCPS module' }), 'hv_power_supply');
  assert.equal(inferEquipmentType({ title: 'High Voltage Power Supply' }), 'hv_power_supply');
  assert.equal(inferEquipmentType({ title: 'High-voltage power supply' }), 'hv_power_supply');
  assert.equal(
    inferEquipmentType({ title: 'Laser power supply charger', equipment_type: 'laser' }),
    'hv_power_supply'
  );
  assert.equal(
    inferEquipmentType({ title: 'Quanta Litho capacitor charger', equipment_type: 'laser' }),
    'hv_power_supply'
  );
  assert.equal(inferEquipmentType({ equipment_type: 'hv_power_supply', title: 'Service notes' }), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('HVPS'), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('CCPS'), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('high-voltage power supply'), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('capacitor charger'), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('cap charger'), 'hv_power_supply');
  assert.equal(normalizeEquipmentType('laser power supply charger'), 'hv_power_supply');
  // A laser manual that only mentions the supply, not a charger, stays Laser.
  assert.equal(inferEquipmentType({ title: 'Check the laser power supply' }), 'laser');
  assert.equal(inferEquipmentType({ title: 'VBeam Perfecta Service Manual' }), 'laser');
  assert.ok(catalogModelsForManufacturer('Lumina Power', 'hv_power_supply').length > 0);
});

test('High Voltage Power Supply is translated in every supported locale', () => {
  const label = 'High Voltage Power Supply';
  const gap = GAP_STRINGS[label];
  assert.ok(gap);
  const copies = {
    fa: FA_COPY,
    es: ES_COPY,
    fr: FR_COPY,
    he: HE_COPY,
    it: IT_COPY,
    de: DE_COPY,
    pt: PT_COPY,
    ar: AR_COPY,
  } as const;
  for (const locale of Object.keys(copies) as Array<keyof typeof copies>) {
    assert.equal(copies[locale][label], gap[locale]);
    assert.notEqual(gap[locale], label, locale);
    assert.ok(gap[locale].trim().length > 0, locale);
  }
  assert.match(gap.he, /[\u0590-\u05FF]/);
  assert.match(gap.ar, /[\u0600-\u06FF]/);
  assert.match(gap.fa, /[\u0600-\u06FF]/);
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

test('infer maps migrated Other titles into real BMET rooms', () => {
  assert.equal(inferEquipmentType({ title: 'Euronda E9 Steam Sterilizer' }), 'sterile_processing');
  assert.equal(inferEquipmentType({ title: 'Trans SMART Steam Sterilizer' }), 'sterile_processing');
  assert.equal(inferEquipmentType({ title: 'CU Medical iPAD NF1200 Defibrillator' }), 'defibrillator');
  assert.equal(inferEquipmentType({ title: 'CME BodyGuard infusion' }), 'infusion_pump');
  assert.equal(inferEquipmentType({ title: 'Burdick Medic5 Defibrillator' }), 'defibrillator');
  assert.equal(inferEquipmentType({ title: 'Samsung HS50A/HS60A Ultrasound' }), 'ultrasound');
  assert.equal(inferEquipmentType({ title: 'QCore Sapphire Infusion' }), 'infusion_pump');
  assert.equal(inferEquipmentType({ title: 'Contec CMS8000 Patient Monitor' }), 'patient_monitor');
  assert.equal(inferEquipmentType({ title: 'Ohmeda Ohio Infant Warmer' }), 'beds');
  assert.equal(inferEquipmentType({ title: 'GE Dash 3000/4000 Patient Monitor' }), 'patient_monitor');
  assert.equal(inferEquipmentType({ title: 'Samsung RS80A Ultrasound' }), 'ultrasound');
  assert.equal(inferEquipmentType({ title: 'Draeger Fabius GS Anesthesia' }), 'anesthesia');
  assert.equal(inferEquipmentType({ title: 'Draeger Narkomed 6000 Anesthesia' }), 'anesthesia');
  assert.equal(inferEquipmentType({ title: 'UroView 2800' }), 'c_arm');
  assert.equal(inferEquipmentType({ title: 'Olympus GIF Endoscope Service Manual' }), 'endoscope');
  assert.equal(inferEquipmentType({ title: 'Puritan Bennett 840 Ventilator' }), 'ventilator');
  assert.equal(inferEquipmentType({ title: 'Philips HeartStart AED' }), 'defibrillator');
  assert.equal(inferEquipmentType({ title: 'Stryker Stretcher' }), 'beds');
  assert.equal(inferEquipmentType({ title: 'Getinge autoclave washer' }), 'sterile_processing');
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
  // Dornier H20 / H30 stay holmium lasers; 000937 adds Dornier ESWL as lithotriptor.
  const dornierLasers = (dornier?.models || []).filter((m) => m.equipmentType === 'laser');
  assert.deepEqual(dornierLasers.map((m) => m.name), ['H20', 'H30']);
  assert.ok((dornier?.models || []).every((m) => m.equipmentType === 'laser' || m.equipmentType === 'lithotriptor'));
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

  const rooms = readFileSync(
    join(here, '../supabase/migrations/20260908_000000_expand_manuals_equipment_rooms.sql'),
    'utf8'
  );
  assert.match(rooms, /DROP CONSTRAINT IF EXISTS manuals_equipment_type_check/);
  assert.match(rooms, /id::text = '212'/);
  assert.match(rooms, /id::text = '216'/);
  assert.match(rooms, /id::text = '217'/);
  assert.match(rooms, /id::text = '224'/);
  assert.match(rooms, /id::text = '225'/);
  assert.match(rooms, /id::text = '227'/);
  assert.match(rooms, /id::text = '228'/);
  assert.match(rooms, /id::text = '229'/);
  assert.match(rooms, /id::text = '231'/);
  assert.match(rooms, /id::text = '232'/);
  assert.match(rooms, /id::text = '233'/);
  assert.match(rooms, /id::text = '235'/);
  assert.match(rooms, /id::text = '236'/);
  assert.match(rooms, /id::text = '245'/);
  assert.match(rooms, /equipment_type = 'sterile_processing'/);
  assert.match(rooms, /equipment_type = 'defibrillator'/);
  assert.match(rooms, /equipment_type = 'infusion_pump'/);
  assert.match(rooms, /equipment_type = 'ultrasound'/);
  assert.match(rooms, /equipment_type = 'patient_monitor'/);
  assert.match(rooms, /equipment_type = 'beds'/);
  assert.match(rooms, /equipment_type = 'anesthesia'/);
  assert.match(rooms, /equipment_type = 'c_arm'/);
  assert.match(rooms, /WHERE equipment_type = 'other'/);
  assert.match(rooms, /ELSE 'laser'/);
  assert.doesNotMatch(rooms, /ADD CONSTRAINT manuals_equipment_type_check/);
  assert.doesNotMatch(rooms, /ADD CONSTRAINT laser_models_equipment_type_check/);
});

test('incomplete badge is a stored flag, not a hardcoded H20 title', () => {
  assert.equal(isManualIncomplete({ title: 'Dornier H20 Service Manual' }), false);
  assert.equal(isManualIncomplete({ title: 'Dornier H20 Service Manual', is_incomplete: true }), true);
  assert.equal(isManualIncomplete({ title: 'Other', is_incomplete: false }), false);
});

test('library rooms default to Laser and keep access + bookshelf', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
  assert.match(page, /equipmentTypeOrDefault|DEFAULT_EQUIPMENT_TYPE|room=/);
  assert.match(page, /Laser room|Lithotriptor|C-arm/);
  assert.match(page, /EQUIPMENT_TYPE_VALUES/);
  assert.doesNotMatch(page, /other:\s*0/);
  assert.match(page, /canAccessServiceManuals/);
  assert.match(page, /ShelfScroller/);
  assert.match(page, /Operators Manuals/);
  assert.match(page, /empty.*room|No manuals in this room|bookshelf is empty/i);
  assert.match(page, /showIncompleteBadge/);
  assert.match(page, /Incomplete/);
  assert.match(css, /\.manual-libraries/);
  assert.match(css, /\.manuals-layout/);
  assert.match(css, /\.manuals-rail/);
  assert.match(css, /\.manual-rooms/);
  assert.match(css, /flex-direction:\s*column/);
  assert.match(css, /flex-wrap:\s*nowrap/);
  assert.match(page, /manuals-rail|manuals-layout/);
});

test('service report form lists equipment types from EQUIPMENT_TYPES', () => {
  const src = readFileSync(join(here, '../app/reports/new/NewServiceReportClient.tsx'), 'utf8');
  assert.match(src, /EQUIPMENT_TYPES\.map/);
  assert.match(src, /tr\(item\.label\)/);
  assert.doesNotMatch(src, /<option[^>]*>Laser<\/option>/);
});

test('god catalog form requires equipment type and does not commit PDFs', () => {
  const page = readFileSync(join(here, '../app/admin/god/manuals/page.tsx'), 'utf8');
  const api = readFileSync(join(here, '../app/api/god/manuals/route.ts'), 'utf8');
  assert.match(page, /equipment_type|equipmentType/);
  assert.match(page, /storage_path/);
  assert.match(page, /is_incomplete|isIncomplete/);
  assert.match(page, /Operators library|Operators Manuals/);
  assert.match(page, /doc_kind|Document kind/);
  assert.match(api, /requireGodCaller/);
  assert.match(api, /parseManualCatalogInsert/);
  assert.match(api, /equipment_type/);
  assert.match(api, /optionalColumns = \['language', 'doc_kind', 'equipment_type', 'is_incomplete'\]/);
  assert.match(api, /language: parsed\.row\.language/);
  assert.match(page, /reindex|Index missing PDF text/);
  assert.match(page, /Index this manual/);
  assert.match(page, /Attach to Grok collection/);
  assert.match(api, /indexManualSearchText/);
  assert.doesNotMatch(page, /sample-service-manual|\.pdf'/);
});

test('VBeam Perfecta-family spines read "VBeam II" (line 2 parenthetical omitted: does not fit)', () => {
  const page = readFileSync(join(here, '../app/manuals/page.tsx'), 'utf8');
  assert.match(page, /v-\?beam\.\*perfecta\/i\.test\(spine\)\) return 'VBeam II';/);
  assert.doesNotMatch(page, /VBEAM PF/);
});
