'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEquipmentMessage,
  addEquipmentToCustomerOrg,
  clinicEquipmentSelectState,
  loadCustomerEquipment,
  newEquipmentErrors,
  NEW_EQUIPMENT_VALUE,
  type CustomerEquipment,
} from '@/lib/customer-equipment';

type Client = { from: (t: string) => any };

export type ClinicEquipmentGroup = { label: string; rows: CustomerEquipment[] };

type Props = {
  client: Client;
  /** Clinic (customer) org. The select is disabled until this is set. */
  clinicOrgId: string | number | null | undefined;
  clinicName?: string;
  /** Selected equipment id ('' for none). */
  value: string;
  /** Picked an on-file unit, or null when cleared / clinic changed. */
  onSelect: (row: CustomerEquipment | null) => void;
  /** Called after "Add new equipment" saved a unit (it is auto-selected too). */
  onAdded?: (row: CustomerEquipment) => void;
  /** Parent-managed list (e.g. the service report). When omitted the component loads it. */
  equipment?: CustomerEquipment[];
  /** Optional optgroups (e.g. equipment at this site / unassigned). Defaults to one flat list. */
  groups?: ClinicEquipmentGroup[];
  /** Parent reloads its list after an add (only with `equipment`). */
  reload?: () => Promise<void> | void;
  label?: string;
  t?: (key: string) => string;
  idPrefix?: string;
  className?: string;
};

/**
 * Shared clinic equipment dropdown for every form where a clinic and a unit are
 * entered. Lists the clinic org's own equipment (make, model, serial) plus
 * "Add new equipment", which saves to that clinic's equipment list through the
 * live RLS policies (clinic owner, or a service org linked in organization_customers).
 */
export default function ClinicEquipmentSelect({
  client,
  clinicOrgId,
  clinicName = '',
  value,
  onSelect,
  onAdded,
  equipment,
  groups,
  reload,
  label,
  t = (k) => k,
  idPrefix = 'clinic-eq',
  className = '',
}: Props) {
  const [ownList, setOwnList] = useState<CustomerEquipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [room, setRoom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = equipment ?? ownList;
  const prevClinic = useRef(clinicOrgId);

  const loadOwn = useCallback(async () => {
    if (equipment) return;
    if (clinicOrgId == null || clinicOrgId === '') {
      setOwnList([]);
      return;
    }
    setLoading(true);
    try {
      setOwnList(await loadCustomerEquipment(client, clinicOrgId));
    } finally {
      setLoading(false);
    }
  }, [client, clinicOrgId, equipment == null]);

  useEffect(() => {
    void loadOwn();
  }, [loadOwn]);

  // Clinic changed: drop the old pick and close the add form.
  useEffect(() => {
    if (prevClinic.current === clinicOrgId) return;
    prevClinic.current = clinicOrgId;
    setAdding(false);
    setError(null);
    if (value) onSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicOrgId]);

  const state = clinicEquipmentSelectState(clinicOrgId, list, loading);
  const clinic = clinicName || t('this clinic');

  function openAdd() {
    setMake('');
    setModel('');
    setSerial('');
    setRoom('');
    setError(null);
    setAdding(true);
  }

  async function saveNew() {
    const draft = { equipment_type: null, manufacturer: make, model, serial, room };
    const errs = newEquipmentErrors(draft);
    if (errs.length) {
      setError(errs.map(t).join(' · '));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addEquipmentToCustomerOrg(client, clinicOrgId, draft, { requireSerial: false });
      if (res.status === 'created' || res.status === 'exists') {
        const row: CustomerEquipment = {
          id: res.id,
          equipment_type: null,
          manufacturer: make.trim(),
          model: model.trim(),
          serial_number: serial.trim(),
        };
        if (equipment) await reload?.();
        else {
          const fresh = await loadCustomerEquipment(client, clinicOrgId);
          setOwnList(fresh.some((r) => String(r.id) === String(res.id)) ? fresh : [...fresh, row]);
        }
        setAdding(false);
        onAdded?.(row);
        onSelect(row);
        return;
      }
      setError(addEquipmentMessage(res, clinic) || t('Could not add the equipment.'));
    } finally {
      setSaving(false);
    }
  }

  const options = groups
    ? null
    : state.options.filter((o) => o.value !== NEW_EQUIPMENT_VALUE);

  return (
    <div className={className} data-testid="clinic-equipment-select">
      <label className="label" htmlFor={`${idPrefix}-pick`}>
        {label || t('Equipment')}
      </label>
      <select
        id={`${idPrefix}-pick`}
        data-testid="clinic-equipment-pick"
        className="input select w-full"
        value={adding ? NEW_EQUIPMENT_VALUE : value}
        disabled={state.disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW_EQUIPMENT_VALUE) {
            openAdd();
            return;
          }
          setAdding(false);
          onSelect(list.find((r) => String(r.id) === v) || null);
        }}
      >
        <option value="">{t(state.placeholder)}</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.filter((g) => g.rows.length).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.rows.map((r) => (
              <option key={String(r.id)} value={String(r.id)}>
                {state.options.find((o) => o.value === String(r.id))?.label || String(r.id)}
              </option>
            ))}
          </optgroup>
        ))}
        {clinicOrgId != null && clinicOrgId !== '' && (
          <option value={NEW_EQUIPMENT_VALUE}>{t('+ Add new equipment')}</option>
        )}
      </select>

      {adding && (
        <div className="mt-2 p-3 rounded-lg border border-[var(--border2)] space-y-2" data-testid="clinic-equipment-add">
          <div className="text-xs text-[var(--text3)]">
            {t('Add new equipment to {org}').replace('{org}', clinic)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="input" data-testid="new-eq-make" placeholder={t('Make *')} value={make} onChange={(e) => setMake(e.target.value)} autoComplete="off" />
            <input className="input" data-testid="new-eq-model" placeholder={t('Model *')} value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
            <input className="input" data-testid="new-eq-serial" placeholder={t('Serial # (recommended)')} title={t('Serial # is optional, but recommended so the unit can be matched later.')} value={serial} onChange={(e) => setSerial(e.target.value)} autoComplete="off" />
            <input className="input" data-testid="new-eq-room" placeholder={t('Nickname / location (optional)')} value={room} onChange={(e) => setRoom(e.target.value)} autoComplete="off" />
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary text-sm" disabled={saving} onClick={() => void saveNew()} data-testid="new-eq-save">
              {saving ? t('Saving…') : t('Save equipment')}
            </button>
            <button type="button" className="btn btn-secondary text-sm" disabled={saving} onClick={() => setAdding(false)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
