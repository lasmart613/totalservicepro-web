'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type LaserRow = {
  id: number;
  manufacturer: string;
  model: string;
  serial_number?: string | null;
  notes?: string | null;
  customer_organization_id?: number | null;
};

const MFR_OPTIONS = [
  'Candela', 'Lumenis', 'Cynosure', 'Cutera', 'Sciton', 'Fotona',
  'Alma', 'InMode', 'HOYA ConBio', 'Syneron', 'Quanta', 'Iridex', 'Coherent', 'Lutronic',
];

export default function MyLasersPage() {
  const supabase = getSupabaseClient();
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [rows, setRows] = useState<LaserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [mfr, setMfr] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (!prof?.organization_id) {
        setLoading(false);
        return;
      }

      setOrgId(prof.organization_id);
      await load(prof.organization_id);
      setLoading(false);
    })();
  }, [supabase]);

  async function load(customerOrgId: any) {
    const { data, error } = await supabase
      .from('equipment')
      .select('*')
      .eq('customer_organization_id', customerOrgId)
      .order('manufacturer');
    if (error) {
      toast.error('Could not load lasers: ' + (error.message || ''));
      setRows([]);
      return;
    }
    setRows((data || []) as LaserRow[]);
  }

  function openAdd() {
    setEditId(null);
    setMfr('');
    setModel('');
    setSerial('');
    setNotes('');
    setModalOpen(true);
  }

  function openEdit(row: LaserRow) {
    setEditId(row.id);
    setMfr(row.manufacturer || '');
    setModel(row.model || '');
    setSerial(row.serial_number || '');
    setNotes(row.notes || '');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function saveLaser() {
    const manufacturer = mfr.trim();
    const modelVal = model.trim();
    if (!manufacturer || !modelVal) {
      toast.error('Manufacturer and model are required');
      return;
    }
    if (!orgId) {
      toast.error('No facility linked. Finish onboarding first.');
      return;
    }

    setSaving(true);
    const payload = {
      customer_organization_id: orgId,
      manufacturer,
      model: modelVal,
      serial_number: serial.trim() || '',
      notes: notes.trim() || null,
    };

    try {
      if (editId) {
        const { error } = await supabase.from('equipment').update(payload).eq('id', editId);
        if (error) throw error;
        toast.success('Laser updated');
      } else {
        const { error } = await supabase.from('equipment').insert(payload);
        if (error) throw error;
        toast.success('Laser added');
      }
      closeModal();
      await load(orgId);
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLaser() {
    if (!editId || !confirm('Remove this laser from your inventory?')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('equipment').delete().eq('id', editId);
      if (error) throw error;
      toast.success('Laser removed');
      closeModal();
      if (orgId) await load(orgId);
    } catch (e: any) {
      toast.error(e.message || 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-2">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">← Dashboard</Link>
            <h1 className="text-3xl font-extrabold mt-1">My Lasers</h1>
          </div>
          <button type="button" onClick={openAdd} className="btn btn-primary" disabled={!orgId}>
            ＋ Add
          </button>
        </div>
        <p className="text-sm text-[var(--text3)] mb-6">
          Lasers registered to your facility. Service history and marketplace requests can reference these systems.
        </p>

        {loading && (
          <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>
        )}

        {!loading && !orgId && (
          <div className="card p-8 text-center text-[var(--text3)]">
            No facility linked. Finish onboarding first.
            <div className="mt-4">
              <Link href="/onboarding" className="btn btn-primary">Complete setup</Link>
            </div>
          </div>
        )}

        {!loading && orgId && rows.length === 0 && (
          <div className="card p-10 text-center text-[var(--text3)]">
            <div className="text-4xl mb-2">⚡</div>
            No lasers yet.
            <div className="mt-4">
              <button type="button" onClick={openAdd} className="btn btn-primary">Add your first laser</button>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => openEdit(r)}
                className="card p-4 w-full text-left hover:border-[var(--gold)] transition-colors"
              >
                <div className="font-extrabold text-[var(--gold)]">
                  {r.manufacturer} {r.model}
                </div>
                <div className="text-xs text-[var(--text3)] mt-1">
                  {r.serial_number ? `SN ${r.serial_number} · ` : ''}
                  {r.notes || 'Tap to edit'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55"
          onClick={closeModal}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="font-extrabold text-lg text-[var(--gold)] mb-4">
              {editId ? 'Edit Laser' : 'Add Laser'}
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">Manufacturer *</label>
                <input
                  className="input"
                  list="mfrList"
                  value={mfr}
                  onChange={e => setMfr(e.target.value)}
                  placeholder="Candela"
                />
                <datalist id="mfrList">
                  {MFR_OPTIONS.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div>
                <label className="label">Model *</label>
                <input
                  className="input"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="GentleMax Pro"
                />
              </div>
              <div>
                <label className="label">Serial #</label>
                <input
                  className="input"
                  value={serial}
                  onChange={e => setSerial(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="label">Notes</label>
                <input
                  className="input"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Location, handpiece, etc."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button type="button" className="btn btn-secondary flex-1" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary flex-[2]" onClick={saveLaser} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            {editId && (
              <button
                type="button"
                className="btn btn-secondary w-full mt-3 text-red-400"
                onClick={deleteLaser}
                disabled={saving}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
