'use client';

import React from 'react';
import {
  isFluenceMeasurement,
  SPOT_SIZE_OTHER,
  viewMeasurement,
} from '@/lib/fluence-measurement';

const PERF_UNITS = [
  'J/cm²',
  'W/cm²',
  'mW/cm²',
  'J',
  'mJ',
  'µJ',
  'mJ/spot',
  'W',
  'mW',
  '%',
] as const;

type WavelengthOption = { name: string };

export function PerformanceMeasurements({
  rows,
  wavelengths,
  spotSizes,
  onAdd,
  onRemove,
  onChange,
}: {
  rows: any[];
  wavelengths?: WavelengthOption[] | null;
  spotSizes: number[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  return (
    <div className="section mb-6">
      <div className="section-hdr">
        <h3>📊 Performance Testing</h3>
      </div>
      <div className="section-body p-4">
        <p className="text-[10px] text-[var(--text3)] mb-2">
          {wavelengths?.length
            ? 'Wavelengths for this model are in the dropdown. Spot size uses this model’s sizes when they are known.'
            : 'No OEM wavelength table for this model — enter the channel, then the spot size and fluence.'}{' '}
          Set fluence is J/cm². The meter reading can be energy (J) or fluence (J/cm²). Energy is converted with the circular spot area, then error % is (measured − set) / set × 100.
        </p>
        <button type="button" onClick={onAdd} className="btn btn-secondary text-sm mb-3">
          + Add Measurement Row
        </button>
        {rows.length === 0 && (
          <div className="text-sm text-[var(--text3)] mb-2">No measurements yet. Add a row to record set vs actual.</div>
        )}
        {rows.map((row, i) =>
          isFluenceMeasurement(row) ? (
            <FluenceRow
              key={i}
              row={row}
              index={i}
              wavelengths={wavelengths}
              spotSizes={spotSizes}
              onRemove={onRemove}
              onChange={onChange}
            />
          ) : (
            <LegacyRow
              key={i}
              row={row}
              index={i}
              wavelengths={wavelengths}
              onRemove={onRemove}
              onChange={onChange}
            />
          )
        )}
      </div>
    </div>
  );
}

function FluenceRow({
  row,
  index,
  wavelengths,
  spotSizes,
  onRemove,
  onChange,
}: {
  row: any;
  index: number;
  wavelengths?: WavelengthOption[] | null;
  spotSizes: number[];
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  const view = viewMeasurement(row);
  const spotValue = row.spotSizeMm == null ? '' : String(row.spotSizeMm);
  const knownSpot = spotSizes.some((size) => String(size) === spotValue);
  const mode = row.measuredMode === 'energy' ? 'energy' : 'fluence';
  const passClass =
    view.pass === false ? 'text-red-400' : view.pass ? 'text-green-400' : 'text-[var(--text3)]';

  return (
    <div
      className="mb-3 rounded-lg border border-[var(--border)] p-3"
      data-testid="fluence-measurement-row"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
        <label className="text-xs text-[var(--text3)]">
          Wavelength
          <WavelengthField
            row={row}
            wavelengths={wavelengths}
            onChange={(value) => onChange(index, 'wavelength', value)}
          />
        </label>
        <label className="text-xs text-[var(--text3)]">
          Spot size
          <select
            className="input mt-1"
            aria-label="Spot size"
            data-testid="spot-size"
            value={spotValue}
            onChange={(e) => onChange(index, 'spotSizeMm', e.target.value)}
          >
            <option value="">— Spot size —</option>
            {spotSizes.map((size) => (
              <option key={size} value={String(size)}>
                {size} mm
              </option>
            ))}
            {spotValue && spotValue !== SPOT_SIZE_OTHER && !knownSpot && (
              <option value={spotValue}>{spotValue} mm</option>
            )}
            <option value={SPOT_SIZE_OTHER}>Other</option>
          </select>
        </label>
        {spotValue === SPOT_SIZE_OTHER && (
          <label className="text-xs text-[var(--text3)]">
            Diameter (mm)
            <input
              className="input mt-1"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              aria-label="Other spot diameter (mm)"
              data-testid="spot-size-other"
              placeholder="mm"
              value={row.spotSizeOtherMm || ''}
              onChange={(e) => onChange(index, 'spotSizeOtherMm', e.target.value)}
            />
          </label>
        )}
        <label className="text-xs text-[var(--text3)]">
          Set fluence (J/cm²)
          <input
            className="input mt-1"
            type="number"
            inputMode="decimal"
            step="any"
            aria-label="Set fluence (J/cm²)"
            data-testid="set-fluence"
            placeholder="J/cm²"
            value={row.setFluence ?? ''}
            onChange={(e) => onChange(index, 'setFluence', e.target.value)}
          />
        </label>
        <div>
          <div className="text-xs text-[var(--text3)] mb-1">Actual / measured</div>
          <div className="flex gap-1 mb-1" role="group" aria-label="Measured quantity">
            <button
              type="button"
              className={modeButton(mode === 'energy')}
              aria-pressed={mode === 'energy'}
              data-testid="measured-mode-energy"
              onClick={() => onChange(index, 'measuredMode', 'energy')}
            >
              Energy (J)
            </button>
            <button
              type="button"
              className={modeButton(mode === 'fluence')}
              aria-pressed={mode === 'fluence'}
              data-testid="measured-mode-fluence"
              onClick={() => onChange(index, 'measuredMode', 'fluence')}
            >
              Fluence (J/cm²)
            </button>
          </div>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            step="any"
            aria-label={mode === 'energy' ? 'Measured energy (J)' : 'Measured fluence (J/cm²)'}
            data-testid="measured-value"
            placeholder={mode === 'energy' ? 'Energy (J)' : 'Fluence (J/cm²)'}
            value={row.measuredValue ?? ''}
            onChange={(e) => onChange(index, 'measuredValue', e.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span data-testid="measurement-result">
          Result: <span className="font-semibold">{view.result}</span>
        </span>
        <span className={`font-bold ${passClass}`} data-testid="measurement-error">
          Error: {view.error}
          {view.pass === true ? ' PASS' : view.pass === false ? ' FAIL' : ''}
        </span>
        <button type="button" onClick={() => onRemove(index)} className="text-red-400 text-xs ml-auto">
          × Remove
        </button>
      </div>
    </div>
  );
}

function LegacyRow({
  row,
  index,
  wavelengths,
  onRemove,
  onChange,
}: {
  row: any;
  index: number;
  wavelengths?: WavelengthOption[] | null;
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  const view = viewMeasurement(row);
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-2 items-center text-sm"
      data-testid="legacy-measurement-row"
    >
      <WavelengthField
        row={row}
        wavelengths={wavelengths}
        onChange={(value) => onChange(index, 'wavelength', value)}
      />
      <input
        className="input"
        placeholder="Set"
        aria-label="Set"
        value={row.setting ?? ''}
        onChange={(e) => onChange(index, 'setting', e.target.value)}
      />
      <input
        className="input"
        placeholder="Measured"
        aria-label="Measured"
        value={row.measured ?? ''}
        onChange={(e) => onChange(index, 'measured', e.target.value)}
      />
      <select
        className="input"
        value={
          PERF_UNITS.includes(row.unit as (typeof PERF_UNITS)[number]) ? row.unit : row.unit || 'J/cm²'
        }
        onChange={(e) => onChange(index, 'unit', e.target.value)}
        aria-label="Unit"
        title="Unit"
      >
        <option value="" disabled>
          Unit
        </option>
        {PERF_UNITS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
        {row.unit && !PERF_UNITS.includes(row.unit as (typeof PERF_UNITS)[number]) && (
          <option value={row.unit}>{row.unit}</option>
        )}
      </select>
      <div
        className={`text-xs font-bold ${row.pass === false ? 'text-red-400' : row.pass ? 'text-green-400' : 'text-[var(--text3)]'}`}
      >
        {view.error !== '—' ? view.error : row.deviation || '—'}{' '}
        {row.pass === true ? 'PASS' : row.pass === false ? 'FAIL' : ''}
      </div>
      <button type="button" onClick={() => onRemove(index)} className="text-red-400 text-xs">
        × Remove
      </button>
    </div>
  );
}

function WavelengthField({
  row,
  wavelengths,
  onChange,
}: {
  row: any;
  wavelengths?: WavelengthOption[] | null;
  onChange: (value: string) => void;
}) {
  if (wavelengths?.length) {
    return (
      <select
        className="input mt-1"
        aria-label="Wavelength"
        value={row.wavelength || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— Wavelength —</option>
        {wavelengths.map((wavelength) => (
          <option key={wavelength.name} value={wavelength.name}>
            {wavelength.name}
          </option>
        ))}
        {row.wavelength && !wavelengths.some((wavelength) => wavelength.name === row.wavelength) && (
          <option value={row.wavelength}>{row.wavelength}</option>
        )}
      </select>
    );
  }
  return (
    <input
      className="input mt-1"
      placeholder="Wavelength / channel"
      aria-label="Wavelength"
      value={row.wavelength || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function modeButton(active: boolean): string {
  return active
    ? 'px-2 py-1 text-xs rounded border border-[var(--gold)] text-[var(--gold)] bg-[var(--surface)]'
    : 'px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text3)]';
}
