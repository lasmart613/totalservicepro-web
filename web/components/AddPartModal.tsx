'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getSupabaseClient } from '@/lib/supabase/client';
import { listManufacturers } from '@/lib/laser-catalog';

export const PART_CATEGORIES = [
  'Optical Components',
  'Handpiece Components',
  'Cooling System',
  'Electronics/Boards',
  'Power Supplies',
  'Mechanical/Frame',
  'Consumables',
  'Other',
] as const;

export const PART_UNITS = ['Each', 'Pair', 'Set', 'Box', 'Foot', 'Roll'] as const;

export type VendorDraft = {
  key: string;
  vendor_name: string;
  vendor_part_number: string;
  unit_cost: string;
  lead_time_days: string;
  url: string;
  notes: string;
  is_preferred: boolean;
};

export function emptyVendor(preferred = false): VendorDraft {
  return {
    key: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    vendor_name: '',
    vendor_part_number: '',
    unit_cost: '',
    lead_time_days: '',
    url: '',
    notes: '',
    is_preferred: preferred,
  };
}

type SupplierOpt = { id: number | string; name: string };

type Props = {
  onClose: () => void;
  onCreated: (partId: number | string) => void;
};

function missingColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export function AddVendorModal({
  partId,
  partLabel,
  onClose,
  onSaved,
}: {
  partId: number | string;
  partLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = getSupabaseClient();
  const [vendor, setVendor] = useState<VendorDraft>(emptyVendor(false));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vendor.vendor_name.trim()) {
      toast.error('Vendor name is required.');
      return;
    }
    setSaving(true);
    try {
      const row: Record<string, unknown> = {
        part_id: partId,
        vendor_name: vendor.vendor_name.trim(),
        vendor_part_number: vendor.vendor_part_number.trim() || null,
        unit_cost: vendor.unit_cost.trim() ? Number(vendor.unit_cost) : null,
        lead_time_days: vendor.lead_time_days.trim() ? parseInt(vendor.lead_time_days, 10) : null,
        url: vendor.url.trim() || null,
        notes: vendor.notes.trim() || null,
        is_preferred: vendor.is_preferred,
        currency: 'USD',
        is_active: true,
      };
      let { error } = await supabase.from('part_vendors').insert(row);
      if (error && missingColumn(error.message) && missingColumn(error.message)! in row) {
        delete row[missingColumn(error.message)!];
        ({ error } = await supabase.from('part_vendors').insert(row));
      }
      if (error) throw error;
      toast.success('Vendor added.');
      onSaved();
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add vendor');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5 hover:transform-none" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-[var(--gold)] mb-1">Add vendor</h2>
        <p className="text-xs text-[var(--text3)] mb-3">{partLabel}</p>
        <div className="space-y-2">
          <input className="input" value={vendor.vendor_name} onChange={(e) => setVendor({ ...vendor, vendor_name: e.target.value })} placeholder="Vendor name *" />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" value={vendor.vendor_part_number} onChange={(e) => setVendor({ ...vendor, vendor_part_number: e.target.value })} placeholder="Vendor P/N" />
            <input className="input" type="number" min="0" step="0.01" value={vendor.unit_cost} onChange={(e) => setVendor({ ...vendor, unit_cost: e.target.value })} placeholder="Vendor cost USD" />
            <input className="input" type="number" min="0" value={vendor.lead_time_days} onChange={(e) => setVendor({ ...vendor, lead_time_days: e.target.value })} placeholder="Lead days" />
            <input className="input" value={vendor.url} onChange={(e) => setVendor({ ...vendor, url: e.target.value })} placeholder="https://…" />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={vendor.is_preferred} onChange={(e) => setVendor({ ...vendor, is_preferred: e.target.checked })} />
            Preferred
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn btn-secondary flex-1" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary flex-1" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save vendor'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddPartModal({ onClose, onCreated }: Props) {
  const supabase = getSupabaseClient();
  const brands = useMemo(() => [...listManufacturers(), 'Generic/Other'], []);
  const [partNumber, setPartNumber] = useState('');
  const [brand, setBrand] = useState('');
  const [brandOther, setBrandOther] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [unit, setUnit] = useState('Each');
  const [models, setModels] = useState('');
  const [consumable, setConsumable] = useState(false);
  const [salePrice, setSalePrice] = useState('');
  const [vendors, setVendors] = useState<VendorDraft[]>([emptyVendor(true)]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .in('type', ['parts_supplier', 'supplier', 'vendor'])
        .order('name')
        .limit(200);
      setSuppliers((data || []).filter((o: any) => o?.name).map((o: any) => ({ id: o.id, name: o.name })));
    })();
  }, [supabase]);

  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [previews]);

  function onPickImages(files: FileList | null) {
    if (!files?.length) return;
    const next: File[] = [];
    const urls: string[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is over 5 MB`);
        continue;
      }
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
        toast.error(`${file.name} is not an image`);
        continue;
      }
      next.push(file);
      urls.push(URL.createObjectURL(file));
    }
    previews.forEach((url) => URL.revokeObjectURL(url));
    setImageFiles(next);
    setPreviews(urls);
  }

  function updateVendor(key: string, patch: Partial<VendorDraft>) {
    setVendors((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function uploadImages(userId: string): Promise<string[]> {
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

  async function handleSave() {
    if (saving) return;
    const pn = partNumber.trim();
    const resolvedBrand = (brand === 'Generic/Other' ? brandOther : brand).trim();
    const partName = name.trim();
    if (!pn || !resolvedBrand || !partName || !category) {
      toast.error('Part number, brand, name, and category are required.');
      return;
    }
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in to add a part.');

      const imageUrls = await uploadImages(user.id);
      const compatible = models
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);

      const payload: Record<string, unknown> = {
        part_number: pn,
        brand: resolvedBrand,
        manufacturer: resolvedBrand,
        name: partName,
        description: description.trim() || partName,
        category,
        unit_of_measure: unit,
        compatible_models: compatible.length ? compatible : null,
        is_consumable: consumable || category === 'Consumables',
        is_active: true,
        created_by: user.id,
        image_url: imageUrls[0] || null,
        image_urls: imageUrls.length ? imageUrls : null,
        sale_price: salePrice.trim() ? Number(salePrice) : null,
      };

      let created: { id: number | string } | null = null;
      let lastError: { message?: string } | null = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data, error } = await supabase
          .from('parts_catalog')
          .insert(payload)
          .select('id')
          .single();
        if (!error && data?.id != null) {
          created = data;
          lastError = null;
          break;
        }
        lastError = error;
        const col = missingColumn(error?.message);
        if (col && col in payload) {
          delete payload[col];
          continue;
        }
        break;
      }
      if (!created) throw new Error(lastError?.message || 'Could not save part');

      const filledVendors = vendors.filter((v) => v.vendor_name.trim());

      for (const v of filledVendors) {
        const row: Record<string, unknown> = {
          part_id: created.id,
          vendor_name: v.vendor_name.trim(),
          vendor_part_number: v.vendor_part_number.trim() || null,
          unit_cost: v.unit_cost.trim() ? Number(v.unit_cost) : null,
          lead_time_days: v.lead_time_days.trim() ? parseInt(v.lead_time_days, 10) : null,
          url: v.url.trim() || null,
          notes: v.notes.trim() || null,
          is_preferred: v.is_preferred,
          currency: 'USD',
          is_active: true,
        };
        let { error } = await supabase.from('part_vendors').insert(row);
        if (error && missingColumn(error.message) && missingColumn(error.message)! in row) {
          delete row[missingColumn(error.message)!];
          ({ error } = await supabase.from('part_vendors').insert(row));
        }
        if (error) console.warn('vendor insert', error.message);
      }

      toast.success('Part added to the catalog.');
      onCreated(created.id);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to add part');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/60 p-3 sm:p-4"
      onClick={onClose}
    >
      <div className="flex min-h-full items-start sm:items-center justify-center">
        <div
          className="card w-full max-w-2xl flex flex-col p-0 hover:transform-none"
          style={{ maxHeight: 'calc(100dvh - 1.5rem)', minHeight: 0, overflow: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-part-title"
        >
          <div className="flex justify-between items-center px-5 pt-4 pb-3 shrink-0 border-b border-[var(--border)]">
            <div>
              <h2 id="add-part-title" className="text-lg font-extrabold text-[var(--gold)]">
                Add Part
              </h2>
              <p className="text-xs text-[var(--text3)] mt-0.5">
                Catalog entry with photo, sale price, and one or more vendors.
              </p>
            </div>
            <button type="button" className="text-2xl leading-none text-[var(--text3)]" onClick={onClose}>
              ×
            </button>
          </div>

          <div
            className="px-5 py-4 space-y-3"
            style={{ overflowY: 'auto', minHeight: 0, flex: '1 1 auto' }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Part number *</label>
                <input className="input" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="e.g. CAN-HP-003" />
              </div>
              <div>
                <label className="label">Brand *</label>
                <select className="select" value={brand} onChange={(e) => setBrand(e.target.value)}>
                  <option value="">Select…</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {brand === 'Generic/Other' && (
                  <input className="input mt-2" value={brandOther} onChange={(e) => setBrandOther(e.target.value)} placeholder="Brand name" />
                )}
              </div>
            </div>
            <div>
              <label className="label">Name *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Short descriptive name" />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Category *</label>
                <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
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
                <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
                  {PART_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Sale price (USD)</label>
                <input className="input" type="number" min="0" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="0.00" />
                <p className="text-[10px] text-[var(--text3)] mt-1">What you charge. Hidden on the catalog until you show prices.</p>
              </div>
            </div>
            <div>
              <label className="label">Compatible models (comma separated)</label>
              <input className="input" value={models} onChange={(e) => setModels(e.target.value)} placeholder="GentleMax Pro, GentleLASE" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={consumable} onChange={(e) => setConsumable(e.target.checked)} />
              Consumable
            </label>

            <div>
              <label className="label">Photos</label>
              <input
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={(e) => onPickImages(e.target.files)}
              />
              {previews.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {previews.map((src) => (
                    <img key={src} src={src} alt="" className="h-20 w-20 object-cover rounded-lg border border-[var(--border)]" />
                  ))}
                </div>
              )}
              <p className="text-[10px] text-[var(--text3)] mt-1">Up to 6 images, 5 MB each. First photo is the catalog thumbnail.</p>
            </div>

            <div className="border-t border-[var(--border)] pt-3">
              <div className="flex justify-between items-center mb-2">
                <div className="font-bold text-sm">Vendors</div>
                <button
                  type="button"
                  className="text-sm text-[var(--gold)]"
                  onClick={() => setVendors((rows) => [...rows, emptyVendor(rows.length === 0)])}
                >
                  + Add vendor
                </button>
              </div>
              <p className="text-[10px] text-[var(--text3)] mb-2">
                Add every source you buy this from. Vendor cost is what you pay that supplier — separate from sale
                price, and hidden until you show prices.
              </p>
              {vendors.map((v, idx) => (
                <div key={v.key} className="rounded-lg border border-[var(--border)] p-3 mb-2 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[var(--text3)]">Vendor {idx + 1}</span>
                    {vendors.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-red-400"
                        onClick={() => setVendors((rows) => rows.filter((row) => row.key !== v.key))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    className="input"
                    list="part-supplier-names"
                    value={v.vendor_name}
                    onChange={(e) => updateVendor(v.key, { vendor_name: e.target.value })}
                    placeholder="Vendor name *"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" value={v.vendor_part_number} onChange={(e) => updateVendor(v.key, { vendor_part_number: e.target.value })} placeholder="Vendor P/N" />
                    <input className="input" type="number" min="0" step="0.01" value={v.unit_cost} onChange={(e) => updateVendor(v.key, { unit_cost: e.target.value })} placeholder="Vendor cost USD" />
                    <input className="input" type="number" min="0" value={v.lead_time_days} onChange={(e) => updateVendor(v.key, { lead_time_days: e.target.value })} placeholder="Lead time (days)" />
                    <input className="input" value={v.url} onChange={(e) => updateVendor(v.key, { url: e.target.value })} placeholder="https://…" />
                  </div>
                  <input className="input" value={v.notes} onChange={(e) => updateVendor(v.key, { notes: e.target.value })} placeholder="Notes" />
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={v.is_preferred}
                      onChange={(e) =>
                        setVendors((rows) =>
                          rows.map((row) => ({
                            ...row,
                            is_preferred: row.key === v.key ? e.target.checked : e.target.checked ? false : row.is_preferred,
                          }))
                        )
                      }
                    />
                    Preferred vendor
                  </label>
                </div>
              ))}
              <datalist id="part-supplier-names">
                {suppliers.map((s) => (
                  <option key={String(s.id)} value={s.name} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex gap-2 px-5 py-4 border-t border-[var(--border)] shrink-0">
            <button type="button" className="btn btn-secondary flex-1" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save part'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
