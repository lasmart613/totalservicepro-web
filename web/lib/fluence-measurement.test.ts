import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import {
  COMMON_SPOT_SIZES_MM,
  applyMeasurementEdit,
  circularSpotAreaCm2,
  errorPercent,
  fluenceFromEnergyJ,
  formatErrorPercent,
  hydrateMeasurement,
  isFluenceMeasurement,
  measurementResult,
  newFluenceMeasurement,
  spotSizeChoicesMm,
  viewMeasurement,
} from './fluence-measurement.ts';
import {
  MODELS,
  mergeModelParamValues,
  paramDisplayLabel,
  paramInputMode,
  paramStorageKey,
  systemParameterRows,
} from './models.ts';

test('circular spot converts joules to fluence', () => {
  const area = circularSpotAreaCm2(10);
  assert.ok(area != null);
  assert.ok(Math.abs(area - Math.PI * 0.25) < 1e-12);
  const fluence = fluenceFromEnergyJ(5, 10);
  assert.equal(fluence!.toFixed(2), '6.37');
  assert.equal(fluenceFromEnergyJ(5, 0), null);
  assert.equal(fluenceFromEnergyJ(5, -4), null);
  assert.equal(circularSpotAreaCm2(Number.NaN), null);
});

test('error percent is (measured - set) / set × 100', () => {
  const low = errorPercent(8.4, 10);
  assert.ok(low != null);
  assert.ok(Math.abs(low - -16) < 1e-9);
  assert.equal(formatErrorPercent(low), '-16.0%');
  assert.equal(errorPercent(12, 10), 20);
  assert.equal(formatErrorPercent(errorPercent(12, 10)!), '20.0%');
  assert.equal(errorPercent(5, 0), null);
  assert.equal(errorPercent(Number.NaN, 10), null);
});

test('energy is converted before the error percent; fluence is used as entered', () => {
  const area = circularSpotAreaCm2(10)!;
  const energyFor84 = 8.4 * area;
  const fromEnergy = measurementResult({
    setFluence: 10,
    measured: energyFor84,
    measuredAs: 'energy',
    spotDiameterMm: 10,
  });
  assert.equal(fromEnergy.resultFluence!.toFixed(2), '8.40');
  assert.equal(fromEnergy.errorPercent!.toFixed(1), '-16.0');

  const fromFluence = measurementResult({
    setFluence: 10,
    measured: 8.4,
    measuredAs: 'fluence',
    spotDiameterMm: null,
  });
  assert.equal(fromFluence.resultFluence, 8.4);
  assert.ok(Math.abs(fromFluence.errorPercent! - -16) < 1e-9);

  const missingSpot = measurementResult({
    setFluence: 10,
    measured: 5,
    measuredAs: 'energy',
    spotDiameterMm: null,
  });
  assert.equal(missingSpot.resultFluence, null);
  assert.equal(missingSpot.errorPercent, null);
});

test('other diameter uses the same circle as a listed spot', () => {
  const row = newFluenceMeasurement({
    wavelength: '755 nm Alexandrite',
    spotSizeMm: 'other',
    setFluence: 10,
    measuredMode: 'fluence',
    measuredUnit: 'J',
    measuredValue: 5,
  });
  row.spotSizeOtherMm = '10';
  const view = viewMeasurement({ ...row, spotSizeOtherMm: '10' });
  assert.equal(view.legacy, false);
  assert.equal(view.spot, '10 mm');
  assert.equal(view.set, '10.00 J/cm²');
  assert.equal(view.measured, '5.00 J');
  assert.equal(view.result, '6.37 J/cm²');
  assert.equal(view.error, '-36.3%');
  assert.equal(view.pass, false);
});

test('spot list is per model, otherwise the common sizes', () => {
  assert.deepEqual(spotSizeChoicesMm(MODELS['Cynosure Apogee Elite MPX']), [10, 12, 15]);
  assert.deepEqual(spotSizeChoicesMm(MODELS.PowerSuite), [...COMMON_SPOT_SIZES_MM]);
  assert.deepEqual(spotSizeChoicesMm(null), [...COMMON_SPOT_SIZES_MM]);
});

test('Apogee Elite MPX renames handpiece shots and adds pump chamber counters', () => {
  const params = MODELS['Cynosure Apogee Elite MPX'].params;
  const keys = params.map((param) => paramStorageKey(param));
  assert.ok(keys.includes('Alexandrite Lamp Shots'));
  assert.ok(keys.includes('Nd:YAG Lamp Shots'));
  assert.ok(keys.includes('Handpiece Shots'));
  assert.ok(keys.includes('Alex Pump Chamber Shots'));
  assert.ok(keys.includes('YAG Pump Chamber Shots'));
  const handpiece = params.find((param) => paramStorageKey(param) === 'Handpiece Shots');
  assert.ok(handpiece);
  assert.equal(paramDisplayLabel(handpiece!), 'BBL Handpiece Shots');
  assert.equal(paramInputMode(handpiece!), 'numeric');
  assert.equal(
    paramInputMode(params.find((param) => paramStorageKey(param) === 'Alex Pump Chamber Shots')!),
    'numeric'
  );
  assert.equal(
    paramInputMode(params.find((param) => paramStorageKey(param) === 'YAG Pump Chamber Shots')!),
    'numeric'
  );

  const stored: Record<string, string> = {};
  for (const param of params) stored[paramStorageKey(param)] = '';
  stored['Handpiece Shots'] = '42';
  assert.equal(stored['Handpiece Shots'], '42');
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'BBL Handpiece Shots'), false);

  const elite = MODELS['Cynosure Apogee Elite'].params.find(
    (param) => paramStorageKey(param) === 'Handpiece Shots'
  );
  assert.equal(paramDisplayLabel(elite!), 'Handpiece Shots');
});

test('saved handpiece shots keep their key and show the BBL label', () => {
  const merged = mergeModelParamValues(MODELS['Cynosure Apogee Elite MPX'], {
    'Handpiece Shots': '1200',
    'Alexandrite Lamp Shots': '400',
  });
  assert.equal(merged['Handpiece Shots'], '1200');
  assert.equal(merged['Alex Pump Chamber Shots'], '');
  assert.equal(merged['YAG Pump Chamber Shots'], '');

  const rows = systemParameterRows(
    {
      'Handpiece Shots': '1200',
      'Alexandrite Lamp Shots': '400',
      'Nd:YAG Lamp Shots': '350',
    },
    'Apogee Elite MPX',
    'Cynosure Apogee Elite MPX'
  );
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
  assert.equal(byLabel['BBL Handpiece Shots'], '1200');
  assert.equal(byLabel['Alexandrite Lamp Shots'], '400');
  assert.equal(byLabel['Nd:YAG Lamp Shots'], '350');
  assert.equal(byLabel['Alex Pump Chamber Shots'], '—');
  assert.equal(byLabel['YAG Pump Chamber Shots'], '—');
  assert.equal(byLabel['Handpiece Shots'], undefined);

  const eliteRows = systemParameterRows(
    { 'Handpiece Shots': '5' },
    'Cynosure Apogee Elite',
    'Cynosure Apogee Elite'
  );
  assert.equal(eliteRows.find((row) => row.key === 'Handpiece Shots')?.label, 'Handpiece Shots');
});

test('old measurement rows still render and new rows show result plus error', () => {
  const legacy = hydrateMeasurement({
    wavelength: '2100 nm',
    set: 20,
    actual: 18,
    unit: 'W',
    result: 'PASS',
    deviation: '-10.0%',
  });
  assert.equal(isFluenceMeasurement(legacy), false);
  const legacyView = viewMeasurement(legacy);
  assert.equal(legacyView.legacy, true);
  assert.equal(legacyView.wavelength, '2100 nm');
  assert.equal(legacyView.spot, '—');
  assert.equal(legacyView.set, '20 W');
  assert.equal(legacyView.measured, '18');
  assert.equal(legacyView.result, 'PASS');
  assert.equal(legacyView.error, '-10.0%');

  const fluence = newFluenceMeasurement({
    wavelength: '755 nm Alexandrite',
    spotSizeMm: '15',
    setFluence: 10,
    measuredMode: 'fluence',
    measuredValue: 8.4,
  });
  const fluenceView = viewMeasurement(fluence);
  assert.equal(fluenceView.result, '8.40 J/cm²');
  assert.equal(fluenceView.error, '-16.0%');
  assert.equal(fluenceView.pass, false);
  assert.equal(fluenceView.spot, '15 mm');
});

test('editing a row recalculates fluence and leaves a legacy row on set versus measured', () => {
  const fluence = applyMeasurementEdit(
    newFluenceMeasurement({
      wavelength: '755 nm Alexandrite',
      spotSizeMm: '10',
      setFluence: 10,
      measuredMode: 'fluence',
      measuredUnit: 'J',
    }),
    'measuredValue',
    '5',
    MODELS['Cynosure Apogee Elite MPX']
  );
  assert.equal(viewMeasurement(fluence).result, '6.37 J/cm²');

  const switched = applyMeasurementEdit(fluence, 'measuredUnit', 'J/cm²', MODELS['Cynosure Apogee Elite MPX']);
  const switchedAgain = applyMeasurementEdit(switched, 'measuredValue', '8.4', MODELS['Cynosure Apogee Elite MPX']);
  assert.equal(viewMeasurement(switchedAgain).error, '-16.0%');

  const legacy = applyMeasurementEdit(
    hydrateMeasurement({ wavelength: '2100 nm', setting: '20', measured: '', unit: 'W' }),
    'measured',
    '15'
  );
  assert.equal(isFluenceMeasurement(legacy), false);
  assert.equal(legacy.deviation, '-25.0%');
  assert.equal(legacy.pass, false);
});

test('print HTML shows MPX labels, pump shots, fluence result, and legacy rows', () => {
  const html = buildServiceReportPrintHTML({
    model_type: 'Cynosure Apogee Elite MPX',
    equipment_name: 'Cynosure Apogee Elite MPX',
    model_parameters: {
      'Handpiece Shots': '1200',
      'Alexandrite Lamp Shots': '400',
      'Nd:YAG Lamp Shots': '350',
      'Alex Pump Chamber Shots': '80',
      'YAG Pump Chamber Shots': '90',
    },
    power_measurements: [
      {
        wavelength: '2100 nm',
        setting: 20,
        measured: 18,
        unit: 'W',
        pass: true,
        deviation: '-10.0%',
      },
      newFluenceMeasurement({
        wavelength: '755 nm Alexandrite',
        spotSizeMm: '10',
        setFluence: 10,
        measuredMode: 'fluence',
        measuredUnit: 'J',
        measuredValue: 5,
      }),
    ],
  });
  assert.match(html, /BBL Handpiece Shots/);
  assert.match(html, /Alexandrite Lamp Shots/);
  assert.match(html, /Nd:YAG Lamp Shots/);
  assert.match(html, /Alex Pump Chamber Shots/);
  assert.match(html, /YAG Pump Chamber Shots/);
  assert.match(html, /1200/);
  assert.match(html, /80/);
  assert.match(html, /90/);
  assert.doesNotMatch(html, />Handpiece Shots</);
  assert.match(html, /2100 nm/);
  assert.match(html, /20 W/);
  assert.match(html, /6\.37 J\/cm²/);
  assert.match(html, /-36\.3%/);
  assert.match(html, /Error %/);
});

test("Larry's example: 10.3 J at 15 mm spot vs set 6 J/cm² → 5.83 J/cm², −2.9%, PASS", () => {
  let r = newFluenceMeasurement({ spotSizeMm: '15', setFluence: '6' });
  r = applyMeasurementEdit(r, 'readingKind', 'energy');
  assert.equal(r.measuredMode, 'fluence');
  assert.equal(r.measuredUnit, 'J');
  assert.equal(r.setUnit, 'J/cm²');
  r = applyMeasurementEdit(r, 'measuredValue', '10.3');
  assert.ok(Math.abs((circularSpotAreaCm2(15) as number) - 1.767) < 1e-3);
  const v = viewMeasurement(r);
  assert.equal(v.result, '5.83 J/cm²');
  assert.equal(v.error, '-2.9%');
  assert.equal(v.pass, true);
  assert.equal(v.readingKind, 'energy', 'energy chip, not fluence');
  assert.equal(v.testKind, 'fluence');
  assert.equal(v.tolerance, '±10%');
  assert.equal(v.measured, '10.30 J');
  assert.equal(v.spot, '15 mm');
  // mJ reading converts the same way
  const mj = viewMeasurement(applyMeasurementEdit(r, 'measuredUnit', 'mJ') && { ...r, measuredUnit: 'mJ', measuredValue: '10300' });
  assert.equal(mj.result, '5.83 J/cm²');
});

test('chip follows the reading unit; fluence chip only for J/cm² readings', () => {
  let r = newFluenceMeasurement({ spotSizeMm: '10', setFluence: '1' });
  assert.equal(viewMeasurement(r).readingKind, 'fluence');
  r = applyMeasurementEdit(r, 'measuredUnit', 'J');
  assert.equal(viewMeasurement(r).readingKind, 'energy');
  r = applyMeasurementEdit(r, 'readingKind', 'fluence');
  assert.equal(r.measuredUnit, 'J/cm²');
  assert.equal(viewMeasurement(r).readingKind, 'fluence');
  // energy reading with a J set value is a plain energy test
  r = applyMeasurementEdit(applyMeasurementEdit(r, 'readingKind', 'energy'), 'setUnit', 'J');
  assert.equal(r.measuredMode, 'energy');
  assert.equal(viewMeasurement(r).spot, '—');
  // and switching the set back to J/cm² makes it a fluence test read in J again
  r = applyMeasurementEdit(r, 'setUnit', 'J/cm²');
  assert.equal(r.measuredMode, 'fluence');
  assert.equal(r.measuredUnit, 'J');
});

test('wavelength shows the wavelength only; old @ spot values are stripped', async () => {
  const { wavelengthLabel, wavelengthOptionNames } = await import('./laser-pulse-modes.ts');
  assert.equal(wavelengthLabel('1064 nm @ 3mm spot'), '1064 nm');
  assert.equal(wavelengthLabel('1064 nm Nd:YAG @ 10mm'), '1064 nm Nd:YAG');
  assert.equal(wavelengthLabel('532 nm (SP)'), '532 nm (SP)');
  assert.deepEqual(wavelengthOptionNames(['1064 nm @ 3mm spot', '1064 nm @ 6mm spot']), ['1064 nm']);
  const old = { wavelength: '1064 nm @ 6mm spot', measuredMode: 'fluence', spotSizeMm: '6', setFluence: '10', measuredValue: '10' };
  assert.equal(viewMeasurement(old).wavelength, '1064 nm');
  assert.equal(hydrateMeasurement(old).wavelength, '1064 nm');
  assert.equal(viewMeasurement({ wavelength: '1064 nm @ 3mm spot', setting: '5', measured: '5', unit: 'W' }).wavelength, '1064 nm');
  const html = buildServiceReportPrintHTML({ power_measurements: [old] } as any);
  assert.doesNotMatch(html, /@ 6mm/);
  // picking a stripped wavelength still sets that channel's default spot
  const model = { wavelengths: [{ name: '1064 nm @ 12mm spot', spotMm: 12, unit: 'J/cm²', sets: [5] }] };
  const r = applyMeasurementEdit(newFluenceMeasurement(), 'wavelength', '1064 nm', model);
  assert.equal(r.wavelength, '1064 nm');
  assert.equal(r.spotSizeMm, '12');
});
