'use client';

import {
  customerEquipmentLabel,
  NEW_EQUIPMENT_VALUE,
  type CustomerEquipment,
} from '@/lib/customer-equipment';

type Props = {
  orgName: string;
  equipment: CustomerEquipment[];
  loading: boolean;
  selectedId: string;
  onPick: (value: string) => void;
  t?: (key: string) => string;
  idPrefix?: string;
};

/** "Customer equipment" select shown once a customer org is picked. */
export default function CustomerEquipmentPicker({
  orgName,
  equipment,
  loading,
  selectedId,
  onPick,
  t = (k) => k,
  idPrefix = 'cust-eq',
}: Props) {
  return (
    <div className="sm:col-span-2">
      <label className="text-xs text-[var(--text3)]" htmlFor={`${idPrefix}-pick`}>
        {t('Equipment on file for {org}').replace('{org}', orgName || t('this customer'))}
      </label>
      <select
        id={`${idPrefix}-pick`}
        data-testid="customer-equipment-pick"
        className="input select mt-1"
        value={selectedId}
        disabled={loading}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">
          {loading
            ? t('Loading…')
            : equipment.length
              ? t('— Pick their equipment —')
              : t('No equipment on file')}
        </option>
        {equipment.map((eq) => (
          <option key={String(eq.id)} value={String(eq.id)}>
            {customerEquipmentLabel(eq)}
          </option>
        ))}
        <option value={NEW_EQUIPMENT_VALUE}>{t('+ Equipment not on file')}</option>
      </select>
    </div>
  );
}

export function AddToOrgCheckbox({
  orgName,
  checked,
  onChange,
  t = (k) => k,
}: {
  orgName: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  t?: (key: string) => string;
}) {
  return (
    <label className="sm:col-span-2 flex items-center gap-2 text-sm" data-testid="add-equipment-to-org">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{t('Add this equipment to {org}').replace('{org}', orgName || t('this customer'))}</span>
    </label>
  );
}
