import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_PULSE_MODES, pulseModeDisplay, pulseModeOptions } from './laser-pulse-modes.ts';
import {
  applyMeasurementEdit,
  hydrateMeasurement,
  newFluenceMeasurement,
  viewMeasurement,
} from './fluence-measurement.ts';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import { GAP_STRINGS } from './i18n/gap-copy.ts';

test('Lumenis / Coherent CO2 get CW, SuperPulse, UltraPulse (case-insensitive)', () => {
  assert.deepEqual(pulseModeOptions('LUMENIS', 'UltraPulse Encore'), ['cw', 'superpulse', 'ultrapulse']);
  assert.deepEqual(pulseModeOptions('coherent', 'ultrapulse 5000c'), ['cw', 'superpulse', 'ultrapulse']);
  assert.deepEqual(pulseModeOptions('Lumenis', 'AcuPulse CO2'), ['cw', 'superpulse', 'ultrapulse']);
});

test('Laserscope / AMS Aura get CW, StarPulse', () => {
  assert.deepEqual(pulseModeOptions('Laserscope', 'Aura XP'), ['cw', 'starpulse']);
  assert.deepEqual(pulseModeOptions('AMS', 'aura'), ['cw', 'starpulse']);
  assert.deepEqual(pulseModeOptions('American Medical Systems', 'GreenLight'), ['cw', 'starpulse']);
  assert.deepEqual(pulseModeOptions('', 'AURA KTP'), ['cw', 'starpulse']);
});

test('unknown or blank make shows every mode plus Other', () => {
  assert.deepEqual(pulseModeOptions('Candela', 'GentleMax Pro'), [...ALL_PULSE_MODES]);
  assert.deepEqual(pulseModeOptions(null, null), ['cw', 'superpulse', 'ultrapulse', 'starpulse', 'other']);
  // "ams" must not match inside another word
  assert.deepEqual(pulseModeOptions('Adams Medical', 'X'), [...ALL_PULSE_MODES]);
  // Lumenis non-CO2 model has no rule
  assert.deepEqual(pulseModeOptions('Lumenis', 'M22'), [...ALL_PULSE_MODES]);
});

test('saved pulse mode displays even outside current options', () => {
  assert.equal(pulseModeDisplay({ pulseMode: 'starpulse' }), 'StarPulse');
  assert.equal(pulseModeDisplay({ pulseMode: 'other', pulseModeOther: 'Q-Switched' }), 'Q-Switched');
  assert.equal(pulseModeDisplay({ pulseMode: 'other' }), 'Other');
  assert.equal(pulseModeDisplay({ pulseMode: 'MegaPulse' }), 'MegaPulse');
  assert.equal(pulseModeDisplay({}), '');
});

test('power row: W set vs mW measured converts units', () => {
  let row = newFluenceMeasurement({ wavelength: '10600 nm' });
  row = applyMeasurementEdit(row, 'measuredMode', 'power');
  assert.equal(row.setUnit, 'W');
  assert.equal(row.measuredUnit, 'W');
  row = applyMeasurementEdit(row, 'setFluence', '10');
  row = applyMeasurementEdit(row, 'measuredUnit', 'mW');
  row = applyMeasurementEdit(row, 'measuredValue', '9500');
  assert.equal(row.errorPercent, '-5.0%');
  assert.equal(row.pass, true);
  assert.equal(row.unit, 'mW');
  const view = viewMeasurement(row);
  assert.equal(view.set, '10.00 W');
  assert.equal(view.measured, '9500.00 mW');
  assert.equal(view.result, '9.50 W');
});

test('irradiance row converts measured power through the spot area', () => {
  let row = newFluenceMeasurement({ spotSizeMm: '10' });
  row = applyMeasurementEdit(row, 'measuredMode', 'power');
  row = applyMeasurementEdit(row, 'setUnit', 'W/cm²');
  row = applyMeasurementEdit(row, 'setFluence', String(1 / (Math.PI * 0.25)));
  row = applyMeasurementEdit(row, 'measuredValue', '1');
  assert.equal(row.errorPercent, '0.0%');
  let irr = applyMeasurementEdit(newFluenceMeasurement(), 'measuredMode', 'irradiance');
  assert.equal(irr.setUnit, 'W/cm²');
  irr = applyMeasurementEdit(irr, 'measuredUnit', 'mW/cm²');
  irr = applyMeasurementEdit(irr, 'setFluence', '2');
  irr = applyMeasurementEdit(irr, 'measuredValue', '2400');
  assert.equal(irr.errorPercent, '20.0%');
  assert.equal(irr.pass, false);
});

test('energy in mJ converts to fluence; old rows unchanged', () => {
  let row = newFluenceMeasurement({ spotSizeMm: '10', setFluence: '1' });
  row = applyMeasurementEdit(row, 'measuredMode', 'energy');
  row = applyMeasurementEdit(row, 'measuredUnit', 'mJ');
  row = applyMeasurementEdit(row, 'measuredValue', String(Math.PI * 0.25 * 1000));
  assert.equal(row.errorPercent, '0.0%');
  const old = viewMeasurement({ wavelength: 'x', measuredMode: 'energy', spotSizeMm: '10', setFluence: '1', measuredValue: String(Math.PI * 0.25) });
  assert.equal(old.measured, `${(Math.PI * 0.25).toFixed(2)} J`);
  assert.equal(old.error, '0.0%');
  // switching back to pulsed resets set unit
  const back = applyMeasurementEdit(applyMeasurementEdit(newFluenceMeasurement(), 'measuredMode', 'power'), 'measuredMode', 'fluence');
  assert.equal(back.setUnit, 'J/cm²');
});

test('hydrate keeps pulse mode and units; print shows them', () => {
  const saved = { wavelength: '10600 nm', measuredMode: 'power', setUnit: 'W', measuredUnit: 'mW', setFluence: '10', measuredValue: '9800', pulseMode: 'superpulse' };
  const row = hydrateMeasurement(saved);
  assert.equal(row.pulseMode, 'superpulse');
  assert.equal(row.measuredUnit, 'mW');
  const legacy = hydrateMeasurement({ wavelength: 'a', setting: '5', measured: '5', unit: 'W', pulseMode: 'cw' });
  assert.equal(viewMeasurement(legacy).pulse, 'CW');
  const html = buildServiceReportPrintHTML({ power_measurements: [saved, { ...saved, pulseMode: 'other', pulseModeOther: 'Q-Switch' }] } as any);
  assert.match(html, /SuperPulse/);
  assert.match(html, /Q-Switch/);
  assert.match(html, /9800\.00 mW/);
  assert.match(html, /10\.00 W/);
});

test('new strings are translated for all locales', () => {
  for (const key of ['Power', 'Irradiance', 'Energy', 'Pulse mode', 'Set value', 'Measured unit', 'Set unit', 'Other pulse mode', 'Measurement type', 'None']) {
    const row = GAP_STRINGS[key];
    assert.ok(row, key);
    for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) assert.ok(row[loc], `${key}/${loc}`);
  }
});
