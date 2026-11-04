import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_PULSE_MODES,
  COMMON_WAVELENGTHS,
  configuredWavelengths,
  pulseModeDisplay,
  pulseModeOptions,
  wavelengthForNewRow,
} from './laser-pulse-modes.ts';
import {
  applyMeasurementEdit,
  hydrateMeasurement,
  newFluenceMeasurement,
  viewMeasurement,
} from './fluence-measurement.ts';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import { GAP_STRINGS } from './i18n/gap-copy.ts';

test('Lumenis / Coherent CO2 get CW, SuperPulse, UltraPulse, Other (case-insensitive)', () => {
  assert.deepEqual(pulseModeOptions('LUMENIS', 'UltraPulse Encore'), ['cw', 'superpulse', 'ultrapulse', 'other']);
  assert.deepEqual(pulseModeOptions('coherent', 'ultrapulse 5000c'), ['cw', 'superpulse', 'ultrapulse', 'other']);
  assert.deepEqual(pulseModeOptions('Lumenis', 'AcuPulse CO2'), ['cw', 'superpulse', 'ultrapulse', 'other']);
});

test('Laserscope / AMS Aura get CW, StarPulse, Other', () => {
  assert.deepEqual(pulseModeOptions('Laserscope', 'Aura XP'), ['cw', 'starpulse', 'other']);
  assert.deepEqual(pulseModeOptions('AMS', 'aura'), ['cw', 'starpulse', 'other']);
  assert.deepEqual(pulseModeOptions('American Medical Systems', 'GreenLight'), ['cw', 'starpulse', 'other']);
  assert.deepEqual(pulseModeOptions('', 'AURA KTP'), ['cw', 'starpulse', 'other']);
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
  row = applyMeasurementEdit(row, 'measuredMode', 'irradiance');
  row = applyMeasurementEdit(row, 'measuredUnit', 'W');
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

test('energy row compares J/mJ directly and ignores spot size', () => {
  let row = newFluenceMeasurement({ spotSizeMm: '10', setFluence: '1' });
  row = applyMeasurementEdit(row, 'measuredMode', 'energy');
  assert.equal(row.setUnit, 'J');
  row = applyMeasurementEdit(row, 'measuredUnit', 'mJ');
  row = applyMeasurementEdit(row, 'measuredValue', '950');
  assert.equal(row.errorPercent, '-5.0%');
  assert.equal(row.spotSizeMm, '10', 'saved spot is kept');
  const view = viewMeasurement(row);
  assert.equal(view.spot, '—', 'spot hidden for energy');
  assert.equal(view.result, '0.95 J');
  // changing the spot does not change the result
  const moved = applyMeasurementEdit(row, 'spotSizeMm', '3');
  assert.equal(moved.errorPercent, '-5.0%');
});

test('power row hides spot; fluence read in mJ uses spot', () => {
  let p = applyMeasurementEdit(newFluenceMeasurement({ spotSizeMm: '5' }), 'measuredMode', 'power');
  p = applyMeasurementEdit(applyMeasurementEdit(p, 'setFluence', '10'), 'measuredValue', '10');
  assert.equal(viewMeasurement(p).spot, '—');
  let f = newFluenceMeasurement({ spotSizeMm: '10', setFluence: '1' });
  f = applyMeasurementEdit(f, 'measuredUnit', 'mJ');
  f = applyMeasurementEdit(f, 'measuredValue', String(Math.PI * 0.25 * 1000));
  assert.equal(f.errorPercent, '0.0%');
  assert.equal(viewMeasurement(f).spot, '10 mm');
});

test('old energy rows (J vs J/cm², no setUnit) still read the same', () => {
  const old = { wavelength: 'x', measuredMode: 'energy', spotSizeMm: '10', setFluence: '1', measuredValue: String(Math.PI * 0.25) };
  const view = viewMeasurement(old);
  assert.equal(view.measured, `${(Math.PI * 0.25).toFixed(2)} J`);
  assert.equal(view.set, '1.00 J/cm²');
  assert.equal(view.spot, '10 mm');
  assert.equal(view.error, '0.0%');
  const h = hydrateMeasurement(old);
  assert.equal(h.measuredMode, 'fluence');
  assert.equal(h.measuredUnit, 'J');
  assert.equal(h.errorPercent, '0.0%');
});

test('configured wavelengths per laser', () => {
  assert.deepEqual(configuredWavelengths('Lumenis', 'UltraPulse Encore'), ['10600 nm']);
  assert.deepEqual(configuredWavelengths('COHERENT', 'UltraPulse 5000C'), ['10600 nm']);
  assert.deepEqual(configuredWavelengths('lumenis', 'SurgiTouch'), ['10600 nm']);
  assert.deepEqual(configuredWavelengths('Laserscope', 'Aura XP'), ['532 nm']);
  assert.deepEqual(configuredWavelengths('AMS', 'Aura'), ['532 nm']);
  assert.equal(configuredWavelengths('Candela', 'GentleMax'), null);
  assert.equal(configuredWavelengths('Lumenis', 'M22'), null);
  assert.ok(COMMON_WAVELENGTHS.includes('1064 nm'));
});

test('new row wavelength: previous row, else single configured, else fallback', () => {
  assert.equal(wavelengthForNewRow('755 nm', 'Lumenis', 'UltraPulse Encore'), '755 nm');
  assert.equal(wavelengthForNewRow('', 'Lumenis', 'UltraPulse Encore', '10600 nm CO₂ CW'), '10600 nm');
  assert.equal(wavelengthForNewRow(undefined, 'Laserscope', 'Aura XP'), '532 nm');
  assert.equal(wavelengthForNewRow(undefined, 'Candela', 'GentleMax', '755 nm Alexandrite'), '755 nm Alexandrite');
  assert.equal(wavelengthForNewRow(undefined, null, null), '');
});

test('saved off-list wavelength still displays', () => {
  const view = viewMeasurement({ wavelength: '11000 nm', measuredMode: 'power', setUnit: 'W', setFluence: '10', measuredValue: '10' });
  assert.equal(view.wavelength, '11000 nm');
  const html = buildServiceReportPrintHTML({ power_measurements: [{ wavelength: '11000 nm', measuredMode: 'power', setUnit: 'W', setFluence: '10', measuredValue: '10', spotSizeMm: '7' }] } as any);
  assert.match(html, /11000 nm/);
  assert.doesNotMatch(html, /7 mm/);
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
  for (const key of ['Power', 'Irradiance', 'Energy', 'Pulse mode', 'Set value', 'Measured unit', 'Set unit', 'Other pulse mode', 'Measurement type', 'None', 'Wavelength', 'Wavelength / channel', 'Spot size', 'Spot size is not used for Energy or Power', 'Measured energy', 'Computed fluence', 'Tolerance', 'Error', '— Wavelength —', '— Spot size —']) {
    const row = GAP_STRINGS[key];
    assert.ok(row, key);
    for (const loc of ['fa', 'es', 'fr', 'he', 'it', 'de', 'pt', 'ar'] as const) assert.ok(row[loc], `${key}/${loc}`);
  }
});

test('exactly ±10% passes both ways (inclusive, rounded to 0.1%)', () => {
  const mk = (mode: any, unit: string, set: string, meas: string) => {
    let r = applyMeasurementEdit(newFluenceMeasurement({ spotSizeMm: '10' }), 'measuredMode', mode);
    r = applyMeasurementEdit(r, 'setUnit', unit);
    r = applyMeasurementEdit(r, 'measuredUnit', unit);
    r = applyMeasurementEdit(r, 'setFluence', set);
    return applyMeasurementEdit(r, 'measuredValue', meas);
  };
  for (const [m, u, s, v, err] of [
    ['power', 'mW', '1000', '1100', '10.0%'],
    ['power', 'mW', '1000', '900', '-10.0%'],
    ['irradiance', 'mW/cm²', '2000', '2200', '10.0%'],
    ['irradiance', 'mW/cm²', '2000', '1800', '-10.0%'],
    ['energy', 'J', '1.1', '1.21', '10.0%'],
  ] as const) {
    const r = mk(m, u, s, v);
    assert.equal(r.errorPercent, err);
    assert.equal(r.pass, true, `${m} ${v}`);
  }
  assert.equal(mk('power', 'mW', '1000', '1101').pass, false);
  assert.equal(mk('power', 'mW', '1000', '899').pass, false);
});
