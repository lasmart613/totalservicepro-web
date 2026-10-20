'use client';

import { EQUIPMENT_TYPES } from '@/lib/equipment-types';
import { OTHER_VALUE } from '@/lib/equipment-cascade';
import type { EquipmentCascade } from '@/lib/use-equipment-cascade';

type Props = {
  cascade: EquipmentCascade;
  t?: (key: string) => string;
  /** Hide the type select (type fixed by the page, e.g. My Lasers). */
  hideType?: boolean;
  labelClassName?: string;
  idPrefix?: string;
};

/** Shared Equipment type → Manufacturer → Model selects with Other + free text. */
export default function EquipmentCascadeFields({
  cascade,
  t = (k) => k,
  hideType = false,
  labelClassName = 'text-xs text-[var(--text3)]',
  idPrefix = 'eq',
}: Props) {
  const { state } = cascade;
  return (
    <>
      {!hideType && (
        <div>
          <label className={labelClassName} htmlFor={`${idPrefix}-type`}>
            {t('Equipment type')}
          </label>
          <select
            id={`${idPrefix}-type`}
            data-testid="cascade-type"
            className="input select mt-1"
            value={state.equipmentType}
            onChange={(e) => cascade.setEquipmentType(e.target.value)}
          >
            {EQUIPMENT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={labelClassName} htmlFor={`${idPrefix}-mfr`}>
          {t('Manufacturer')}
        </label>
        <select
          id={`${idPrefix}-mfr`}
          data-testid="cascade-manufacturer"
          className="input select mt-1"
          value={state.manufacturer}
          onChange={(e) => cascade.setManufacturer(e.target.value)}
        >
          <option value="">{t('— Select —')}</option>
          {cascade.manufacturerChoices.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          <option value={OTHER_VALUE}>{t('Other / custom…')}</option>
        </select>
        {state.manufacturer === OTHER_VALUE && (
          <input
            className="input mt-2"
            data-testid="cascade-manufacturer-custom"
            placeholder={t('Manufacturer')}
            value={state.customManufacturer}
            onChange={(e) => cascade.setCustomManufacturer(e.target.value)}
          />
        )}
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${idPrefix}-model`}>
          {t('Model')}
        </label>
        <select
          id={`${idPrefix}-model`}
          data-testid="cascade-model"
          className="input select mt-1"
          value={state.model}
          disabled={!state.manufacturer}
          onChange={(e) => cascade.setModel(e.target.value)}
        >
          <option value="">{t('— Select —')}</option>
          {cascade.modelChoices.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          <option value={OTHER_VALUE}>{t('Other / custom…')}</option>
        </select>
        {state.model === OTHER_VALUE && (
          <input
            className="input mt-2"
            data-testid="cascade-model-custom"
            placeholder={t('Custom model name')}
            value={state.customModel}
            onChange={(e) => cascade.setCustomModel(e.target.value)}
          />
        )}
      </div>
    </>
  );
}
