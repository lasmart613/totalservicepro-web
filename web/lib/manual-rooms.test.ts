import assert from 'node:assert/strict';
import test from 'node:test';
import { EQUIPMENT_TYPE_VALUES } from './equipment-types.ts';
import {
  EQUIPMENT_TYPE_ROOM_MAP,
  MANUAL_ROOMS,
  MANUAL_ROOM_IDS,
  classifyManualRoom,
  manualDocType,
  manualSubtypeRoom,
  roomForEquipmentType,
} from './manual-rooms.ts';
import {
  EMPTY_CASCADE,
  computeManualCascade,
  parseManualCascadeParams,
  toggleCascade,
  writeManualCascadeParams,
} from './manual-cascade.ts';

/** Every manuals.equipment_type value in production on 2026-10-29. */
const PROD_TYPES = [
  'other', 'laser', 'patient_monitor', 'imaging', 'lab', 'ultrasound', 'ventilator', 'dental', 'beds', 'sterilizer',
  'anesthesia', 'infusion', 'monitor', 'or_table', 'defibrillator', 'c_arm', 'infusion_pump', 'warming', 'therapy',
  'electrosurgical', 'centrifuge', 'suction', 'ophthalmology', 'ecg', 'sterile_processing', 'endoscope', 'microscope',
  'surgical_light', 'dialysis', 'lithotriptor', 'incubator', 'fetal_monitor', 'oxygen_concentrator', 'hv_power_supply',
  'thermometer', 'phototherapy', 'humidifier', 'respiratory', 'electrosurgery', 'breast_pump', 'test_equipment', 'pump',
  'esu', 'eeg', 'neonatal', 'lab_analyzer', 'oxygen', 'audiology', 'neurology', 'rehab', 'endoscopy', 'mobility',
  'hospital_bed', 'pulse_oximeter',
];
const LEGACY_ALIASES = [
  'lasers', 'litho', 'lithotripsy', 'c-arm', 'carm', 'c arm', 'anaesthesia', 'bed', 'stretcher', 'defib', 'aed',
  'endoscopy', 'infusion', 'syringe_pump', 'monitor', 'vital_signs', 'sterilizer', 'autoclave', 'spd', 'sonograph', 'respirator',
];
const LASER_TYPES = new Set(['laser', 'lasers', 'lithotriptor', 'litho', 'lithotripsy', 'hv_power_supply']);

test('18 rooms, unique subtype ids, each with a general fallback', () => {
  assert.equal(MANUAL_ROOMS.length, 18);
  assert.deepEqual(MANUAL_ROOMS.map((r) => r.id), [...MANUAL_ROOM_IDS]);
  const subs = MANUAL_ROOMS.flatMap((r) => r.subtypes.map((s) => s.id));
  assert.equal(new Set(subs).size, subs.length);
  for (const r of MANUAL_ROOMS) assert.ok(r.subtypes.length >= 1, r.id);
});

test('every production equipment_type, legacy alias and EQUIPMENT_TYPE maps to a room', () => {
  for (const v of [...PROD_TYPES, ...LEGACY_ALIASES, ...EQUIPMENT_TYPE_VALUES]) {
    const key = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    assert.ok(key in EQUIPMENT_TYPE_ROOM_MAP, `unmapped equipment_type ${v}`);
    const placed = roomForEquipmentType(v);
    if (placed?.subtype) assert.equal(manualSubtypeRoom(placed.subtype), placed.room, v);
  }
});

test('no non-laser type lands in Lasers & Energy', () => {
  for (const v of [...PROD_TYPES, ...LEGACY_ALIASES]) {
    const room = classifyManualRoom({ equipment_type: v, title: 'Service Manual', brand: 'Acme' }).room;
    if (LASER_TYPES.has(v)) assert.equal(room, 'lasers', v);
    else assert.notEqual(room, 'lasers', `${v} landed on lasers`);
  }
});

test('unknown / blank types default to Other, never Laser', () => {
  for (const v of [null, '', 'flux_capacitor', 'other', 'pump']) {
    assert.deepEqual(classifyManualRoom({ equipment_type: v, title: 'Model 9 Service Manual', brand: 'Acme' }), {
      room: 'other',
      subtype: 'other_general',
    });
  }
});

test('lasers room keeps real lasers, litho and HV power supplies', () => {
  assert.equal(classifyManualRoom({ equipment_type: 'other', title: 'Dornier Medilas H20 Service Manual' }).room, 'lasers');
  assert.deepEqual(classifyManualRoom({ equipment_type: 'lithotriptor', title: 'Dornier Compact Delta II' }), { room: 'lasers', subtype: 'lithotripsy' });
  assert.deepEqual(classifyManualRoom({ equipment_type: 'other', title: 'Lambda 402 Capacitor Charging Power Supply' }), { room: 'lasers', subtype: 'hv_power_supply' });
  assert.deepEqual(classifyManualRoom({ equipment_type: 'hv_power_supply', title: 'TDK-Lambda' }), { room: 'lasers', subtype: 'hv_power_supply' });
  assert.equal(classifyManualRoom({ equipment_type: 'laser', title: 'Candela GentleMax Pro Service Manual' }).room, 'lasers');
  assert.equal(classifyManualRoom({ equipment_type: 'laser', title: 'Alcon 3000LE YAG Laser Service Manual' }).room, 'lasers');
});

test('laser-typed rows that are clearly something else move rooms', () => {
  assert.equal(classifyManualRoom({ equipment_type: 'laser', title: 'OPMI Lumera 700 Service Manual', brand: 'Zeiss' }).room, 'surgical');
  assert.equal(classifyManualRoom({ equipment_type: 'laser', title: 'NRK-8000 Auto Ref Keratometer Repair Manual' }).room, 'ophthalmic_ent');
  assert.equal(classifyManualRoom({ equipment_type: 'laser', title: 'Agfa CR 35-X Service Manual' }).room, 'imaging');
});

test('a Ziehm Compact Litho C-arm stays in Imaging', () => {
  assert.deepEqual(classifyManualRoom({ equipment_type: 'c_arm', title: 'Ziehm Compact Litho Service Manual' }), { room: 'imaging', subtype: 'fluoro' });
});

test('imaging subtypes come from the title', () => {
  const sub = (title: string) => classifyManualRoom({ equipment_type: 'imaging', title }).subtype;
  assert.equal(sub('GE LightSpeed 16 CT Service Manual'), 'ct');
  assert.equal(sub('Siemens Magnetom MRI System'), 'mri');
  assert.equal(sub('Hologic Selenia Dimensions Mammography'), 'mammo');
  assert.equal(sub('Medrad Stellant CT Injector Service Manual'), 'injector');
  assert.equal(sub('Carestream DRX-1 X-Ray Detector'), 'xray');
  assert.equal(sub('Siemens Uroskop D Service Instructions'), 'fluoro');
  assert.equal(sub('Mystery box'), 'imaging_general');
  assert.equal(classifyManualRoom({ equipment_type: 'ultrasound', title: 'Logiq E9' }).subtype, 'ultrasound');
});

test('rows typed other are rescued by title', () => {
  const r = (title: string) => classifyManualRoom({ equipment_type: 'other', title }).room;
  assert.equal(r('Puritan Bennett 840 Service Manual'), 'respiratory');
  assert.equal(r('Valleylab Force FX-C Electrosurgical Generator'), 'surgical');
  assert.equal(r('Metron QA-ES Electrosurgical Analyzer'), 'test_equipment');
  assert.equal(r('Physio-Control LIFEPAK 15 Service Manual'), 'defib');
  assert.equal(r('Fluke Biomedical Impulse 7000DP Defibrillator Analyzer'), 'test_equipment');
  assert.equal(r('Karl Storz C-MAC 8403 ZX Repair Manual'), 'other');
});

test('cross-room fixes for mixed DB types', () => {
  assert.equal(classifyManualRoom({ equipment_type: 'warming', title: 'Bair Hugger 750' }).room, 'surgical');
  assert.equal(classifyManualRoom({ equipment_type: 'warming', title: 'GE BiliSoft LED Service Manual' }).room, 'neonatal');
  assert.equal(classifyManualRoom({ equipment_type: 'warming', title: 'Ohmeda Infant Warmer 3000' }).room, 'neonatal');
  assert.equal(classifyManualRoom({ equipment_type: 'microscope', title: 'Zeiss OPMI Pico' }).room, 'surgical');
  assert.equal(classifyManualRoom({ equipment_type: 'microscope', title: 'Olympus BX40 Service Manual' }).room, 'lab');
  assert.equal(classifyManualRoom({ equipment_type: 'or_table', title: 'Midmark Ritter 119 Power Examination Table' }).subtype, 'exam_table');
  assert.equal(classifyManualRoom({ equipment_type: 'or_table', title: 'Stryker 966 Head/Neck Surgery Bed' }).room, 'surgical');
  assert.equal(classifyManualRoom({ equipment_type: 'pump', title: 'Kendall SCD 700 Sequential Compression' }).subtype, 'dvt');
  assert.equal(classifyManualRoom({ equipment_type: 'pump', title: 'Medela Symphony Breast Pump' }).room, 'neonatal');
});

test('doc type buckets', () => {
  assert.equal(manualDocType({ doc_kind: 'service', title: 'Force FX Service Manual' }), 'service');
  assert.equal(manualDocType({ doc_kind: null, title: 'Puritan Bennett 800 Series Circuit Diagrams' }), 'schematics');
  assert.equal(manualDocType({ doc_kind: 'service', title: 'Annual Preventive Maintenance Checklist' }), 'pm');
  assert.equal(manualDocType({ doc_kind: 'pm', title: 'x' }), 'pm');
  assert.equal(manualDocType({ doc_kind: 'parts', title: 'x' }), 'parts');
  assert.equal(manualDocType({ doc_kind: null, title: 'Jenalumar Spare Parts List' }), 'parts');
  assert.equal(manualDocType({ doc_kind: null, title: 'Medtronic IPC EC300 Service Manual' }), 'service');
  assert.equal(manualDocType({ doc_kind: 'operator', title: 'GentleMax Operator Manual' }), 'operator');
  assert.equal(manualDocType({ doc_kind: 'user', title: 'x' }), 'operator');
  assert.equal(manualDocType({ doc_kind: 'operator', title: 'Operator and Service Manual' }), 'service');
});

const ROWS = [
  { id: 1, equipment_type: 'imaging', title: 'GE LightSpeed CT Service Manual', brand: 'GE', model: 'LightSpeed 16', doc_kind: 'service' },
  { id: 2, equipment_type: 'imaging', title: 'Siemens Somatom CT Schematics', brand: 'Siemens', model: 'Somatom', doc_kind: null },
  { id: 3, equipment_type: 'ultrasound', title: 'GE Logiq E9 Service', brand: 'GE', model: 'Logiq E9', doc_kind: 'service' },
  { id: 4, equipment_type: 'laser', title: 'Candela GentleMax Service', brand: 'Candela', model: 'GentleMax', doc_kind: 'service' },
  { id: 5, equipment_type: 'laser', title: 'Candela GentleMax Operator Manual', brand: 'Candela', model: 'GentleMax', doc_kind: 'operator' },
  { id: 6, equipment_type: 'ventilator', title: 'Puritan Bennett 840', brand: 'Puritan Bennett', model: '840', doc_kind: 'service' },
];
const ids = (v: { results: { id: number }[] }) => v.results.map((r) => r.id).sort();

test('cascade: room counts, zero rooms hidden, no selection shows all', () => {
  const v = computeManualCascade(ROWS, EMPTY_CASCADE);
  assert.deepEqual(v.rooms.map((r) => [r.id, r.count]), [['imaging', 3], ['respiratory', 1], ['lasers', 2]]);
  assert.equal(v.subtypes.length, 0, 'subtypes only after a room');
  assert.equal(v.results.length, 6);
  assert.ok(v.rooms.every((r) => r.count > 0));
});

test('cascade: room → subtype → brand narrows and counts follow', () => {
  let s = toggleCascade(EMPTY_CASCADE, 'room', 'imaging');
  let v = computeManualCascade(ROWS, s);
  assert.deepEqual(v.subtypes.map((o) => [o.id, o.count]), [['ct', 2], ['ultrasound', 1]]);
  assert.deepEqual(v.brands.map((o) => [o.id, o.count]), [['GE', 2], ['Siemens', 1]]);
  s = toggleCascade(s, 'subtype', 'ct');
  v = computeManualCascade(ROWS, s);
  assert.deepEqual(v.brands.map((o) => [o.id, o.count]), [['GE', 1], ['Siemens', 1]]);
  s = toggleCascade(s, 'brand', 'Siemens');
  v = computeManualCascade(ROWS, s);
  assert.deepEqual(ids(v), [2]);
});

test('cascade: multi-select within a level is OR; subtype narrows only its room', () => {
  let s = toggleCascade(toggleCascade(EMPTY_CASCADE, 'room', 'imaging'), 'room', 'lasers');
  s = toggleCascade(s, 'subtype', 'ultrasound');
  const v = computeManualCascade(ROWS, s);
  assert.deepEqual(ids(v), [3, 4, 5]);
  s = toggleCascade(toggleCascade(EMPTY_CASCADE, 'brand', 'GE'), 'brand', 'Candela');
  assert.deepEqual(ids(computeManualCascade(ROWS, s)), [1, 3, 4, 5]);
});

test('cascade: doc type at every level, its own counts ignore itself', () => {
  const s = toggleCascade(EMPTY_CASCADE, 'doc', 'operator');
  const v = computeManualCascade(ROWS, s);
  assert.deepEqual(ids(v), [5]);
  assert.deepEqual(v.rooms.map((r) => [r.id, r.count]), [['lasers', 1]]);
  assert.deepEqual(v.docs.map((d) => [d.id, d.count]), [['service', 4], ['operator', 1], ['schematics', 1]]);
});

test('cascade: stale selections are pruned (no dead ends)', () => {
  const s = { ...EMPTY_CASCADE, rooms: ['dental' as const, 'imaging' as const], subtypes: ['mri', 'ct'], brands: ['Candela', 'GE'] };
  const v = computeManualCascade(ROWS, s);
  assert.deepEqual(v.state.rooms, ['imaging']);
  assert.deepEqual(v.state.subtypes, ['ct']);
  assert.deepEqual(v.state.brands, ['GE']);
  assert.deepEqual(ids(v), [1]);
});

test('cascade: removing a room drops its subtypes', () => {
  let s = toggleCascade(EMPTY_CASCADE, 'room', 'imaging');
  s = toggleCascade(s, 'subtype', 'ct');
  s = toggleCascade(s, 'room', 'imaging');
  assert.deepEqual(s.subtypes, []);
});

test('cascade: model search matches model and title, spacing-insensitive', () => {
  assert.deepEqual(ids(computeManualCascade(ROWS, { ...EMPTY_CASCADE, model: 'logiq e9' })), [3]);
  assert.deepEqual(ids(computeManualCascade(ROWS, { ...EMPTY_CASCADE, model: 'gentlemax' })), [4, 5]);
  assert.deepEqual(ids(computeManualCascade(ROWS, { ...EMPTY_CASCADE, model: 'lightspeed16' })), [1]);
});

test('url: repeated params round-trip and legacy links still work', () => {
  const s = { rooms: ['imaging' as const, 'lasers' as const], subtypes: ['ct'], brands: ['GE', 'Puritan Bennett'], docs: ['service' as const], model: 'lightspeed' };
  const qs = writeManualCascadeParams(new URLSearchParams('q=abc&room=laser'), s);
  assert.equal(qs.get('q'), 'abc');
  assert.deepEqual(parseManualCascadeParams(qs.toString()), s);
  assert.deepEqual(parseManualCascadeParams('?room=laser').rooms, ['lasers']);
  assert.deepEqual(parseManualCascadeParams('?room=c_arm'), { ...EMPTY_CASCADE, rooms: ['imaging'], subtypes: ['fluoro'] });
  assert.deepEqual(parseManualCascadeParams('?room=all&make=Candela'), { ...EMPTY_CASCADE, brands: ['Candela'] });
  assert.deepEqual(parseManualCascadeParams('?sub=ct').rooms, ['imaging']);
  assert.deepEqual(parseManualCascadeParams('?room=bogus&doc=bogus&sub=bogus'), EMPTY_CASCADE);
  assert.equal(writeManualCascadeParams(new URLSearchParams(), EMPTY_CASCADE).toString(), '');
});
