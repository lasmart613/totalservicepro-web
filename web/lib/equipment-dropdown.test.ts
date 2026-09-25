import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchEquipmentCatalog,
  catalogChoiceLabel,
  dedupeManufacturerNames,
  manufacturerChoiceLabel,
  dedupeModelChoices,
  mergedManufacturerOption,
  mergedModelOption,
  listCatalogManufacturerChoices,
  listCatalogManufacturers,
  listCatalogModelChoices,
  listCatalogModels,
  manufacturerMatches,
  modelBelongsToManufacturer,
  modelMatchesEquipmentType,
  normalizeManufacturerRow,
  normalizeModelRow,
  withSavedManufacturerChoice,
  withSavedModelChoice,
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
  assert.match(estimate, /listModelChoices/);
  assert.match(estimate, /equipmentType|equipment_type/);
  assert.doesNotMatch(estimate, /listManufacturers\(\)/);

  const invoice = readFileSync(join(here, '../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  assert.match(invoice, /useEquipmentCatalog/);
  assert.doesNotMatch(invoice, /listManufacturers\(\)/);
});

test('service tickets join models by manufacturer id or name without a label column', () => {
  const tickets = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  const schedule = readFileSync(join(here, '../app/service-schedule/page.tsx'), 'utf8');
  assert.match(tickets, /listManufacturerChoices/);
  assert.match(tickets, /listModelChoices/);
  assert.match(tickets, /select\('id, name, manufacturer_id'\)/);
  assert.doesNotMatch(tickets, /select\('id, name, label/);
  assert.match(schedule, /listManufacturerChoices/);
  assert.match(schedule, /listModelChoices/);
});

test('internal codes display a human label and duplicate spellings collapse', () => {
  assert.equal(catalogChoiceLabel('alex_trivantage'), 'Alex Trivantage');
  assert.equal(catalogChoiceLabel('candela_core', 'Candela Core'), 'Candela Core');
  assert.equal(catalogChoiceLabel('Xeo'), 'Xeo');

  const live = {
    manufacturers: [
      normalizeManufacturerRow({ id: 1, name: 'Alma' }),
      normalizeManufacturerRow({ id: 2, name: 'Alma Lasers' }),
      normalizeManufacturerRow({ id: 3, name: 'alex_trivantage', display_name: 'Alex TriVantage' }),
      normalizeManufacturerRow({ id: 4, name: 'Hoya ConBio' }),
    ],
    models: [
      normalizeModelRow({
        id: 9,
        name: 'candela_core',
        manufacturer: 'Candela',
        manufacturer_id: 2,
      }),
    ],
  };
  const mfrs = listCatalogManufacturers(live);
  assert.ok(mfrs.includes('Alma'));
  assert.equal(mfrs.includes('Alma Lasers'), false);
  assert.equal(mfrs.includes('alex_trivantage'), false);
  assert.equal(mfrs.filter((name) => /hoya|conbio/i.test(name)).length, 1);
  assert.ok(mfrs.includes('HOYA ConBio'));

  const choices = listCatalogManufacturerChoices(live);
  assert.equal(choices.some((c) => c.value === 'alex_trivantage'), false);
  const keptMake = withSavedManufacturerChoice(choices, 'alex_trivantage');
  assert.ok(keptMake.some((c) => c.value === 'alex_trivantage'));
  assert.equal(choices.find((c) => c.value === 'Alma')?.value, 'Alma');

  const modelChoices = listCatalogModelChoices('Candela', live);
  const core = modelChoices.find((c) => c.value === 'candela_core');
  assert.ok(core);
  assert.equal(core?.label, 'Candela Core');
  assert.equal(core?.value, 'candela_core');
});

test('Syneron merges into Candela instead of an empty brand', () => {
  const syneron = normalizeManufacturerRow({ id: 8, name: 'Syneron' });
  const live = {
    manufacturers: [syneron, CANDELA, normalizeManufacturerRow({ id: 11, name: 'Syneron Candela' })],
    models: [
      normalizeModelRow({
        id: 1,
        name: 'GentleMax',
        label: 'GentleMax',
        manufacturer: 'Candela',
        manufacturer_id: 2,
      }),
      normalizeModelRow({
        id: 2,
        name: 'eLight',
        label: 'eLight',
        manufacturer: 'Syneron',
        manufacturer_id: 8,
      }),
      normalizeModelRow({
        id: 3,
        name: 'GentleLASE',
        label: 'GentleLASE',
        manufacturer: 'Candela',
        manufacturer_id: 8,
      }),
    ],
  };
  const names = listCatalogModels('Syneron', live);
  assert.ok(names.includes('eLight'));
  assert.ok(names.some((name) => /gentle/i.test(name)));
  assert.equal(manufacturerMatches('Syneron', { id: 2, name: 'Candela' }), true);
  const choices = listCatalogManufacturerChoices(live);
  assert.equal(choices.some((choice) => choice.label === 'Syneron'), false);
  assert.ok(choices.some((choice) => choice.label === 'Candela'));
});

test('HOYA Con-Bio aliases collapse and compact model codes humanize without changing values', () => {
  assert.equal(catalogChoiceLabel('coolglide'), 'CoolGlide');
  assert.equal(catalogChoiceLabel('co2re'), 'CO2RE');
  assert.equal(catalogChoiceLabel('gentlemax'), 'GentleMax');
  assert.equal(catalogChoiceLabel('vbeam2'), 'Vbeam 2');
  assert.equal(catalogChoiceLabel('vpyag'), 'VP YAG');
  assert.equal(catalogChoiceLabel('p100h'), 'Pulse 100H/50H');
  assert.equal(catalogChoiceLabel('p30h'), 'P30H');
  assert.equal(catalogChoiceLabel('p120'), 'P120');
  assert.equal(catalogChoiceLabel('yc1600'), 'YC-1600');
  assert.equal(catalogChoiceLabel('pl003'), 'PL003');
  assert.equal(catalogChoiceLabel('xeo2'), 'XEO2');
  assert.equal(catalogChoiceLabel('CoolGlide'), 'CoolGlide');

  const live = {
    manufacturers: [
      normalizeManufacturerRow({ id: 1, name: 'Con-Bio' }),
      normalizeManufacturerRow({ id: 2, name: 'HOYA ConBio' }),
      normalizeManufacturerRow({ id: 3, name: 'Quanta' }),
      normalizeManufacturerRow({ id: 4, name: 'Quanta System' }),
      normalizeManufacturerRow({ id: 5, name: 'AMS' }),
      normalizeManufacturerRow({ id: 6, name: 'American Medical Systems' }),
    ],
    models: [
      normalizeModelRow({ id: 1, name: 'coolglide', label: 'coolglide', manufacturer: 'Cutera', manufacturer_id: 10 }),
      normalizeModelRow({ id: 2, name: 'Gentlemax Pro', label: 'Gentlemax Pro', manufacturer: 'Candela', manufacturer_id: 2 }),
      normalizeModelRow({ id: 3, name: 'GentleMax Pro', label: 'GentleMax Pro', manufacturer: 'Candela', manufacturer_id: 2 }),
      normalizeModelRow({ id: 4, name: 'Stellar M22', label: 'Stellar M22', manufacturer: 'Lumenis', manufacturer_id: 20 }),
      normalizeModelRow({ id: 5, name: 'Stellar M22', label: 'Stellar M22', manufacturer: 'Lumenis', manufacturer_id: 20 }),
      normalizeModelRow({ id: 6, name: 'Soprano Titanium', label: 'Soprano Titanium', manufacturer: 'Alma', manufacturer_id: 21 }),
      normalizeModelRow({ id: 7, name: 'soprano titanium', label: 'soprano titanium', manufacturer: 'Alma', manufacturer_id: 21 }),
    ],
  };
  const mfrs = listCatalogManufacturers(live);
  assert.equal(mfrs.filter((name) => /con-?bio|hoya conbio/i.test(name)).length, 1);
  assert.ok(mfrs.includes('HOYA ConBio'));
  assert.equal(mfrs.filter((name) => /quanta/i.test(name)).length, 1);
  assert.ok(mfrs.includes('Quanta System'));
  assert.equal(mfrs.filter((name) => /ams|laserscope|american medical systems/i.test(name)).length, 1);
  assert.ok(mfrs.includes('AMS / Laserscope'));

  const candela = listCatalogModelChoices('Candela', live);
  const gentle = candela.filter((choice) => choice.value.trim().toLowerCase() === 'gentlemax pro');
  assert.equal(gentle.length, 1);
  assert.equal(gentle[0].value, 'GentleMax Pro');
  assert.equal(gentle[0].label, 'GentleMax Pro (755/1064 nm)');

  const cutera = listCatalogModelChoices('Cutera', {
    ...live,
    models: live.models.filter((model) => /coolglide/i.test(model.label)),
  });
  const glide = cutera.find((choice) => /coolglide/i.test(choice.value));
  assert.ok(glide);
  assert.equal(glide?.value, 'coolglide');
  assert.equal(glide?.label, 'CoolGlide');

  const lumenis = listCatalogModelChoices('Lumenis', {
    manufacturers: [normalizeManufacturerRow({ id: 20, name: 'Lumenis' })],
    models: live.models.filter((model) => /stellar/i.test(model.label)),
  });
  const stellar = lumenis.filter((choice) => choice.value.trim().toLowerCase() === 'stellar m22');
  assert.equal(stellar.length, 1);
  assert.equal(stellar[0].value, 'Stellar M22');

  const alma = listCatalogModelChoices('Alma', {
    manufacturers: [normalizeManufacturerRow({ id: 21, name: 'Alma' })],
    models: live.models.filter((model) => /soprano/i.test(model.label)),
  });
  const soprano = alma.filter((choice) => choice.value.trim().toLowerCase() === 'soprano titanium');
  assert.equal(soprano.length, 1);
  assert.equal(soprano[0].value, 'Soprano Titanium');
});

test('stored manufacturer alias selects the merged dropdown option', () => {
  const options = dedupeManufacturerNames([
    'Alma',
    'Alma Lasers',
    'Quanta',
    'Quanta System',
    'AMS',
    'American Medical Systems',
    'Con-Bio',
    'HOYA ConBio',
  ]);
  assert.equal(mergedManufacturerOption('Alma Lasers', options), 'Alma');
  assert.equal(mergedManufacturerOption('alma', options), 'Alma');
  assert.equal(mergedManufacturerOption('Alma', options), 'Alma');
  assert.equal(mergedManufacturerOption('Quanta', options), 'Quanta System');
  assert.equal(mergedManufacturerOption('AMS', options), 'AMS / Laserscope');
  assert.equal(mergedManufacturerOption('Con-Bio', options), 'HOYA ConBio');
  assert.equal(mergedManufacturerOption('Acme Lasers', options), 'Acme Lasers');
  assert.equal(mergedManufacturerOption('Alma Lasers', ['Alma Lasers']), 'Alma Lasers');

  assert.equal(dedupeManufacturerNames(['AMS', 'Laserscope', 'LaserScope']).join('|'), 'AMS / Laserscope');
  assert.equal(dedupeManufacturerNames(['Coherent', 'Lumenis', 'Coherent / Lumenis']).join('|'), 'Lumenis (Coherent)');

  const edit = readFileSync(join(here, '../app/service-tickets/[id]/page.tsx'), 'utf8');
  assert.match(edit, /mergedManufacturerOption/);
  assert.match(edit, /mergedModelOption/);
  assert.match(edit, /withSavedModelChoice/);
  assert.match(edit, /withSavedManufacturerChoice/);
  assert.match(edit, /value=\{makeValue\}/);
  assert.match(edit, /value=\{modelValue\}/);
});

test('near-duplicate models share one display label and keep the stored code', () => {
  const options = dedupeModelChoices([
    { value: 'GentleMax Pro', label: 'GentleMax Pro' },
    { value: 'Gentlemax Pro', label: 'Gentlemax Pro' },
    { value: 'GentleMax Pro Plus', label: 'GentleMax Pro Plus' },
    { value: 'gentlemax pro plus', label: 'gentlemax pro plus' },
    { value: 'Stellar M22', label: 'Stellar M22' },
    { value: 'stellar m22', label: 'stellar m22' },
    { value: 'Soprano Titanium', label: 'Soprano Titanium' },
    { value: 'soprano titanium', label: 'soprano titanium' },
    { value: 'MedLite C6', label: 'MedLite C6' },
    { value: 'MedLite C6 / IV', label: 'MedLite C6 / IV' },
    { value: 'LightSheer Duet', label: 'LightSheer Duet' },
    { value: 'LightSheer DUET', label: 'LightSheer DUET' },
    { value: 'GreenLight XPS', label: 'GreenLight XPS' },
    { value: 'Greenlight XPS', label: 'Greenlight XPS' },
    { value: 'VersaPulse PowerSuite', label: 'VersaPulse PowerSuite' },
    { value: 'VersaPulse PowerSuite Rev C', label: 'VersaPulse PowerSuite Rev C' },
    { value: 'OcuLight SL/SLx', label: 'OcuLight SL/SLx' },
    { value: 'Oculight SL / SLx', label: 'Oculight SL / SLx' },
    { value: 'Aura XP', label: 'Aura XP' },
    { value: 'AURA XP 15W KTP', label: 'AURA XP 15W KTP' },
    { value: 'co2re', label: 'co2re' },
  ]);
  const count = (re: RegExp) => options.filter((option) => re.test(option.label)).length;
  assert.equal(count(/^GentleMax Pro$/), 1);
  assert.equal(count(/GentleMax Pro Plus/i), 1);
  assert.equal(count(/Stellar M22/i), 1);
  assert.equal(count(/Soprano Titanium/i), 1);
  assert.equal(count(/MedLite C6/i), 1);
  assert.equal(count(/LightSheer DUET/i), 1);
  assert.equal(count(/GreenLight XPS/i), 1);
  assert.equal(count(/VersaPulse PowerSuite/i), 1);
  assert.equal(count(/OcuLight SL\/SLx/i), 1);
  assert.equal(count(/Aura XP/i), 1);
  assert.ok(options.some((option) => option.label === 'Aura XP (15W KTP)'));
  const co2 = options.find((option) => option.label === 'CO2RE');
  assert.equal(co2?.value, 'co2re');
  assert.equal(mergedModelOption('Gentlemax Pro', options), 'GentleMax Pro');
  assert.equal(mergedModelOption('Aura XP', options), options.find((option) => option.label === 'Aura XP (15W KTP)')?.value);
  assert.equal(mergedModelOption('co2re', options), 'co2re');
  assert.equal(catalogChoiceLabel('alexlazr'), 'AlexLAZR');
  assert.equal(catalogChoiceLabel('cbeam'), 'C-beam');
  assert.equal(catalogChoiceLabel('sclero'), 'ScleroPLUS');
  assert.equal(catalogChoiceLabel('smoothbeam'), 'SmoothBeam');
  assert.equal(catalogChoiceLabel('bmbq 810'), 'BMBQ-810');
  assert.equal(catalogChoiceLabel('fels 25 a'), 'FELS-25A');
  assert.equal(catalogChoiceLabel('visulas yag iii'), 'Visulas YAG III');
  assert.equal(catalogChoiceLabel('harmony xl'), 'Harmony XL');
  assert.equal(catalogChoiceLabel('optimis ii'), 'Optimis II');
  assert.equal(catalogChoiceLabel('sm079'), 'SM079');
  assert.equal(catalogChoiceLabel('PL003'), 'PL003');
  assert.equal(catalogChoiceLabel('9900'), '9900');
  assert.equal(catalogChoiceLabel('zz9'), 'ZZ9');
});

test('curated dropdown labels stay exact on the option builder', () => {
  const mfrs = listCatalogManufacturerChoices({
    manufacturers: [
      normalizeManufacturerRow({ id: 1, name: 'Deka' }),
      normalizeManufacturerRow({ id: 2, name: 'Ge Oec' }),
      normalizeManufacturerRow({ id: 3, name: 'candela' }),
      normalizeManufacturerRow({ id: 4, name: 'AMS' }),
      normalizeManufacturerRow({ id: 5, name: 'Lumenis' }),
    ],
  });
  const labels = mfrs.map((choice) => choice.label);
  assert.ok(labels.includes('AMS / Laserscope'));
  assert.ok(labels.includes('Lumenis (Coherent)'));
  assert.ok(labels.includes('DEKA'));
  assert.ok(labels.includes('GE OEC'));
  assert.ok(labels.includes('Candela'));
  assert.equal(labels.includes('candela'), false);
  assert.equal(labels.includes('Ams Laserscope'), false);
  assert.equal(labels.includes('Deka'), false);
  assert.equal(labels.includes('Ge Oec'), false);
  assert.equal(labels.includes('Syneron'), false);
  assert.equal(manufacturerChoiceLabel('candela'), 'Candela');
  assert.equal(manufacturerChoiceLabel('AMS / Laserscope'), 'AMS / Laserscope');
  assert.equal(manufacturerChoiceLabel('DEKA'), 'DEKA');

  const cutera = listCatalogModelChoices('Cutera');
  assert.equal(cutera.filter((choice) => choice.label === 'Excel V').length, 1);
  assert.equal(cutera.filter((choice) => choice.label === 'Excel V+').length, 1);
  assert.ok(cutera.some((choice) => choice.label === 'Excel HR'));

  const candela = listCatalogModelChoices('Candela');
  assert.ok(candela.some((choice) => choice.label === 'GentleMax Pro (755/1064 nm)'));
  assert.ok(candela.some((choice) => choice.label === 'Mini GentleLASE (MGL)'));
  assert.equal(candela.some((choice) => /755 1064 Nm|\bMgl\b/.test(choice.label)), false);
  assert.equal(candela.filter((choice) => choice.label === 'PicoWay').length, 1);
  assert.equal(candela.some((choice) => choice.label === 'PicoWay Picosecond Laser'), false);

  const cynosure = listCatalogModelChoices('Cynosure');
  assert.ok(cynosure.some((choice) => choice.label === 'Apogee Elite / Elite+'));
  assert.ok(cynosure.some((choice) => choice.label === 'Apogee'));
  assert.ok(cynosure.some((choice) => choice.label === 'Apogee+'));
  assert.ok(cynosure.some((choice) => choice.label === 'Elite'));
  assert.ok(cynosure.some((choice) => choice.label === 'Elite+'));
  assert.ok(cynosure.some((choice) => choice.label === 'RevLite SI'));

  const lumenis = listCatalogModelChoices('Lumenis');
  assert.ok(lumenis.some((choice) => choice.label === 'AcuPulse Duo CO₂'));
  assert.equal(lumenis.some((choice) => choice.label === 'AcuPulse Duo Co'), false);

  const omni = listCatalogModelChoices('OmniGuide');
  assert.ok(omni.some((choice) => choice.label === 'InteliGuide CO₂ 25W'));
  assert.equal(omni.some((choice) => choice.label === 'InteliGuide Co 25W'), false);

  const hoya = listCatalogModelChoices('HOYA ConBio');
  const med = hoya.filter((choice) => /MedLite/i.test(choice.label));
  assert.equal(med.length, 1);
  assert.notEqual(med[0]?.label, 'MedLite C6 IV');

  const live = dedupeModelChoices([
    { value: 'LightSheer ET', label: 'LightSheer ET' },
    { value: 'LightSheer XC', label: 'LightSheer XC' },
    { value: 'GreenLight HPS', label: 'GreenLight HPS' },
    { value: '9900', label: '9900' },
    { value: 'Oec 9900', label: 'Oec 9900' },
    { value: 'FELS-25A', label: 'FELS-25A' },
    { value: 'FELS25A Og', label: 'FELS25A Og' },
    { value: 'PicoWay', label: 'PicoWay' },
    { value: 'PicoWay Picosecond Laser', label: 'PicoWay Picosecond Laser' },
    { value: 'SM079', label: 'SM079' },
    { value: 'PL003', label: 'PL003' },
    { value: 'RevC', label: 'RevC' },
    { value: 'Excel V', label: 'Excel V' },
    { value: 'Excel V+', label: 'Excel V+' },
  ]);
  assert.ok(live.some((choice) => choice.label === 'LightSheer ET'));
  assert.ok(live.some((choice) => choice.label === 'LightSheer XC'));
  assert.ok(live.some((choice) => choice.label === 'GreenLight HPS'));
  assert.equal(live.filter((choice) => choice.label === '9900').length, 1);
  assert.equal(live.filter((choice) => choice.label === 'OEC 9900').length, 1);
  assert.equal(live.filter((choice) => /FELS/i.test(choice.label)).length, 1);
  assert.equal(live.find((choice) => /FELS/i.test(choice.label))?.label, 'FELS-25A');
  assert.equal(live.filter((choice) => choice.label === 'PicoWay').length, 1);
  assert.equal(live.some((choice) => /SM079|PL003/.test(choice.label)), false);
  assert.ok(live.some((choice) => choice.label === 'RevC'));
  assert.equal(catalogChoiceLabel('RevC'), 'RevC');
  assert.ok(live.some((choice) => choice.label === 'Excel V' && choice.value === 'Excel V'));
  assert.ok(live.some((choice) => choice.label === 'Excel V+' && choice.value === 'Excel V+'));

  const alma = [{ value: 'Harmony XL', label: 'Harmony XL' }];
  assert.equal(withSavedModelChoice(alma, 'CO2RE', 'Alma', 'Candela').some((choice) => choice.value === 'CO2RE'), false);
  assert.equal(withSavedModelChoice(alma, 'CO2RE', 'Iridex', 'Candela').some((choice) => choice.value === 'CO2RE'), false);
  const kept = withSavedModelChoice([{ value: 'GentleMax', label: 'GentleMax' }], 'CO2RE', 'Candela', 'candela');
  assert.ok(kept.some((choice) => choice.label === 'CO2RE' && choice.value === 'CO2RE'));
  assert.equal(catalogChoiceLabel('sm079'), 'SM079');
  assert.equal(catalogChoiceLabel('PL003'), 'PL003');
});

test('remaining curated labels merge and empty brands stay hidden', () => {
  const lumenis = dedupeModelChoices([
    { value: 'VersaPulse PowerSuite', label: 'VersaPulse PowerSuite' },
    { value: 'VersaPulse PowerSuite Revc', label: 'VersaPulse PowerSuite Revc' },
    { value: 'PowerSuite Holmium', label: 'PowerSuite Holmium' },
    { value: 'PowerSuite 100W Holmium', label: 'PowerSuite 100W Holmium' },
    { value: 'Acupulse Duo', label: 'Acupulse Duo' },
    { value: 'AcuPulse Duo CO₂', label: 'AcuPulse Duo CO₂' },
    { value: 'Ultrapulse 5000', label: 'Ultrapulse 5000' },
    { value: 'Ultrapulse Duo', label: 'Ultrapulse Duo' },
  ]);
  assert.equal(lumenis.filter((choice) => /VersaPulse PowerSuite/i.test(choice.label)).length, 1);
  assert.equal(lumenis.find((choice) => /VersaPulse PowerSuite/i.test(choice.label))?.label, 'VersaPulse PowerSuite Rev C');
  assert.equal(lumenis.filter((choice) => /PowerSuite/i.test(choice.label) && !/VersaPulse/i.test(choice.label)).length, 1);
  assert.ok(lumenis.some((choice) => choice.label === 'PowerSuite 100W Holmium'));
  assert.equal(lumenis.filter((choice) => /AcuPulse Duo/i.test(choice.label)).length, 1);
  assert.ok(lumenis.some((choice) => choice.label === 'AcuPulse Duo CO₂'));
  assert.ok(lumenis.some((choice) => choice.label === 'UltraPulse 5000'));
  assert.ok(lumenis.some((choice) => choice.label === 'UltraPulse Duo'));
  assert.equal(catalogChoiceLabel('VersaPulse PowerSuite Revc'), 'VersaPulse PowerSuite Rev C');

  const candela = dedupeModelChoices([
    { value: 'GentleMax Pro', label: 'GentleMax Pro' },
    { value: 'GentleMax Pro (755/1064 nm)', label: 'GentleMax Pro (755/1064 nm)' },
    { value: 'GentleMax Pro Plus', label: 'GentleMax Pro Plus' },
    { value: 'VBeam Perfecta', label: 'VBeam Perfecta' },
    { value: 'VBeam Perfecta (Pulsed Dye)', label: 'VBeam Perfecta (Pulsed Dye)' },
    { value: 'P100H', label: 'P100H' },
    { value: 'P120', label: 'P120' },
    { value: 'P30H', label: 'P30H' },
  ]);
  assert.equal(candela.filter((choice) => /GentleMax Pro/i.test(choice.label)).length, 2);
  assert.ok(candela.some((choice) => choice.label === 'GentleMax Pro (755/1064 nm)'));
  assert.ok(candela.some((choice) => choice.label === 'GentleMax Pro Plus'));
  assert.equal(candela.filter((choice) => /VBeam Perfecta/i.test(choice.label)).length, 1);
  assert.equal(candela.find((choice) => /VBeam Perfecta/i.test(choice.label))?.label, 'VBeam Perfecta (Pulsed Dye)');
  assert.ok(candela.some((choice) => choice.label === 'Pulse 100H/50H'));
  assert.equal(candela.some((choice) => /P120|P30H/.test(choice.label)), false);
  assert.equal(catalogChoiceLabel('P30H'), 'P30H');
  assert.equal(catalogChoiceLabel('P120'), 'P120');

  const dornier = listCatalogModelChoices('Dornier', {
    manufacturers: [normalizeManufacturerRow({ id: 40, name: 'Dornier' })],
    models: [
      normalizeModelRow({ id: 1, name: 'H20', label: 'H20', manufacturer: 'Dornier', manufacturer_id: 40 }),
      normalizeModelRow({ id: 2, name: 'H20', label: 'H20 (Medilas holmium)', manufacturer: 'Dornier', manufacturer_id: 40 }),
      normalizeModelRow({ id: 3, name: 'H20 H30', label: 'H20 H30', manufacturer: 'Dornier', manufacturer_id: 40 }),
      normalizeModelRow({ id: 4, name: 'H30', label: 'H30 (Medilas holmium)', manufacturer: 'Dornier', manufacturer_id: 40 }),
    ],
  });
  const h20 = dornier.filter((choice) => choice.label === 'Medilas H20');
  const h30 = dornier.filter((choice) => choice.label === 'Medilas H30');
  assert.equal(h20.length, 1);
  assert.equal(h30.length, 1);
  assert.equal(dornier.some((choice) => /H20 H30|Medilas holmium/i.test(choice.label)), false);

  const ge = listCatalogModelChoices('GE OEC', {
    manufacturers: [normalizeManufacturerRow({ id: 99, name: 'GE OEC' })],
    models: [
      normalizeModelRow({ id: 9, name: '9900', label: '9900', manufacturer: 'GE OEC', manufacturer_id: 99 }),
    ],
  });
  assert.ok(ge.some((choice) => choice.label === 'OEC 9900'));
  assert.equal(catalogChoiceLabel('9900'), '9900');

  const polaris = {
    manufacturers: [normalizeManufacturerRow({ id: 70, name: 'Polaris' })],
    models: [
      normalizeModelRow({ id: 8, name: 'P30H', label: 'P30H', manufacturer: 'Polaris', manufacturer_id: 70 }),
    ],
  };
  assert.equal(listCatalogManufacturers(polaris).includes('Polaris'), false);
  const kept = withSavedManufacturerChoice(listCatalogManufacturerChoices(polaris), 'Polaris');
  assert.ok(kept.some((choice) => choice.value === 'Polaris'));
});

test('Android estimate generator loads manufacturers + laser_models', () => {
  const html = readFileSync(join(here, '../../app/src/main/assets/estimate_generator.html'), 'utf8');
  assert.match(html, /manufacturers/);
  assert.match(html, /laser_models/);
  assert.match(html, /manufacturer_id/);
  assert.match(html, /equipment_type|equipmentType/);
});
