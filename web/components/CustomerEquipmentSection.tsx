'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import EquipmentCascadeFields from '@/components/EquipmentCascadeFields';
import { LockedHistoryPanel } from '@/components/LockedHistoryPanel';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  equipmentLocationLabel,
  equipmentRemoveMessage,
  equipmentSaveMessage,
  linksForEquipment,
  loadCustomerEquipmentRecords,
  loadCustomerEquipmentTickets,
  removeCustomerEquipmentRecord,
  saveCustomerEquipmentRecord,
  type CustomerEquipmentRecord,
} from '@/lib/customer-equipment-record';
import { loadCustomerLocations, type CustomerLocation } from '@/lib/customer-locations';
import { useEquipmentCatalog } from '@/lib/use-equipment-catalog';
import { useEquipmentCascade } from '@/lib/use-equipment-cascade';
import { formatDisplayDay } from '@/lib/i18n/format-date';
import { displayModelName } from '@/lib/model-display';
import { useT } from '@/lib/fa/locale';

type ReportLinkRow = {
  id: string | number;
  report_number?: string | null;
  serial_number?: string | null;
  equipment_id?: string | number | null;
  status?: string | null;
};

type Props = {
  customerId: string | number;
  customerName: string;
  canEdit: boolean;
  rows: CustomerEquipmentRecord[];
  reports: ReportLinkRow[];
  showLockedHistory: boolean;
  onRows: (rows: CustomerEquipmentRecord[]) => void;
};

const EMPTY_FORM = {
  serial: '',
  locationId: '',
  installDate: '',
  warranty: '',
  notes: '',
};

export function CustomerEquipmentSection({
  customerId,
  customerName,
  canEdit,
  rows,
  reports,
  showLockedHistory,
  onRows,
}: Props) {
  const t = useT();
  const supabase = getSupabaseClient();
  const catalog = useEquipmentCatalog(supabase);
  const cascade = useEquipmentCascade(catalog);
  const [locations, setLocations] = useState<CustomerLocation[]>([]);
  const [tickets, setTickets] = useState<
    Array<{ id: string | number; ticket_number?: string | null; equipment_id?: string | number | null; serial_number?: string | null }>
  >([]);
  const [mode, setMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCustomerLocations(supabase, customerId).then((loaded) => {
      if (!cancelled) setLocations(loaded.unavailable ? [] : loaded.locations);
    });
    loadCustomerEquipmentTickets(supabase, customerId).then((list) => {
      if (!cancelled) setTickets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, supabase, rows.length]);

  function openAdd() {
    setMode('add');
    setEditingId(null);
    setError(null);
    setConfirmId(null);
    setForm(EMPTY_FORM);
    cascade.reset();
  }

  function openEdit(row: CustomerEquipmentRecord) {
    setMode('edit');
    setEditingId(row.id);
    setError(null);
    setConfirmId(null);
    setForm({
      serial: row.serial_number,
      locationId: row.location_id == null ? '' : String(row.location_id),
      installDate: row.install_date,
      warranty: row.warranty_or_contract,
      notes: row.notes,
    });
    cascade.hydrate({
      equipmentType: row.equipment_type,
      manufacturer: row.manufacturer,
      model: row.model,
    });
  }

  function closeForm() {
    setMode(null);
    setEditingId(null);
    setError(null);
  }

  async function reload() {
    onRows(await loadCustomerEquipmentRecords(supabase, customerId));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const result = await saveCustomerEquipmentRecord(supabase, customerId, mode === 'edit' ? editingId : null, {
        equipment_type: cascade.resolved.equipment_type,
        manufacturer: cascade.resolved.manufacturer,
        model: cascade.resolved.model,
        serial: form.serial,
        location_id: form.locationId || null,
        install_date: form.installDate,
        warranty_or_contract: form.warranty,
        notes: form.notes,
      });
      const message = equipmentSaveMessage(result);
      if (result.status === 'saved' || result.status === 'restored') {
        if (message) toast.success(message);
        closeForm();
        await reload();
        return;
      }
      setError(message || 'Could not save the equipment.');
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: CustomerEquipmentRecord) {
    setSaving(true);
    try {
      const result = await removeCustomerEquipmentRecord(supabase, customerId, row.id);
      const message = equipmentRemoveMessage(result);
      if (result.status === 'failed') {
        toast.error(message);
        return;
      }
      toast.success(message);
      setConfirmId(null);
      if (editingId != null && String(editingId) === String(row.id)) closeForm();
      await reload();
    } finally {
      setSaving(false);
    }
  }

  const storedLocations = locations.filter((loc) => !loc.localOnly);

  return (
    <div className="section">
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden>🔬</span>
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)] flex-1">
          {t('Equipment')}
        </h2>
        {canEdit && mode == null && (
          <button type="button" className="btn btn-primary text-xs" data-testid="customer-eq-add" onClick={openAdd}>
            {t('Add equipment')}
          </button>
        )}
      </div>

      {mode != null && (
        <form
          className="mb-4 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <div className="text-sm font-bold">{mode === 'edit' ? t('Edit equipment') : t('Add equipment')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <EquipmentCascadeFields cascade={cascade} t={t} idPrefix="customer-eq" />
            </div>
            <div>
              <label className="label" htmlFor="customer-eq-serial">
                {t('Serial number')}
              </label>
              <input
                id="customer-eq-serial"
                data-testid="customer-eq-serial"
                className="input"
                value={form.serial}
                onChange={(e) => setForm({ ...form, serial: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="customer-eq-location">
                {t('Location')}
              </label>
              <select
                id="customer-eq-location"
                data-testid="customer-eq-location"
                className="input select"
                value={form.locationId}
                onChange={(e) => setForm({ ...form, locationId: e.target.value })}
              >
                <option value="">{t('Unassigned')}</option>
                {storedLocations.map((loc) => (
                  <option key={String(loc.id)} value={String(loc.id)}>
                    {equipmentLocationLabel(loc.id, storedLocations)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="customer-eq-install">
                {t('Installed')}
              </label>
              <input
                id="customer-eq-install"
                data-testid="customer-eq-install"
                type="date"
                className="input"
                value={form.installDate}
                onChange={(e) => setForm({ ...form, installDate: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="customer-eq-warranty">
                {t('Warranty or contract')}
              </label>
              <input
                id="customer-eq-warranty"
                data-testid="customer-eq-warranty"
                className="input"
                placeholder={t('Warranty end date, contract name, or contract number')}
                value={form.warranty}
                onChange={(e) => setForm({ ...form, warranty: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="customer-eq-notes">
                {t('Notes')}
              </label>
              <textarea
                id="customer-eq-notes"
                data-testid="customer-eq-notes"
                className="input"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="submit" className="btn btn-primary text-sm" data-testid="customer-eq-save" disabled={saving}>
              {saving ? t('Saving…') : t('Save')}
            </button>
            <button type="button" className="btn btn-secondary text-sm" disabled={saving} onClick={closeForm}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text3)] py-2">{t('No equipment on record for this customer.')}</p>
      ) : (
        <div className="overflow-x-auto" data-testid="customer-equipment-scroll">
          <table className="w-full min-w-[56rem] text-sm border-collapse" data-testid="customer-equipment-table">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text3)]">
                <th className="py-2 pr-3 font-semibold">{t('Manufacturer')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Model')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Serial number')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Location')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Installed')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Warranty or contract')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Notes')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Tickets')}</th>
                <th className="py-2 pr-3 font-semibold">{t('Service history')}</th>
                <th className="py-2 font-semibold">{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const linked = linksForEquipment(row, tickets, reports);
                const ticketHref = `/service-schedule?customer_id=${encodeURIComponent(String(customerId))}&equipment_id=${encodeURIComponent(String(row.id))}`;
                return (
                  <tr key={String(row.id)} className="border-t border-[var(--border)] align-top">
                    <td className="py-2 pr-3 font-semibold whitespace-nowrap">{row.manufacturer || '—'}</td>
                    <td className="py-2 pr-3">
                      <div>{displayModelName(row.model) || '—'}</div>
                      {row.equipment_type ? (
                        <div className="text-[10px] uppercase tracking-wide text-[var(--text3)]">{row.equipment_type}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{row.serial_number || '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{equipmentLocationLabel(row.location_id, storedLocations)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{row.install_date ? formatDisplayDay(row.install_date) : '—'}</td>
                    <td className="py-2 pr-3 max-w-[12rem]">{row.warranty_or_contract || '—'}</td>
                    <td className="py-2 pr-3 max-w-[14rem] break-words" title={row.notes || undefined}>
                      {row.notes || '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {linked.tickets.length === 0 ? (
                        <span className="text-[var(--text3)]">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {linked.tickets.map((ticket) => (
                            <Link key={String(ticket.id)} href={ticket.href} className="text-[var(--gold)] hover:underline whitespace-nowrap">
                              {ticket.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {linked.reports.length === 0 ? (
                        <span className="text-[var(--text3)]">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {linked.reports.map((report) => (
                            <Link key={String(report.id)} href={report.href} className="text-[var(--gold)] hover:underline whitespace-nowrap">
                              {report.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col items-start gap-1 min-w-[7rem]">
                        <Link href={ticketHref} className="text-xs text-[var(--gold)] hover:underline whitespace-nowrap">
                          {t('New ticket')}
                        </Link>
                        {canEdit && (
                          <button type="button" className="text-xs text-[var(--text)] hover:underline" onClick={() => openEdit(row)}>
                            {t('Edit')}
                          </button>
                        )}
                        {canEdit && confirmId !== row.id && (
                          <button
                            type="button"
                            className="text-xs text-red-400 hover:underline"
                            onClick={() => setConfirmId(row.id)}
                          >
                            {t('Remove')}
                          </button>
                        )}
                        {canEdit && confirmId === row.id && (
                          <div className="text-xs">
                            <p className="text-[var(--text3)] mb-1">
                              {linked.tickets.length + linked.reports.length > 0
                                ? t('This unit has history. It will be hidden. Tickets and reports stay linked.')
                                : t('Remove this unit?')}
                            </p>
                            <button
                              type="button"
                              className="text-red-400 font-semibold mr-2"
                              disabled={saving}
                              onClick={() => void onRemove(row)}
                            >
                              {t('Remove')}
                            </button>
                            <button type="button" className="text-[var(--text3)]" onClick={() => setConfirmId(null)}>
                              {t('Cancel')}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showLockedHistory &&
        rows.map((row) => (
          <LockedHistoryPanel
            key={`history-${row.id}`}
            supabase={supabase}
            ownerOrgId={customerId}
            equipmentId={row.id}
            clinicName={customerName}
          />
        ))}
    </div>
  );
}
