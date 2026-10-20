'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useEquipmentCascade } from '@/lib/use-equipment-cascade';
import EquipmentCascadeFields from '@/components/EquipmentCascadeFields';
import { displayModelName, displayModelText } from '@/lib/model-display';
import { useEquipmentCatalog } from '@/lib/use-equipment-catalog';
import { loadServiceHistoryForLaser, loadServiceRequestsForLaser } from '@/lib/equipment-ensure';
import { StorageImage } from '@/components/StorageImage';
import { LaserHistoryAccessPanel } from '@/components/LaserHistoryAccessPanel';
import { formatDisplayDay, parseDisplayDate } from '@/lib/i18n/format-date';

type Laser = {
  id: number;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  notes?: string | null;
  service_notes?: string | null;
  room?: string | null;
  manufacture_date?: string | null;
  photo_url?: string | null;
  created_at?: string | null;
  customer_organization_id?: number | null;
};

type HistItem = {
  kind: 'report' | 'request';
  id?: string | number;
  title: string;
  date?: string | null;
  detail?: string;
};

export default function LaserProfilePage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [laser, setLaser] = useState<Laser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hist, setHist] = useState<HistItem[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<number | string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serial, setSerial] = useState('');
  const [room, setRoom] = useState('');
  const [mfgDate, setMfgDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const catalog = useEquipmentCatalog(supabase);
  const cascade = useEquipmentCascade(catalog);

  useEffect(() => {
    if (id) loadAll();
  }, [id]);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id || null);
    if (user) {
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();
      setOrgId(prof?.organization_id ?? null);
    }

    const { data, error } = await supabase.from('equipment').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      toast.error('Laser not found');
      setLaser(null);
      setLoading(false);
      return;
    }
    setLaser(data as Laser);
    await loadHistory(data as Laser);
    setLoading(false);
  }

  async function loadHistory(L: Laser) {
    const items: HistItem[] = [];
    try {
      // By equipment_id OR serial — history follows laser across owner / FSE transfer
      const reps = await loadServiceHistoryForLaser({
        client: supabase,
        equipmentId: L.id,
        serial: L.serial_number,
        status: 'complete',
        limit: 40,
      });
      reps.forEach((r) => {
        items.push({
          kind: 'report',
          id: r.id,
          title:
            (r.report_number ? `${r.report_number} · ` : '') + (r.service_type || 'Service report'),
          date: r.date_out || r.created_at,
          detail: [displayModelText(r.equipment_name || r.model_type || ''), r.service_engineer ? `FSE: ${r.service_engineer}` : '']
            .filter(Boolean)
            .join(' · '),
        });
      });
      const reqs = await loadServiceRequestsForLaser({
        client: supabase,
        equipmentId: L.id,
        serial: L.serial_number,
        limit: 20,
      });
      (reqs || []).forEach((r: any) => {
        items.push({
          kind: 'request',
          id: r.id,
          title: r.title || r.service_type || 'Service request',
          date: r.created_at,
          detail: `${r.status || ''}${r.urgency ? ` · ${r.urgency}` : ''}`,
        });
      });
    } catch {
      /* ignore */
    }
    items.sort((a, b) => (parseDisplayDate(b.date)?.getTime() ?? 0) - (parseDisplayDate(a.date)?.getTime() ?? 0));
    setHist(items);
  }

  function openEdit() {
    if (!laser) return;
    cascade.hydrate({
      equipmentType: (laser as any).equipment_type,
      manufacturer: laser.manufacturer || '',
      model: laser.model || '',
    });
    setSerial(laser.serial_number || '');
    setRoom(laser.room || '');
    setMfgDate(laser.manufacture_date || '');
    setNotes(laser.service_notes || laser.notes || '');
    setPhotoFile(null);
    setEditOpen(true);
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    if (!userId || !laser) return null;
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `equipment/${orgId || 'x'}/${laser.id}_${Date.now()}.${ext}`;
    // Prefer public buckets with authenticated write (equipment-photos created for this feature)
    const buckets = ['equipment-photos', 'part-images', 'company-assets', 'logos'];
    const errors: string[] = [];
    for (const bucket of buckets) {
      try {
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          upsert: true,
          contentType: file.type || 'image/jpeg',
        });
        if (error) {
          errors.push(`${bucket}: ${error.message}`);
          continue;
        }
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        if (data?.publicUrl) return data.publicUrl;
      } catch (e: any) {
        errors.push(`${bucket}: ${e?.message || e}`);
      }
    }
    console.warn('photo upload failed', errors);
    throw new Error(
      errors[0]
        ? `Could not upload photo: ${errors[0]}`
        : 'Could not upload photo (storage bucket)'
    );
  }

  async function saveEdit() {
    if (!laser) return;
    const { manufacturer: mfrVal, model: modelVal, equipment_type: equipmentType } = cascade.resolved;
    if (!mfrVal || !modelVal) {
      toast.error('Manufacturer and model are required');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        manufacturer: mfrVal,
        model: modelVal,
        equipment_type: equipmentType,
        serial_number: serial.trim() || null,
        room: room.trim() || null,
        manufacture_date: mfgDate || null,
        service_notes: notes.trim() || null,
        notes: notes.trim() || null,
      };
      if (photoFile) {
        toast.message('Uploading photo…');
        payload.photo_url = await uploadPhoto(photoFile);
      }
      let { error } = await supabase.from('equipment').update(payload).eq('id', laser.id);
      if (error) {
        // Before 000937 there is no equipment_type column.
        const { equipment_type: _type, ...noType } = payload;
        ({ error } = await supabase.from('equipment').update(noType).eq('id', laser.id));
      }
      if (error) {
        const slim: any = {
          manufacturer: payload.manufacturer,
          model: payload.model,
          serial_number: payload.serial_number,
          notes: payload.notes,
        };
        if (payload.photo_url) slim.photo_url = payload.photo_url;
        if (payload.room) slim.room = payload.room;
        if (payload.manufacture_date) slim.manufacture_date = payload.manufacture_date;
        if (payload.service_notes) slim.service_notes = payload.service_notes;
        const r2 = await supabase.from('equipment').update(slim).eq('id', laser.id);
        if (r2.error) {
          const r3 = await supabase.from('equipment').update({
            manufacturer: payload.manufacturer,
            model: payload.model,
            serial_number: payload.serial_number,
            notes: payload.notes,
          }).eq('id', laser.id);
          if (r3.error) throw r3.error;
        }
      }
      toast.success('Laser updated');
      setEditOpen(false);
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteLaser() {
    if (!laser || !confirm('Remove this laser from your inventory?')) return;
    const { error } = await supabase.from('equipment').delete().eq('id', laser.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Laser removed');
    router.push('/my-lasers');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading…</div>
      </div>
    );
  }

  if (!laser) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-xl mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Laser not found</h1>
          <Link href="/my-lasers" className="btn btn-primary">Back to My Lasers</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-2xl mx-auto w-full px-4 py-8">
        <Link href="/my-lasers" className="text-sm text-[var(--gold)] hover:underline">← My Lasers</Link>

        <div className="mt-4 rounded-2xl overflow-hidden border border-[var(--border2)] bg-[var(--surface3)] h-52 flex items-center justify-center">
          {laser.photo_url ? (
            <StorageImage src={laser.photo_url} alt="" width={960} loading="eager" className="w-full h-full object-cover" />
          ) : (
            <span className="text-5xl opacity-50">📷</span>
          )}
        </div>

        <h1 className="text-3xl font-extrabold text-[var(--gold)] mt-4">
          {laser.manufacturer} {displayModelName(laser.model)}
        </h1>
        <p className="text-sm text-[var(--text3)] mt-1">
          {laser.serial_number ? `SN ${laser.serial_number}` : 'No serial on file'}
          {laser.room ? ` · ${laser.room}` : ''}
        </p>

        <div className="flex gap-2 mt-4">
          <Link
            href={`/service-requests?laser_id=${laser.id}`}
            className="btn btn-primary flex-1 text-center"
          >
            🛠️ Request Service
          </Link>
          <button type="button" className="btn btn-secondary flex-1" onClick={openEdit}>
            Edit Laser
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          {[
            ['Serial #', laser.serial_number || '—'],
            ['Room', laser.room || '—'],
            ['Manufacture date', laser.manufacture_date || '—'],
            ['Added', laser.created_at ? new Date(laser.created_at).toLocaleDateString() : '—'],
          ].map(([label, val]) => (
            <div key={label} className="card p-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text3)] font-bold">{label}</div>
              <div className="font-bold mt-1 break-words">{val}</div>
            </div>
          ))}
        </div>

        <h2 className="font-bold text-[var(--gold)] mt-8 mb-2">Notes</h2>
        <div className="card p-4 text-sm whitespace-pre-wrap text-[var(--text2)]">
          {laser.service_notes || laser.notes || 'No notes yet. Use Edit Laser to add notes.'}
        </div>

        <LaserHistoryAccessPanel supabase={supabase} ownerOrgId={laser.customer_organization_id} equipmentId={laser.id} />

        <h2 className="font-bold text-[var(--gold)] mt-8 mb-2">Service history</h2>
        <p className="text-xs text-[var(--text3)] mb-2">
          Linked by laser serial / equipment ID — follows this system if ownership transfers or a different FSE services it.
        </p>
        {hist.length === 0 ? (
          <div className="card p-5 text-sm text-[var(--text3)]">No service history for this system yet.</div>
        ) : (
          <div className="space-y-2">
            {hist.map((h, i) => {
              const inner = (
                <>
                  <div className="font-semibold">{h.title}</div>
                  <div className="text-xs text-[var(--text3)] mt-1">
                    {formatDisplayDay(h.date)}
                    {h.detail ? ` · ${h.detail}` : ''}
                    {' · '}
                    {h.kind === 'report' ? 'Report' : 'Request'}
                  </div>
                </>
              );
              if (h.kind === 'report' && h.id) {
                return (
                  <Link key={i} href={`/reports/${h.id}`} className="card p-3 block hover:border-[var(--gold)]">
                    {inner}
                  </Link>
                );
              }
              return (
                <div key={i} className="card p-3">
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/55" onClick={() => setEditOpen(false)}>
          <div
            className="bg-[var(--surface)] border border-[var(--border2)] rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-extrabold text-lg text-[var(--gold)] mb-4">Edit Laser</div>
            <div className="space-y-3">
              <EquipmentCascadeFields cascade={cascade} labelClassName="label" idPrefix="my-eq-edit" />
              <div>
                <label className="label">Serial #</label>
                <input className="input" value={serial} onChange={(e) => setSerial(e.target.value)} />
              </div>
              <div>
                <label className="label">Manufacture date</label>
                <input className="input" type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Room / location</label>
                <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Treatment Room 2" />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div>
                <label className="label">Photo</label>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button type="button" className="btn btn-secondary flex-1" onClick={() => setEditOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary flex-[2]" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <button type="button" className="btn btn-secondary w-full mt-3 text-red-400" onClick={deleteLaser}>
              Delete laser
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
