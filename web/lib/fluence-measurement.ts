/**
 * Fluence measurement math for service-report rows.
 *
 * Spot area is a circle. Diameter is entered in millimeters:
 *   radius (cm) = diameterMm / 20
 *   area (cm²)  = π × radius²
 *   fluence     = energy (J) / area
 *
 * Error % uses the same unit on both sides (J/cm²):
 *   (measuredFluence − setFluence) / setFluence × 100
 */

import { pulseModeDisplay } from './laser-pulse-modes.ts';

export const SPOT_SIZE_OTHER = 'other';

/** Sizes used when a model does not publish spot diameters. */
export const COMMON_SPOT_SIZES_MM = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 20, 22] as const;

/** Same ±10% band the performance row already used for pass/fail. */
export const FLUENCE_TOLERANCE_PERCENT = 10;

export type MeasuredQuantity = 'energy' | 'fluence' | 'power' | 'irradiance';

/** Measurement types offered on a row, in UI order. */
export const MEASURED_QUANTITIES: readonly MeasuredQuantity[] = ['energy', 'fluence', 'power', 'irradiance'];

/** Units each measurement type can be read in. The first is the default. */
export const QUANTITY_UNITS: Record<MeasuredQuantity, readonly string[]> = {
  energy: ['J', 'mJ'],
  fluence: ['J/cm²'],
  power: ['W', 'mW'],
  irradiance: ['W/cm²', 'mW/cm²'],
};

/** Set units: pulsed rows set fluence; CW rows set power or irradiance. */
export const PULSED_SET_UNITS = ['J/cm²'] as const;
export const CW_SET_UNITS = ['W', 'mW', 'W/cm²', 'mW/cm²'] as const;

const UNIT_INFO: Record<string, { kind: MeasuredQuantity; scale: number }> = {
  J: { kind: 'energy', scale: 1 },
  mJ: { kind: 'energy', scale: 1e-3 },
  'J/cm²': { kind: 'fluence', scale: 1 },
  W: { kind: 'power', scale: 1 },
  mW: { kind: 'power', scale: 1e-3 },
  'W/cm²': { kind: 'irradiance', scale: 1 },
  'mW/cm²': { kind: 'irradiance', scale: 1e-3 },
};

export function normalizeMode(value: unknown): MeasuredQuantity {
  return MEASURED_QUANTITIES.includes(value as MeasuredQuantity) ? (value as MeasuredQuantity) : 'fluence';
}

export function isCwMode(mode: MeasuredQuantity): boolean {
  return mode === 'power' || mode === 'irradiance';
}

/** Unit the meter reading is in; falls back to the type's default (old rows had none). */
export function measuredUnitFor(mode: MeasuredQuantity, unit: unknown): string {
  const units = QUANTITY_UNITS[mode];
  return units.includes(String(unit)) ? String(unit) : units[0];
}

/** Unit the set value is in. Pulsed rows are always J/cm² (old rows). */
export function setUnitFor(mode: MeasuredQuantity, unit: unknown): string {
  if (!isCwMode(mode)) return 'J/cm²';
  if ((CW_SET_UNITS as readonly string[]).includes(String(unit))) return String(unit);
  return mode === 'irradiance' ? 'W/cm²' : 'W';
}

function areal(kind: MeasuredQuantity) {
  return kind === 'fluence' || kind === 'irradiance';
}
function family(kind: MeasuredQuantity) {
  return isCwMode(kind) ? 'cw' : 'pulsed';
}

/**
 * Convert a measured value to the set value's unit so error % compares like with like.
 * Energy↔fluence and power↔irradiance convert through the circular spot area.
 */
export function convertToUnit(
  value: number,
  fromUnit: string,
  toUnit: string,
  spotDiameterMm: number | null,
): number | null {
  const from = UNIT_INFO[fromUnit];
  const to = UNIT_INFO[toUnit];
  if (!from || !to || !Number.isFinite(value)) return null;
  if (family(from.kind) !== family(to.kind)) return null;
  let base = value * from.scale;
  if (areal(from.kind) !== areal(to.kind)) {
    const area = spotDiameterMm == null ? null : circularSpotAreaCm2(spotDiameterMm);
    if (area == null || area === 0) return null;
    base = areal(to.kind) ? base / area : base * area;
  }
  return base / to.scale;
}

export function formatValue(value: number, unit: string): string {
  return `${formatFluence(value)} ${unit}`;
}

export type SpotModel = {
  wavelengths?: { name?: string; spotMm?: number; unit?: string; sets?: number[] }[];
} | null | undefined;

export type FluenceMeasurement = {
  wavelength: string;
  setting: string;
  measured: string;
  unit: string;
  pass: boolean | null;
  deviation: string;
  result: string;
  spotSizeMm: string;
  spotSizeOtherMm: string;
  setFluence: string;
  measuredMode: MeasuredQuantity;
  /** Unit of the meter reading (J, mJ, J/cm², W, mW, W/cm², mW/cm²). */
  measuredUnit: string;
  /** Unit of the set value: J/cm² for pulsed rows; W, mW, W/cm² or mW/cm² for CW rows. */
  setUnit: string;
  measuredValue: string;
  /** Measured value converted to setUnit (name kept for saved-row compatibility). */
  resultFluence: string;
  errorPercent: string;
};

export function pulseModeLabel(row: any, tr: (text: string) => string = (t) => t): string {
  return pulseModeDisplay(row, tr);
}

export type MeasurementView = {
  legacy: boolean;
  /** Pulse mode text ('' when not recorded). */
  pulse: string;
  wavelength: string;
  spot: string;
  set: string;
  measured: string;
  result: string;
  error: string;
  pass: boolean | null;
};

export function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Circular spot area in cm² from a diameter in mm. */
export function circularSpotAreaCm2(diameterMm: number): number | null {
  if (!Number.isFinite(diameterMm) || diameterMm <= 0) return null;
  const radiusCm = diameterMm / 20;
  return Math.PI * radiusCm * radiusCm;
}

/** Joules ÷ circular spot area → J/cm². */
export function fluenceFromEnergyJ(energyJ: number, diameterMm: number): number | null {
  if (!Number.isFinite(energyJ)) return null;
  const area = circularSpotAreaCm2(diameterMm);
  if (area == null || area === 0) return null;
  return energyJ / area;
}

/** (measured − set) / set × 100. Both inputs must already share a unit. */
export function errorPercent(measured: number, set: number): number | null {
  if (!Number.isFinite(measured) || !Number.isFinite(set) || set === 0) return null;
  return ((measured - set) / set) * 100;
}

export function formatFluence(value: number): string {
  return value.toFixed(2);
}

export function formatErrorPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDiameterMm(mm: number): string {
  if (Number.isInteger(mm)) return String(mm);
  return mm.toFixed(2).replace(/\.?0+$/, '');
}

export function knownSpotSizesMm(model: SpotModel): number[] {
  const sizes = new Set<number>();
  for (const wavelength of model?.wavelengths || []) {
    const spot = wavelength?.spotMm;
    if (typeof spot === 'number' && Number.isFinite(spot) && spot > 0) sizes.add(spot);
  }
  return [...sizes].sort((a, b) => a - b);
}

/** Model spot sizes when any are known; otherwise the common list. "Other" is added in the UI. */
export function spotSizeChoicesMm(model: SpotModel): number[] {
  const known = knownSpotSizesMm(model);
  return known.length ? known : [...COMMON_SPOT_SIZES_MM];
}

export function defaultSpotChoice(model: SpotModel, wavelengthName?: string | null): string {
  const choices = spotSizeChoicesMm(model);
  const wavelength = model?.wavelengths?.find((item) => item.name === wavelengthName);
  if (wavelength?.spotMm && choices.includes(wavelength.spotMm)) return String(wavelength.spotMm);
  return choices.length ? String(choices[0]) : SPOT_SIZE_OTHER;
}

export function effectiveSpotDiameterMm(
  row: { spotSizeMm?: unknown; spotSizeOtherMm?: unknown } | null | undefined
): number | null {
  if (!row) return null;
  if (String(row.spotSizeMm) === SPOT_SIZE_OTHER) {
    const custom = parseNum(row.spotSizeOtherMm);
    return custom != null && custom > 0 ? custom : null;
  }
  const listed = parseNum(row.spotSizeMm);
  return listed != null && listed > 0 ? listed : null;
}

export function measurementResult(input: {
  setFluence: number;
  measured: number;
  measuredAs: MeasuredQuantity;
  spotDiameterMm: number | null;
  measuredUnit?: string;
  setUnit?: string;
}): { resultFluence: number | null; errorPercent: number | null } {
  if (input.measuredUnit || input.setUnit || isCwMode(input.measuredAs)) {
    const measuredUnit = measuredUnitFor(input.measuredAs, input.measuredUnit);
    const setUnit = setUnitFor(input.measuredAs, input.setUnit);
    const result = convertToUnit(input.measured, measuredUnit, setUnit, input.spotDiameterMm);
    return {
      resultFluence: result,
      errorPercent: result == null ? null : errorPercent(result, input.setFluence),
    };
  }
  const resultFluence =
    input.measuredAs === 'energy'
      ? input.spotDiameterMm == null
        ? null
        : fluenceFromEnergyJ(input.measured, input.spotDiameterMm)
      : Number.isFinite(input.measured)
        ? input.measured
        : null;
  return {
    resultFluence,
    errorPercent: resultFluence == null ? null : errorPercent(resultFluence, input.setFluence),
  };
}

export function isFluenceMeasurement(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  if (MEASURED_QUANTITIES.includes(row.measuredMode)) return true;
  if (MEASURED_QUANTITIES.includes(row.measured_mode)) return true;
  if (row.setFluence != null && String(row.setFluence) !== '') return true;
  if (row.set_fluence != null && String(row.set_fluence) !== '') return true;
  if (row.spotSizeMm != null && String(row.spotSizeMm) !== '') return true;
  if (row.spot_size_mm != null && String(row.spot_size_mm) !== '') return true;
  if (row.measuredValue != null && String(row.measuredValue) !== '') return true;
  if (row.measured_value != null && String(row.measured_value) !== '') return true;
  return false;
}

export function withFluenceCalculations<T extends Record<string, any>>(row: T): T & FluenceMeasurement {
  const measuredMode = normalizeMode(row.measuredMode);
  const measuredUnit = measuredUnitFor(measuredMode, row.measuredUnit);
  const setUnit = setUnitFor(measuredMode, row.setUnit);
  const computed = measurementResult({
    setFluence: parseNum(row.setFluence) ?? Number.NaN,
    measured: parseNum(row.measuredValue) ?? Number.NaN,
    measuredAs: measuredMode,
    spotDiameterMm: effectiveSpotDiameterMm(row),
    measuredUnit,
    setUnit,
  });
  const error = computed.errorPercent == null ? '' : formatErrorPercent(computed.errorPercent);
  const pass =
    computed.errorPercent == null ? null : Math.abs(computed.errorPercent) <= FLUENCE_TOLERANCE_PERCENT;
  return {
    ...row,
    wavelength: row.wavelength || '',
    spotSizeMm: row.spotSizeMm == null ? '' : String(row.spotSizeMm),
    spotSizeOtherMm: row.spotSizeOtherMm == null ? '' : String(row.spotSizeOtherMm),
    setFluence: row.setFluence == null ? '' : String(row.setFluence),
    measuredMode,
    measuredUnit,
    setUnit,
    measuredValue: row.measuredValue == null ? '' : String(row.measuredValue),
    resultFluence: computed.resultFluence == null ? '' : formatFluence(computed.resultFluence),
    errorPercent: error,
    deviation: error,
    pass,
    result: pass == null ? '' : pass ? 'PASS' : 'FAIL',
    setting: row.setFluence == null ? row.setting ?? '' : String(row.setFluence),
    measured: row.measuredValue == null ? row.measured ?? '' : String(row.measuredValue),
    unit: measuredUnit,
  };
}

const FLUENCE_EDIT_KEYS = ['setFluence', 'measuredValue', 'measuredMode', 'measuredUnit', 'setUnit', 'spotSizeMm', 'spotSizeOtherMm'];

/** Apply one field edit and recompute fluence rows. Legacy rows keep set / measured / unit. */
export function applyMeasurementEdit(row: any, key: string, value: any, model?: SpotModel): any {
  const prevRow = row || {};
  const next: any = { ...prevRow, [key]: value };
  if (key === 'measuredMode') {
    const mode = normalizeMode(value);
    next.measuredMode = mode;
    next.measuredUnit = measuredUnitFor(mode, prevRow.measuredUnit);
    const prevMode = normalizeMode(prevRow.measuredMode);
    next.setUnit =
      isCwMode(mode) && isCwMode(prevMode)
        ? setUnitFor(mode, prevRow.setUnit)
        : setUnitFor(mode, undefined);
  }
  if (key === 'wavelength' && (isFluenceMeasurement(next) || isFluenceMeasurement(prevRow))) {
    const prevWl = model?.wavelengths?.find((item) => item.name === prevRow.wavelength);
    const nextWl = model?.wavelengths?.find((item) => item.name === value);
    const prevDefault = prevWl?.spotMm != null ? String(prevWl.spotMm) : '';
    const untouched = !prevRow.spotSizeMm || String(prevRow.spotSizeMm) === prevDefault;
    if (untouched && nextWl?.spotMm) next.spotSizeMm = String(nextWl.spotMm);
    if (
      nextWl?.unit === 'J/cm²' &&
      (next.setFluence == null || next.setFluence === '') &&
      nextWl.sets?.[0] != null
    ) {
      next.setFluence = String(nextWl.sets[0]);
    }
  }
  if (isFluenceMeasurement(next) || FLUENCE_EDIT_KEYS.includes(key)) {
    if (!next.measuredMode) next.measuredMode = 'fluence';
    return withFluenceCalculations(next);
  }
  if (key === 'measured' || key === 'setting') {
    const setVal = parseFloat(next.setting);
    const meas = parseFloat(next.measured);
    if (!Number.isNaN(setVal) && !Number.isNaN(meas) && setVal) {
      const dev = ((meas - setVal) / setVal) * 100;
      next.deviation = `${dev.toFixed(1)}%`;
      next.pass = Math.abs(dev) <= FLUENCE_TOLERANCE_PERCENT;
    }
  }
  return next;
}

export function newFluenceMeasurement(opts?: {
  wavelength?: string;
  spotSizeMm?: string;
  setFluence?: string | number;
  measuredMode?: MeasuredQuantity;
  measuredValue?: string | number;
}): FluenceMeasurement {
  return withFluenceCalculations({
    wavelength: opts?.wavelength || '',
    setting: '',
    measured: '',
    unit: 'J/cm²',
    pass: null,
    deviation: '',
    result: '',
    spotSizeMm: opts?.spotSizeMm ?? '',
    spotSizeOtherMm: '',
    setFluence: opts?.setFluence == null ? '' : String(opts.setFluence),
    measuredMode: opts?.measuredMode || 'fluence',
    measuredUnit: '',
    setUnit: '',
    measuredValue: opts?.measuredValue == null ? '' : String(opts.measuredValue),
    resultFluence: '',
    errorPercent: '',
  });
}

export function seedMeasurementForWavelength(
  model: SpotModel,
  wavelength: { name?: string; unit?: string; sets?: number[]; spotMm?: number }
) {
  if (wavelength.unit === 'J/cm²') {
    return newFluenceMeasurement({
      wavelength: wavelength.name || '',
      spotSizeMm: defaultSpotChoice(
        model || { wavelengths: [wavelength] },
        wavelength.name
      ),
      setFluence: wavelength.sets?.[0] != null ? String(wavelength.sets[0]) : '',
      measuredMode: 'fluence',
    });
  }
  return {
    wavelength: wavelength.name || '',
    setting: wavelength.sets?.[0] != null ? String(wavelength.sets[0]) : '',
    measured: '',
    unit: wavelength.unit || 'W',
    pass: true as boolean | null,
    deviation: '',
  };
}

/** Restore a saved row. Rows without fluence fields stay on the old set/measured/unit shape. */
export function hydrateMeasurement(pm: any) {
  if (!pm || typeof pm !== 'object') return pm;
  if (!isFluenceMeasurement(pm)) {
    return {
      wavelength: pm.wavelength || pm.name || '',
      setting: pm.setting ?? pm.set ?? '',
      measured: pm.measured ?? pm.actual ?? '',
      unit: pm.unit || 'W',
      pass:
        pm.pass === true || pm.result === 'PASS' || pm.result === 'Pass'
          ? true
          : pm.pass === false || pm.result === 'FAIL' || pm.result === 'Fail'
            ? false
            : null,
      deviation: pm.deviation || pm.dev || '',
      pulseMode: String(pm.pulseMode ?? pm.pulse_mode ?? ''),
      pulseModeOther: String(pm.pulseModeOther ?? pm.pulse_mode_other ?? ''),
    };
  }
  const measuredMode = normalizeMode(pm.measuredMode ?? pm.measured_mode);
  const measuredValue = pm.measuredValue ?? pm.measured_value ?? pm.measured ?? pm.actual ?? '';
  return withFluenceCalculations({
    wavelength: pm.wavelength || pm.name || '',
    setting: pm.setting ?? pm.set ?? '',
    measured: pm.measured ?? pm.actual ?? '',
    unit: pm.unit || 'J/cm²',
    pass: null,
    deviation: pm.deviation || '',
    result: pm.result || '',
    spotSizeMm: String(pm.spotSizeMm ?? pm.spot_size_mm ?? ''),
    spotSizeOtherMm: String(pm.spotSizeOtherMm ?? pm.spot_size_other_mm ?? ''),
    setFluence: String(pm.setFluence ?? pm.set_fluence ?? ''),
    measuredMode,
    pulseMode: String(pm.pulseMode ?? pm.pulse_mode ?? ''),
    pulseModeOther: String(pm.pulseModeOther ?? pm.pulse_mode_other ?? ''),
    measuredUnit: String(pm.measuredUnit ?? pm.measured_unit ?? ''),
    setUnit: String(pm.setUnit ?? pm.set_unit ?? ''),
    measuredValue: measuredValue == null ? '' : String(measuredValue),
    resultFluence: '',
    errorPercent: '',
  });
}

function passOf(row: any): boolean | null {
  if (row?.pass === true || row?.result === 'PASS' || String(row?.result || '').toUpperCase() === 'PASS') {
    return true;
  }
  if (row?.pass === false || row?.result === 'FAIL' || String(row?.result || '').toUpperCase() === 'FAIL') {
    return false;
  }
  return null;
}

export function viewMeasurement(row: any): MeasurementView {
  const wavelength = String(row?.wavelength || row?.name || '—') || '—';
  if (!isFluenceMeasurement(row)) {
    const set = row?.set ?? row?.setting ?? '—';
    const unit = row?.unit ? ` ${row.unit}` : '';
    const actual = row?.actual ?? row?.measured;
    const pass = passOf(row);
    const deviation = row?.deviation ?? row?.dev ?? '';
    return {
      legacy: true,
      pulse: pulseModeLabel(row),
      wavelength,
      spot: '—',
      set: `${set == null || set === '' ? '—' : set}${set == null || set === '' ? '' : unit}`.trim(),
      measured: actual == null || actual === '' ? '—' : String(actual),
      result: pass === true ? 'PASS' : pass === false ? 'FAIL' : deviation ? String(deviation) : '—',
      error: deviation ? String(deviation) : '—',
      pass,
    };
  }
  const mode = normalizeMode(row.measuredMode ?? row.measured_mode);
  const measuredUnit = measuredUnitFor(mode, row.measuredUnit ?? row.measured_unit);
  const setUnit = setUnitFor(mode, row.setUnit ?? row.set_unit);
  const diameter = effectiveSpotDiameterMm({
    spotSizeMm: row.spotSizeMm ?? row.spot_size_mm,
    spotSizeOtherMm: row.spotSizeOtherMm ?? row.spot_size_other_mm,
  });
  const setFluence = parseNum(row.setFluence ?? row.set_fluence);
  const measuredRaw = parseNum(row.measuredValue ?? row.measured_value ?? row.measured ?? row.actual);
  const computed = measurementResult({
    setFluence: setFluence ?? Number.NaN,
    measured: measuredRaw ?? Number.NaN,
    measuredAs: mode,
    spotDiameterMm: diameter,
    measuredUnit,
    setUnit,
  });
  const pass =
    computed.errorPercent == null ? null : Math.abs(computed.errorPercent) <= FLUENCE_TOLERANCE_PERCENT;
  return {
    legacy: false,
    pulse: pulseModeLabel(row),
    wavelength,
    spot: diameter == null ? '—' : `${formatDiameterMm(diameter)} mm`,
    set: setFluence == null ? '—' : formatValue(setFluence, setUnit),
    measured: measuredRaw == null ? '—' : formatValue(measuredRaw, measuredUnit),
    result: computed.resultFluence == null ? '—' : formatValue(computed.resultFluence, setUnit),
    error: computed.errorPercent == null ? '—' : formatErrorPercent(computed.errorPercent),
    pass,
  };
}
