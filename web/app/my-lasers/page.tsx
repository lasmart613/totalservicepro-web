'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { listManufacturers, listModelsForManufacturer, OTHER_MODEL } from '@/lib/laser-catalog';

type LaserRow = {
  id: number;
  manufacturer: string;
  model: string;
  serial_number?: string | null;
  notes?: string | null;
  room?: string | null;
  photo_url?: string | null;
  customer_organization_id?: number | null;
};

export default function MyLasersPage() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const justSetup =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('justSetup') === '1';
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [rows, setRows] = useState<LaserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [mfr, setMfr] = useState('');
  const [model, setModel] = useState('');
  const [modelOther, setModelOther] = useState('');
  const [serial, setSerial] = useState('');
  const [room, setRoom] = useState('');
  const [saving, setSaving] = useState(false);

  const mfrOptions = useMemo(() => listManufacturers(), []);
  const modelOptions = useMemo(() => listModelsForManufacturer(mfr), [mfr]);

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
    setMfr('');
    setModel('');
    setModelOther('');
    setSerial('');
    setRoom('');
    setModalOpen(true);
  }

  async function saveLaser() {
    const modelVal = model === OTHER_MODEL ? modelOther.trim() : model.trim();
    if (!mfr.trim() || !modelVal) {
      toast.error('Manufacturer and model are required');
      return;
    }
    if (!orgId) {
      toast.error('No facility linked. Finish onboarding first.');
      return;
    }
    setSaving(true);
    const payload: any = {
      customer_organization_id: orgId,
      manufacturer: mfr.trim(),
      model: modelVal,
      serial_number: serial.trim() || null,
      room: room.trim() || null,
    };
    try {
      let { error } = await supabase.from('equipment').insert(payload);
      if (error) {
        // Retry without room if column missing on older deploys
        const slim = {
          customer_organization_id: orgId,
          manufacturer: payload.manufacturer,
          model: payload.model,
          serial_number: payload.serial_number,
        };
        const r2 = await supabase.from('equipment').insert(slim);
        if (r2.error) throw r2.error;
      }
      toast.success('Laser added');
      setModalOpen(false);
      await load(orgId);
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
          <div>
            <Link href="/" className="text-sm text-[var(--gold)] hover:underline">← Dashboard</Link>
            <h1 className="text-3xl font-extrabold mt-1">My Lasers</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/service-requests" className="btn btn-secondary">
              Request Service
            </Link>
            <button type="button" onClick={openAdd} className="btn btn-primary" disabled={!orgId}>
              ＋ Add
            </button>
          </div>
        </div>
        <p className="text-sm text-[var(--text3)] mb-4">
          Tap a system to open its laser profile. Service requests are separate from the marketplace.
        </p>
        {justSetup && (
          <div className="mb-6 p-3 rounded-lg border border-green-500/40 bg-green-500/10 text-sm text-green-300">
            Facility setup complete. Your registered lasers should appear below. Missing any? Use <strong>Add laser</strong>.
            {' '}
            <Link href="/" className="text-[var(--gold)] underline">Go to Dashboard</Link>
          </div>
        )}

        {loading && <div className="card p-8 text-center text-[var(--text3)]">Loading…</div>}

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
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              <button type="button" onClick={openAdd} className="btn btn-primary">Add your first laser</button>
              <Link href="/service-requests" className="btn btn-secondary">Service Requests</Link>
            </div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="card p-4 hover:border-[var(--gold)] transition-colors">
                <div className="flex items-start gap-3">
                  <Link href={`/my-lasers/${r.id}`} className="flex gap-3 flex-1 min-w-0 text-left">
                    {r.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photo_url} alt="" className="w-14 h-14 rounded-xl object-cover border border-[var(--border2)]" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-[var(--surface3)] flex items-center justify-center text-2xl">📷</div>
                    )}
                    <div className="min-w-0">
                      <div className="font-extrabold text-[var(--gold)]">
                        {r.manufacturer} {r.model}
                      </div>
                      <div className="text-xs text-[var(--text3)] mt-1">
                        {r.serial_number ? `SN ${r.serial_number}` : 'No SN'}
                        {r.room ? ` · ${r.room}` : ''}
                        {' · Open profile'}
                      </div>
                    </div>
                  </Link>
                </div>
                <div className="flex gap-2 mt-3">
                  <Link href={`/my-lasers/${r.id}`} className="btn btn-secondary text-sm flex-1 text-center">
                    Profile
                  </Link>
                  <Link
                    href={`/service-requests?laser_id=${r.id}`}
                    className="btn btn-primary text-sm flex-1 text-center"
                  >
                    Request Service
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55" onClick={() => setModalOpen(false)}>
          <div
            className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-extrabold text-lg text-[var(--gold)] mb-4">Add Laser</div>
            <div className="space-y-3">
              <div>
                <label className="label">Manufacturer *</label>
                <select
                  className="input"
                  value={mfr}
                  onChange={(e) => {
                    setMfr(e.target.value);
                    setModel('');
                    setModelOther('');
                  }}
                >
                  <option value="">Select brand…</option>
                  {mfrOptions.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Model *</label>
                <select
                  className="input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!mfr}
                >
                  <option value="">{mfr ? 'Select model…' : 'Select manufacturer first'}</option>
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value={OTHER_MODEL}>Other / not listed…</option>
                </select>
                {model === OTHER_MODEL && (
                  <input
                    className="input mt-2"
                    value={modelOther}
                    onChange={(e) => setModelOther(e.target.value)}
                    placeholder="Model name"
                  />
                )}
              </div>
              <div>
                <label className="label">Serial #</label>
                <input className="input" value={serial} onChange={(e) => setSerial(e.target.value)} />
              </div>
              <div>
                <label className="label">Room</label>
                <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary flex-[2]" onClick={saveLaser} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
