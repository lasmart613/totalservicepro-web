'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { listManufacturers } from '@/lib/laser-catalog';
import {
  AddVendorModal,
  PART_CATEGORIES,
  PART_UNITS,
} from '@/components/AddPartModal';

type PartRow = Record<string, any>;
type VendorRow = {
  id: number | string;
  part_id?: number | string;
  vendor_name?: string | null;
  vendor_part_number?: string | null;
  unit_cost?: number | string | null;
  lead_time_days?: number | null;
  url?: string | null;
  notes?: string | null;
  is_preferred?: boolean | null;
};

function money(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

function gallery(part: PartRow): string[] {
  const urls: string[] = [];
  if (part.image_url) urls.push(String(part.image_url));
  const extra = part.image_urls;
  if (Array.isArray(extra)) {
    extra.forEach((u) => {
      if (u && !urls.includes(String(u))) urls.push(String(u));
    });
  }
  return urls;
}

export default function PartDetailPage() {
  const params = useParams();
  const partId = params.id as string;
  const supabase = getSupabaseClient();
  const brands = useMemo(() => [...listManufacturers(), 'Generic/Other'], []);

  const [part, setPart] = useState<PartRow | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVendor, setShowVendor] = useState(false);
  const [showVendors, setShowVendors] = useState(false);
  const [hero, setHero] = useState(0);
  const [form, setForm] = useState<PartRow>({});
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('parts_catalog').select('*').eq('id', partId).maybeSingle();
      if (error) throw error;
      setPart(data);
      setForm(data || {});
      setHero(0);
      if (data?.id != null) {
        const { data: vrows } = await supabase
          .from('part_vendors')
          .select('*')
          .eq('part_id', data.id)
          .order('is_preferred', { ascending: false });
        setVendors((vrows || []) as VendorRow[]);
      } else {
        setVendors([]);
      }
    } catch (e: any) {
      console.error('part detail', e);
      toast.error(e?.message || 'Could not load part');
      setPart(null);
    } finally {
      setLoading(false);
    }
  }, [partId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  const photos = gallery(part || {});

  function setField(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadNewPhotos(userId: string): Promise<string[]> {
    const urls: string[] = [];
    const buckets = ['marketplace-images', 'equipment-photos', 'equipment', 'logos'];
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `parts/${userId}/${Date.now()}_${i}.${ext}`;
      for (const bucket of buckets) {
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          upsert: true,
          contentType: file.type || `image/${ext}`,
        });
        if (!error) {
          const { data } = supabase.storage.from(bucket).getPublicUrl(path);
          if (data?.publicUrl) {
            urls.push(data.publicUrl);
            break;
          }
        }
      }
    }
    return urls;
  }

  async function saveEdit() {
    if (!part?.id) return;
    if (!String(form.name || '').trim() || !String(form.part_number || '').trim()) {
      toast.error('Name and part number are required.');
      return;
    }
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uploaded = user ? await uploadNewPhotos(user.id) : [];
      const existing = gallery(form);
      const images = uploaded.length ? [...uploaded, ...existing] : existing;
      const modelsRaw = Array.isArray(form.compatible_models)
        ? form.compatible_models
        : String(form.compatible_models_text || form.compatible_models || '')
            .split(',')
            .map((m: string) => m.trim())
            .filter(Boolean);

      const payload: Record<string, unknown> = {
        name: String(form.name || '').trim(),
        part_number: String(form.part_number || '').trim(),
        brand: String(form.brand || '').trim() || null,
        manufacturer: String(form.brand || '').trim() || null,
        description: String(form.description || '').trim() || null,
        category: String(form.category || '').trim() || null,
        unit_of_measure: String(form.unit_of_measure || '').trim() || null,
        compatible_models: modelsRaw.length ? modelsRaw : null,
        is_consumable: !!form.is_consumable,
        is_active: form.is_active !== false,
        sale_price:
          form.sale_price === '' || form.sale_price == null ? null : Number(form.sale_price),
        image_url: images[0] || null,
        image_urls: images.length ? images : null,
        updated_at: new Date().toISOString(),
      };

      let lastError: { message?: string } | null = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { error } = await supabase.from('parts_catalog').update(payload).eq('id', part.id);
        if (!error) {
          lastError = null;
          break;
        }
        lastError = error;
        const col = missingColumn(error.message);
        if (col && col in payload) {
          delete payload[col];
          continue;
        }
        break;
      }
      if (lastError) throw new Error(lastError.message || 'Save failed');
      toast.success('Part updated.');
      setEditing(false);
      setImageFiles([]);
      previews.forEach((u) => URL.revokeObjectURL(u));
      setPreviews([]);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function removeVendor(id: number | string) {
    if (!confirm('Remove this vendor from the part?')) return;
    const { error } = await supabase.from('part_vendors').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setVendors((rows) => rows.filter((v) => String(v.id) !== String(id)));
    toast.success('Vendor removed.');
  }

  async function markPreferred(id: number | string) {
    await supabase.from('part_vendors').update({ is_preferred: false }).eq('part_id', partId);
    const { error } = await supabase.from('part_vendors').update({ is_preferred: true }).eq('id', id);
    if (error) toast.error(error.message);
    else await load();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-5xl mx-auto w-full px-4 py-16 text-[var(--text3)]">Loading part…</div>
      </div>
    );
  }

  if (!part) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-5xl mx-auto w-full px-4 py-16 text-center">
          <p className="text-xl mb-4">Part not found</p>
          <Link href="/parts" className="btn btn-primary">
            Back to catalog
          </Link>
        </div>
      </div>
    );
  }

  const modelsText = Array.isArray(form.compatible_models)
    ? form.compatible_models.join(', ')
    : String(form.compatible_models || '');

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <Link href="/parts" className="text-sm text-[var(--gold)] hover:underline">
              ← Parts Catalog
            </Link>
            <h1 className="text-3xl font-extrabold mt-1">{part.name}</h1>
            <p className="text-[var(--text3)]">
              {part.part_number}
              {part.brand ? ` • ${part.brand}` : ''}
              {part.category ? ` • ${part.category}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setShowVendors((v) => !v)}>
              {showVendors ? 'Hide vendors' : 'Show vendors'}
            </button>
            {!editing ? (
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                Edit part
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setForm(part);
                    setImageFiles([]);
                    previews.forEach((u) => URL.revokeObjectURL(u));
                    setPreviews([]);
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={saving} onClick={saveEdit}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="card overflow-hidden hover:transform-none p-0">
            {photos[hero] || previews[0] ? (
              <img src={previews[0] || photos[hero]} alt={part.name} className="w-full h-72 object-contain bg-[var(--surface3)]" />
            ) : (
              <div className="w-full h-72 bg-[var(--surface3)] flex items-center justify-center text-5xl font-extrabold text-[var(--gold)]/40">
                {(part.brand || part.name || 'P').toString().charAt(0).toUpperCase()}
              </div>
            )}
            {photos.length > 1 && (
              <div className="flex gap-2 p-3 overflow-x-auto">
                {photos.map((src, i) => (
                  <button key={src} type="button" onClick={() => setHero(i)} className="shrink-0">
                    <img
                      src={src}
                      alt=""
                      className={`h-14 w-14 object-cover rounded border ${i === hero ? 'border-[var(--gold)]' : 'border-[var(--border)]'}`}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 hover:transform-none space-y-3">
            {!editing ? (
              <>
                <div>
                  <div className="text-xs text-[var(--text3)]">Sale price</div>
                  <div className="text-2xl font-extrabold text-[var(--gold)]">
                    {money(part.sale_price ?? part.unit_cost)}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{part.description || 'No description yet.'}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-[var(--text3)]">Unit</dt>
                  <dd>{part.unit_of_measure || 'Each'}</dd>
                  <dt className="text-[var(--text3)]">Consumable</dt>
                  <dd>{part.is_consumable ? 'Yes' : 'No'}</dd>
                  <dt className="text-[var(--text3)]">Status</dt>
                  <dd>{part.is_active === false ? 'Inactive' : 'Active'}</dd>
                  <dt className="text-[var(--text3)]">Models</dt>
                  <dd className="col-span-1">
                    {Array.isArray(part.compatible_models) && part.compatible_models.length
                      ? part.compatible_models.join(', ')
                      : '—'}
                  </dd>
                </dl>
              </>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Part number</label>
                    <input className="input" value={form.part_number || ''} onChange={(e) => setField('part_number', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Brand</label>
                    <select className="select" value={form.brand || ''} onChange={(e) => setField('brand', e.target.value)}>
                      <option value="">Select…</option>
                      {brands.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Name</label>
                  <input className="input" value={form.name || ''} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input" rows={3} value={form.description || ''} onChange={(e) => setField('description', e.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Category</label>
                    <select className="select" value={form.category || ''} onChange={(e) => setField('category', e.target.value)}>
                      <option value="">Select…</option>
                      {PART_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Unit</label>
                    <select className="select" value={form.unit_of_measure || 'Each'} onChange={(e) => setField('unit_of_measure', e.target.value)}>
                      {PART_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Sale price</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.sale_price ?? form.unit_cost ?? ''}
                      onChange={(e) => setField('sale_price', e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Compatible models</label>
                  <input className="input" value={modelsText} onChange={(e) => setField('compatible_models', e.target.value.split(',').map((m) => m.trim()).filter(Boolean))} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.is_consumable} onChange={(e) => setField('is_consumable', e.target.checked)} />
                  Consumable
                </label>
                <div>
                  <label className="label">Add photos</label>
                  <input
                    className="input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []).slice(0, 6);
                      previews.forEach((u) => URL.revokeObjectURL(u));
                      setImageFiles(files);
                      setPreviews(files.map((f) => URL.createObjectURL(f)));
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 hover:transform-none">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-bold">Vendors</h2>
            <div className="flex gap-2">
              {vendors.length > 0 && (
                <button type="button" className="btn btn-secondary text-sm" onClick={() => setShowVendors((v) => !v)}>
                  {showVendors ? 'Hide vendors' : 'Show vendors'}
                </button>
              )}
              <button type="button" className="btn btn-secondary text-sm" onClick={() => setShowVendor(true)}>
                + Add vendor
              </button>
            </div>
          </div>
          {vendors.length === 0 ? (
            <p className="text-sm text-[var(--text3)]">No vendors yet. Add every source you buy this from.</p>
          ) : !showVendors ? (
            <p className="text-sm text-[var(--text3)]">
              {vendors.length} vendor{vendors.length === 1 ? '' : 's'} on file. Names and costs are hidden.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text3)] border-b border-[var(--border)]">
                    <th className="py-2 pr-3">Vendor</th>
                    <th className="py-2 pr-3">P/N</th>
                    <th className="py-2 pr-3">Vendor cost</th>
                    <th className="py-2 pr-3">Lead</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={String(v.id)} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-3">
                        {v.is_preferred ? '⭐ ' : ''}
                        {v.url ? (
                          <a href={v.url} target="_blank" rel="noreferrer" className="text-[var(--gold)] hover:underline">
                            {v.vendor_name}
                          </a>
                        ) : (
                          v.vendor_name
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{v.vendor_part_number || '—'}</td>
                      <td className="py-2 pr-3 text-[var(--gold)] font-semibold">{money(v.unit_cost)}</td>
                      <td className="py-2 pr-3">{v.lead_time_days != null ? `${v.lead_time_days}d` : '—'}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {!v.is_preferred && (
                          <button type="button" className="text-xs text-[var(--gold)] mr-3" onClick={() => markPreferred(v.id)}>
                            Preferred
                          </button>
                        )}
                        <button type="button" className="text-xs text-red-400" onClick={() => removeVendor(v.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showVendors && vendors.some((v) => v.notes) && (
            <div className="mt-3 text-xs text-[var(--text3)] space-y-1">
              {vendors.filter((v) => v.notes).map((v) => (
                <div key={`n-${v.id}`}>
                  <span className="font-semibold">{v.vendor_name}:</span> {v.notes}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showVendor && (
        <AddVendorModal
          partId={part.id}
          partLabel={`${part.part_number || ''} — ${part.name || ''}`.trim()}
          onClose={() => setShowVendor(false)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}
