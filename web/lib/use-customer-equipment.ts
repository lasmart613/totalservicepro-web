'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEquipmentMessage,
  addEquipmentToCustomerOrg,
  canOfferAddToOrg,
  loadCustomerEquipment,
  matchCustomerEquipment,
  NEW_EQUIPMENT_VALUE,
  type CustomerEquipment,
} from './customer-equipment.ts';
import type { EquipmentCascade } from './use-equipment-cascade.ts';

type Client = { from: (t: string) => any };

/**
 * Customer equipment picker state for the estimate and invoice forms.
 * Picking a row prefills the shared cascade and serial. A complete machine that
 * is not on file can be added to the customer org after the document saves.
 */
export function useCustomerEquipment(opts: {
  client: Client;
  customerOrgId: string | number | null;
  cascade: EquipmentCascade;
  serial: string;
  setSerial: (v: string) => void;
}) {
  const { client, customerOrgId, cascade, serial, setSerial } = opts;
  const [list, setList] = useState<CustomerEquipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [choseNew, setChoseNew] = useState(false);
  const [addToOrg, setAddToOrg] = useState(false);

  const reload = useCallback(async () => {
    if (customerOrgId == null || customerOrgId === '') {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      setList(await loadCustomerEquipment(client, customerOrgId));
    } finally {
      setLoading(false);
    }
  }, [client, customerOrgId]);

  useEffect(() => {
    setChoseNew(false);
    setAddToOrg(false);
    void reload();
  }, [reload]);

  const draft = {
    equipment_type: cascade.resolved.equipment_type,
    manufacturer: cascade.resolved.manufacturer,
    model: cascade.resolved.model,
    serial,
  };
  const match = useMemo(() => matchCustomerEquipment(list, draft), [list, serial]);
  const selectedId = match ? String(match.id) : choseNew ? NEW_EQUIPMENT_VALUE : '';
  const offerAdd = !loading && canOfferAddToOrg(list, draft, customerOrgId);

  const pick = useCallback(
    (value: string) => {
      if (value === NEW_EQUIPMENT_VALUE) {
        setChoseNew(true);
        setAddToOrg(true);
        cascade.reset(cascade.state.equipmentType);
        setSerial('');
        return;
      }
      setChoseNew(false);
      const row = list.find((r) => String(r.id) === value);
      if (!row) return;
      cascade.hydrate({
        equipmentType: row.equipment_type,
        manufacturer: row.manufacturer,
        model: row.model,
      });
      setSerial(row.serial_number);
    },
    [list, cascade, setSerial]
  );

  /** Call after the estimate/invoice saved. Returns a toast message or null. */
  const saveToOrgIfChecked = useCallback(
    async (orgName: string): Promise<{ ok: boolean; message: string | null; equipmentId?: number | string }> => {
      if (match) return { ok: true, message: null, equipmentId: match.id };
      if (!offerAdd || !addToOrg) return { ok: true, message: null };
      const res = await addEquipmentToCustomerOrg(client, customerOrgId, draft);
      const message = addEquipmentMessage(res, orgName);
      if (res.status === 'created' || res.status === 'exists') {
        setChoseNew(false);
        setAddToOrg(false);
        await reload();
        return { ok: true, message, equipmentId: res.id };
      }
      return { ok: res.status !== 'failed', message };
    },
    [match, offerAdd, addToOrg, client, customerOrgId, draft.equipment_type, draft.manufacturer, draft.model, serial, reload]
  );

  return {
    list,
    loading,
    selectedId,
    pick,
    offerAdd,
    addToOrg,
    setAddToOrg,
    saveToOrgIfChecked,
    visible: customerOrgId != null && customerOrgId !== '',
  };
}
