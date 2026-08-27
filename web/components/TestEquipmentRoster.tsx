'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { roleLabel } from '@/lib/labels';
import { isFieldEngineer } from '@/lib/roles';
import {
  TEST_EQUIPMENT_TYPES,
  assignTestEquipmentToFse,
  loadShopTestEquipment,
  saveShopTestEquipment,
  testEquipmentLabel,
  type TestEquipmentRow,
} from '@/lib/test-equipment';

export type RosterMember = { id: string; name: string; role?: string | null };

function schemaNote(kind: 'unavailable' | 'lag') {
  if (kind === 'unavailable') {
    return 'Company test equipment is not available on this database yet. Apply the shop test-equipment SQL when you can — this screen will stay quiet until then.';
  }
  return 'Assignment columns are not on live SQL yet. The list still loads; assign will work after the migration is applied.';
}

export function TestEquipmentRoster(props: {
  orgId: number | string | null;
  userId: string | null;
  members: RosterMember[];
  canAssign: boolean;
}) {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<TestEquipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: 'Power Meter',
    make: '',
    model: '',
    serial_number: '',
    assigned_to_fse: '',
  });

  const fseOptions = props.members.filter(
    (m) => !m.role || isFieldEngineer(m.role) || String(m.role).toLowerCase() === 'service_manager'
  );
  const assignOptions = fseOptions.length ? fseOptions : props.members;

  const nameById: Record<string, string> = {};
  for (const m of props.members) nameById[m.id] = m.name;

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await loadShopTestEquipment(supabase, {
      orgId: props.orgId,
      userId: props.userId,
    });
    setRows(result.rows);
    if (result.unavailable) setNote(schemaNote('unavailable'));
    else if (result.schemaLag) setNote(schemaNote('lag'));
    else setNote(null);
    setLoading(false);
  }, [supabase, props.orgId, props.userId]);

  useEffect(() => {
    if (props.orgId == null && !props.userId) {
      setLoading(false);
      return;
    }
    reload();
  }, [props.orgId, props.userId, reload]);

  async function onAssign(id: string, fseId: string) {
    const result = await assignTestEquipmentToFse(supabase, id, fseId || null);
    if (result.unavailable) {
      setNote(schemaNote('unavailable'));
      return;
    }
    if (result.schemaLag) {
      setNote(schemaNote('lag'));
      return;
    }
    if (!result.ok) {
      setNote(result.error?.message || 'Could not update assignment.');
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, assigned_to_fse: fseId || null } : r))
    );
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!props.userId || !form.type) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      user_id: props.userId,
      type: form.type,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      organization_id: props.orgId,
      owned_by: null,
      assigned_to_fse: form.assigned_to_fse || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const result = await saveShopTestEquipment(supabase, payload, null);
    setSaving(false);
    if (result.unavailable) {
      setNote(schemaNote('unavailable'));
      return;
    }
    if (result.error && !result.schemaLag) {
      setNote(result.error.message || 'Could not save test equipment.');
      return;
    }
    if (result.schemaLag) setNote(schemaNote('lag'));
    setAdding(false);
    setForm({ type: 'Power Meter', make: '', model: '', serial_number: '', assigned_to_fse: '' });
    await reload();
  }

  return (
    <div className="card p-6 mt-10">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="font-bold text-xl">Company test equipment</h2>
          <p className="text-sm text-[var(--text3)] mt-1">
            Meters, analyzers, and other shop tools. Admin / owner can assign a piece to an FSE.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {props.canAssign && (
            <button type="button" className="btn btn-primary text-sm" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : 'Add equipment'}
            </button>
          )}
          <Link href="/test-equipment" className="btn btn-secondary text-sm">
            Full list
          </Link>
        </div>
      </div>

      {note && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface3)] text-sm text-[var(--text2)]">
          {note}
        </div>
      )}

      {adding && props.canAssign && (
        <form onSubmit={onAdd} className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-lg border border-[var(--border)]">
          <div>
            <label className="label">Type</label>
            <select
              className="select"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {TEST_EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Assign to FSE</label>
            <select
              className="select"
              value={form.assigned_to_fse}
              onChange={(e) => setForm({ ...form, assigned_to_fse: e.target.value })}
            >
              <option value="">Unassigned / shop stock</option>
              {assignOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.role ? ` · ${roleLabel(m.role)}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Make</label>
            <input
              className="input"
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Model</label>
            <input
              className="input"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">Serial #</label>
            <input
              className="input"
              value={form.serial_number}
              onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save equipment'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-8 text-[var(--text3)]">Loading test equipment…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-[var(--text3)]">No company test equipment yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-sm text-[var(--text3)]">
                <th className="py-3 px-4">Equipment</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Serial</th>
                <th className="py-3 px-4">Assigned FSE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--surface3)]">
                  <td className="py-3 px-4 font-medium">{testEquipmentLabel(r)}</td>
                  <td className="py-3 px-4 text-sm">{r.type || '—'}</td>
                  <td className="py-3 px-4 text-sm text-[var(--text3)]">{r.serial_number || '—'}</td>
                  <td className="py-3 px-4">
                    {props.canAssign ? (
                      <select
                        className="select text-sm"
                        value={r.assigned_to_fse || ''}
                        onChange={(e) => onAssign(r.id, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {assignOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.role ? ` · ${roleLabel(m.role)}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm">
                        {r.assigned_to_fse ? nameById[r.assigned_to_fse] || 'FSE' : 'Unassigned'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
