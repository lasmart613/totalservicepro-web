'use client';

import React from 'react';
import { useT } from '@/lib/fa/locale';
import {
  COMMON_WAVELENGTHS,
  configuredWavelengths,
  PULSE_MODE_LABELS,
  pulseModeDisplay,
  pulseModeOptions,
} from '@/lib/laser-pulse-modes';
import {
  measuredUnitFor,
  MEASURED_QUANTITIES,
  MEASURED_UNITS,
  SET_UNITS,
  setUnitFor,
  usesSpot,
  type MeasuredQuantity,
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
  make,
  model,
  onAdd,
  onRemove,
  onChange,
}: {
  rows: any[];
  wavelengths?: WavelengthOption[] | null;
  spotSizes: number[];
  make?: string | null;
  model?: string | null;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  const pulseOptions = pulseModeOptions(make, model);
  const configured = configuredWavelengths(make, model);
  const wlOptions: WavelengthOption[] | null | undefined = configured
    ? configured.map((name) => ({ name }))
    : wavelengths;
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
              wavelengths={wlOptions}
              spotSizes={spotSizes}
              pulseOptions={pulseOptions}
              onRemove={onRemove}
              onChange={onChange}
            />
          ) : (
            <LegacyRow
              key={i}
              row={row}
              index={i}
              wavelengths={wlOptions}
              pulseOptions={pulseOptions}
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
  pulseOptions,
  onRemove,
  onChange,
}: {
  row: any;
  index: number;
  wavelengths?: WavelengthOption[] | null;
  spotSizes: number[];
  pulseOptions: string[];
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  const view = viewMeasurement(row);
  const spotValue = row.spotSizeMm == null ? '' : String(row.spotSizeMm);
  const knownSpot = spotSizes.some((size) => String(size) === spotValue);
  const t = useT();
  const mode: MeasuredQuantity = MEASURED_QUANTITIES.includes(row.measuredMode) ? row.measuredMode : 'fluence';
  const measuredUnit = measuredUnitFor(mode, row.measuredUnit);
  const setUnit = setUnitFor(mode, row.setUnit);
  const modeLabel = (q: MeasuredQuantity) =>
    `${t(QUANTITY_LABELS[q])} (${SET_UNITS[q].join(', ')})`;
  const spotOn = usesSpot(mode);
  const passClass =
    view.pass === false ? 'text-red-400' : view.pass ? 'text-green-400' : 'text-[var(--text3)]';

  return (
    <div
      className="mb-3 rounded-lg border border-[var(--border)] p-3"
      data-testid="fluence-measurement-row"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
        <label className="text-xs text-[var(--text3)]">
          {t('Wavelength')}
          <WavelengthField
            row={row}
            wavelengths={wavelengths}
            onChange={(value) => onChange(index, 'wavelength', value)}
          />
        </label>
        <label className={`text-xs text-[var(--text3)] ${spotOn ? '' : 'opacity-50'}`}>
          {t('Spot size')}
          <select
            className="input mt-1"
            aria-label={t('Spot size')}
            data-testid="spot-size"
            disabled={!spotOn}
            aria-disabled={!spotOn}
            title={spotOn ? undefined : t('Spot size is not used for Energy or Power')}
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
        {spotOn && spotValue === SPOT_SIZE_OTHER && (
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
          {`${t('Set value')} (${SET_UNITS[mode].join(', ')})`}
          <div className="flex gap-1 mt-1">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              aria-label={`${t('Set value')} (${setUnit})`}
              data-testid="set-fluence"
              placeholder={setUnit}
              value={row.setFluence ?? ''}
              onChange={(e) => onChange(index, 'setFluence', e.target.value)}
            />
            {SET_UNITS[mode].length > 1 && (
              <select
                className="input w-28"
                aria-label={t('Set unit')}
                data-testid="set-unit"
                value={setUnit}
                onChange={(e) => onChange(index, 'setUnit', e.target.value)}
              >
                {SET_UNITS[mode].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </div>
        </label>
        <div>
          <div className="text-xs text-[var(--text3)] mb-1">{t('Actual / measured')}</div>
          <div className="flex flex-wrap gap-1 mb-1" role="group" aria-label={t('Measurement type')}>
            {MEASURED_QUANTITIES.map((q) => (
              <button
                key={q}
                type="button"
                className={modeButton(mode === q)}
                aria-pressed={mode === q}
                data-testid={`measured-mode-${q}`}
                onClick={() => onChange(index, 'measuredMode', q)}
              >
                {modeLabel(q)}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              step="any"
              aria-label={`${t('Measured')} ${t(QUANTITY_LABELS[mode])} (${measuredUnit})`}
              data-testid="measured-value"
              placeholder={`${t(QUANTITY_LABELS[mode])} (${measuredUnit})`}
              value={row.measuredValue ?? ''}
              onChange={(e) => onChange(index, 'measuredValue', e.target.value)}
            />
            {MEASURED_UNITS[mode].length > 1 && (
              <select
                className="input w-28"
                aria-label={t('Measured unit')}
                data-testid="measured-unit"
                value={measuredUnit}
                onChange={(e) => onChange(index, 'measuredUnit', e.target.value)}
              >
                {MEASURED_UNITS[mode].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
      <PulseModeField row={row} index={index} options={pulseOptions} onChange={onChange} />
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
  pulseOptions,
  onRemove,
  onChange,
}: {
  row: any;
  index: number;
  wavelengths?: WavelengthOption[] | null;
  pulseOptions: string[];
  onRemove: (index: number) => void;
  onChange: (index: number, key: string, value: string) => void;
}) {
  const view = viewMeasurement(row);
  return (
    <div className="mb-2">
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
      <PulseModeField row={row} index={index} options={pulseOptions} onChange={onChange} />
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
  const t = useT();
  if (wavelengths?.length) {
    return (
      <select
        className="input mt-1"
        aria-label={t('Wavelength')}
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
    <>
      <input
        className="input mt-1"
        placeholder={t('Wavelength / channel')}
        aria-label={t('Wavelength')}
        list="sr-common-wavelengths"
        value={row.wavelength || ''}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="sr-common-wavelengths">
        {COMMON_WAVELENGTHS.map((wl) => (
          <option key={wl} value={wl} />
        ))}
      </datalist>
    </>
  );
}

function modeButton(active: boolean): string {
  return active
    ? 'px-2 py-1 text-xs rounded border border-[var(--gold)] text-[var(--gold)] bg-[var(--surface)]'
    : 'px-2 py-1 text-xs rounded border border-[var(--border)] text-[var(--text3)]';
}

const QUANTITY_LABELS: Record<MeasuredQuantity, string> = {
  energy: 'Energy',
  fluence: 'Fluence',
  power: 'Power',
  irradiance: 'Irradiance',
};

/** Radio buttons for the row's pulse mode. Options come from lib/laser-pulse-modes.ts. */
function PulseModeField({
  row,
  index,
  options,
  onChange,
}: {
  row: any;
  index: number;
  options: string[];
  onChange: (index: number, key: string, value: string) => void;
}) {
  const t = useT();
  const current = String(row?.pulseMode || '');
  const name = `pulse-mode-${index}`;
  const savedOutside = current && !options.includes(current);
  const radio = (value: string, label: string) => (
    <label key={value || 'none'} className="inline-flex items-center gap-1 text-xs">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        data-testid={`pulse-mode-${value || 'none'}`}
        onChange={() => onChange(index, 'pulseMode', value)}
      />
      {label}
    </label>
  );
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="radiogroup" aria-label={t('Pulse mode')} data-testid="pulse-mode">
      <span className="text-xs text-[var(--text3)]">{t('Pulse mode')}:</span>
      {radio('', t('None'))}
      {options.map((key) => radio(key, key === 'other' ? t('Other') : PULSE_MODE_LABELS[key] || key))}
      {savedOutside && radio(current, pulseModeDisplay(row, t))}
      {current === 'other' && (
        <input
          className="input h-7 w-40 text-xs"
          aria-label={t('Other pulse mode')}
          data-testid="pulse-mode-other"
          placeholder={t('Other pulse mode')}
          value={row.pulseModeOther || ''}
          onChange={(e) => onChange(index, 'pulseModeOther', e.target.value)}
        />
      )}
    </div>
  );
}
