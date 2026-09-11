'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { marketplaceAuthHeaders } from '@/lib/marketplace/client-auth';
import {
  isPartListing,
  listingImages,
  partsDetailPath,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { listManufacturers } from '@/lib/laser-catalog';
import { toast } from 'sonner';

const PART_CATEGORIES = [
  'Optical / Handpiece',
  'Flashlamp / Lamp',
  'Power supply',
  'Cooling / Chiller',
  'Control board / PCB',
  'Fiber / Cable',
  'Sensor / Detector',
  'Filter / Window',
  'Pump / Flow',
  'Housing / Cosmetic',
  'Other',
];

const CONDITIONS = [
  'New',
  'New open box',
  'Refurbished',
  'Used - Excellent',
  'Used - Good',
  'Used - Fair',
  'For parts / as-is',
];

type FormState = {
  title: string;
  description: string;
  partNumber: string;
  sku: string;
  manufacturer: string;
  partCategory: string;
  compatible: string;
  condition: string;
  oemType: string;
  serialNumber: string;
  warranty: string;
  quantity: string;
  price: string;
  priceType: string;
  city: string;
  state: string;
};

function emptyForm(): FormState {
  return {
    title: '',
    description: '',
    partNumber: '',
    sku: '',
    manufacturer: '',
    partCategory: 'Other',
    compatible: '',
    condition: 'New',
    oemType: 'oem',
    serialNumber: '',
    warranty: '',
    quantity: '1',
    price: '',
    priceType: 'fixed',
    city: '',
    state: '',
  };
}

function formFromListing(listing: MarketplaceListingLike & Record<string, unknown>): FormState {
  const details = listing.details && typeof listing.details === 'object' ? listing.details : {};
  const shipping =
    details.shipping && typeof details.shipping === 'object'
      ? (details.shipping as Record<string, unknown>)
      : {};
  return {
    title: String(listing.title || ''),
    description: String(listing.description || ''),
    partNumber: String(listing.part_number || ''),
    sku: details.sku != null ? String(details.sku) : '',
    manufacturer: String(listing.manufacturer || ''),
    partCategory: details.part_category != null ? String(details.part_category) : 'Other',
    compatible:
      details.compatible_models != null
        ? String(details.compatible_models)
        : String(listing.model || ''),
    condition: String(listing.condition || 'New'),
    oemType: details.oem_type != null ? String(details.oem_type) : 'oem',
    serialNumber: String(listing.serial_number || ''),
    warranty: details.warranty != null ? String(details.warranty) : '',
    quantity: String(listing.quantity ?? listing.qty ?? details.quantity_available ?? '1'),
    price: listing.price != null && listing.price !== '' ? String(listing.price) : '',
    priceType: String(listing.price_type || 'fixed'),
    city: String(listing.city || (shipping.city != null ? shipping.city : '') || ''),
    state: String(listing.state || ''),
  };
}

export default function EditPartListingPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<string>('active');
  const [form, setForm] = useState<FormState>(emptyForm());
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);

  const mfrOptions = useMemo(() => {
    const list = listManufacturers();
    return list.includes('Other') ? list : [...list, 'Other'];
  }, []);

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const allPreviews = [...existingImages, ...newPreviews];

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const headers = await marketplaceAuthHeaders();
        const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'no-store',
          headers,
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (!res.ok || !json?.listing || !isPartListing(json.listing)) {
          setNotFound(true);
          return;
        }
        if (json.can_manage === false) {
          setForbidden(true);
          return;
        }
        setForm(formFromListing(json.listing));
        setExistingImages(listingImages(json.listing));
        setStatus(String(json.listing.status || 'active'));
        setFeaturedIndex(0);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    const left = 8 - existingImages.length - newFiles.length;
    const slice = files.slice(0, left);
    if (!slice.length) return;
    setNewFiles((prev) => [...prev, ...slice]);
    slice.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setNewPreviews((p) => [...p, String(reader.result || '')]);
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePreview = (index: number) => {
    if (index < existingImages.length) {
      setExistingImages((prev) => prev.filter((_, i) => i !== index));
    } else {
      const ni = index - existingImages.length;
      setNewFiles((prev) => prev.filter((_, i) => i !== ni));
      setNewPreviews((prev) => prev.filter((_, i) => i !== ni));
    }
    if (featuredIndex === index) setFeaturedIndex(0);
    else if (featuredIndex > index) setFeaturedIndex((f) => f - 1);
  };

  const uploadNewImages = async (userId: string): Promise<string[]> => {
    if (!newFiles.length) return [];
    const urls: string[] = [];
    for (let n = 0; n < newFiles.length; n++) {
      const file = newFiles[n];
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${userId}/listings/${Date.now()}_${n}.${ext}`;
      for (const bucket of ['marketplace-images', 'equipment-photos', 'equipment']) {
        const { error } = await getSupabaseClient().storage.from(bucket).upload(path, file, {
          upsert: true,
          contentType: file.type || `image/${ext}`,
        });
        if (!error) {
          const { data } = getSupabaseClient().storage.from(bucket).getPublicUrl(path);
          if (data?.publicUrl) {
            urls.push(data.publicUrl);
            break;
          }
        }
      }
    }
    return urls;
  };

  const orderedImages = (uploaded: string[]) => {
    const merged = [...existingImages, ...uploaded];
    if (featuredIndex > 0 && featuredIndex < merged.length) {
      const [feat] = merged.splice(featuredIndex, 1);
      merged.unshift(feat);
    }
    return merged;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Listing title is required.');
      return;
    }
    if (!form.partNumber.trim()) {
      toast.error('Part / catalog number is required.');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Description is required.');
      return;
    }
    const qty = parseInt(form.quantity, 10);
    if (!(qty >= 0) || Number.isNaN(qty)) {
      toast.error('Quantity must be a number.');
      return;
    }
    if (form.priceType !== 'contact') {
      const p = parseFloat(form.price);
      if (!(p >= 0) || Number.isNaN(p)) {
        toast.error('Enter a unit price, or set price type to Contact for price.');
        return;
      }
    }
    setSaving(true);
    try {
      const { data: auth } = await getSupabaseClient().auth.getUser();
      const uploaded = auth.user?.id ? await uploadNewImages(auth.user.id) : [];
      const images = orderedImages(uploaded);
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          part_number: form.partNumber,
          manufacturer: form.manufacturer,
          model: form.compatible,
          condition: form.condition,
          serial_number: form.serialNumber,
          quantity: qty,
          price: form.priceType === 'contact' ? null : form.price,
          price_type: form.priceType,
          city: form.city,
          state: form.state,
          images,
          status: status === 'removed' ? 'active' : undefined,
          details: {
            sku: form.sku.trim() || null,
            part_category: form.partCategory || null,
            compatible_models: form.compatible.trim() || null,
            oem_type: form.oemType,
            warranty: form.warranty.trim() || null,
            quantity_available: qty,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || 'Could not save listing');
        return;
      }
      toast.success(status === 'removed' ? 'Listing updated and relisted' : 'Listing updated');
      router.push(partsDetailPath(id));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save listing');
    } finally {
      setSaving(false);
    }
  };

  const removeListing = async () => {
    if (!confirm('Remove this listing from the public marketplace? Past orders stay in history.')) {
      return;
    }
    setRemoving(true);
    try {
      const headers = await marketplaceAuthHeaders();
      const res = await fetch(`/api/marketplace/parts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || 'Could not remove listing');
        return;
      }
      toast.success('Listing removed from the marketplace');
      router.push('/marketplace/my-listings');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not remove listing');
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center text-[var(--text3)]">Loading listing…</div>
      </div>
    );
  }

  if (forbidden || notFound) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-xl mx-auto w-full px-4 py-12 text-center">
          <h1 className="text-2xl font-bold mb-3">
            {forbidden ? 'You cannot edit this listing' : 'Listing not found'}
          </h1>
          <p className="text-[var(--text3)] mb-6">
            {forbidden
              ? 'Only the owning seller or an admin of that supplier organization can change it.'
              : 'This part listing may have been removed.'}
          </p>
          <Link href="/marketplace/my-listings" className="btn btn-primary">
            Back to My Listings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href={partsDetailPath(id)} className="text-sm text-[var(--gold)] hover:underline">
          ← Back to listing
        </Link>
        <h1 className="text-3xl font-extrabold mt-1 mb-2">Edit part listing</h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          Changes go live on the public marketplace. Remove unpublishes the listing without deleting order history.
        </p>
        {status === 'removed' && (
          <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-900/20 text-amber-200 text-sm">
            This listing is currently removed from the public marketplace. Saving will relist it as active.
          </div>
        )}

        <form onSubmit={save} className="space-y-6">
          <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Photos</h3>
            <p className="text-xs text-[var(--text3)]">Up to 8 photos. First / starred photo is the cover.</p>
            <div className="flex flex-wrap gap-2">
              {allPreviews.map((src, i) => (
                <div key={`${src}-${i}`} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    className="absolute top-0.5 right-0.5 bg-black/70 text-white w-5 h-5 rounded-full text-xs"
                    onClick={() => removePreview(i)}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className={`absolute bottom-0 left-0 right-0 text-[9px] font-bold py-0.5 ${
                      i === featuredIndex ? 'bg-[var(--gold)] text-black' : 'bg-black/60 text-white'
                    }`}
                    onClick={() => setFeaturedIndex(i)}
                  >
                    {i === featuredIndex ? 'COVER' : 'Set cover'}
                  </button>
                </div>
              ))}
              {allPreviews.length < 8 && (
                <label className="w-20 h-20 rounded-lg border border-dashed border-[var(--border)] flex items-center justify-center text-2xl text-[var(--text3)] cursor-pointer hover:border-[var(--gold)]">
                  +
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                </label>
              )}
            </div>
          </section>

          <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
            <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Part identity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Part number / OEM # *</label>
                <input className="input" value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} required />
              </div>
              <div>
                <label className="label">Your SKU</label>
                <input className="input" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Listing title *</label>
              <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} required />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Brand / manufacturer</label>
                <input
                  className="input"
                  list="brandList"
                  value={form.manufacturer}
                  onChange={(e) => set('manufacturer', e.target.value)}
                />
                <datalist id="brandList">
                  {mfrOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label">Part category</label>
                <select className="input" value={form.partCategory} onChange={(e) => set('partCategory', e.target.value)}>
                  {PART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {form.partCategory && !PART_CATEGORIES.includes(form.partCategory) && (
                    <option value={form.partCategory}>{form.partCategory}</option>
                  )}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Compatible systems / models</label>
              <input className="input" value={form.compatible} onChange={(e) => set('compatible', e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Condition</label>
                <select className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {form.condition && !CONDITIONS.includes(form.condition) && (
                    <option value={form.condition}>{form.condition}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="label">OEM vs aftermarket</label>
                <select className="input" value={form.oemType} onChange={(e) => set('oemType', e.target.value)}>
                  <option value="oem">OEM / genuine</option>
                  <option value="oem_compatible">OEM-compatible</option>
                  <option value="aftermarket">Aftermarket</option>
                  <option value="refurbished_oem">Refurbished OEM</option>
                  <option value="unknown">Not specified</option>
                </select>
              </div>
              <div>
                <label className="label">Serial / lot #</label>
                <input className="input" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
              </div>
              <div>
                <label className="label">Warranty</label>
                <input className="input" value={form.warranty} onChange={(e) => set('warranty', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Description *</label>
              <textarea
                className="input min-h-[100px]"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                required
              />
            </div>
          </section>

          <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
            <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Quantity & pricing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Qty available</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Price type</label>
                <select className="input" value={form.priceType} onChange={(e) => set('priceType', e.target.value)}>
                  <option value="fixed">Fixed price</option>
                  <option value="obo">Or best offer (OBO)</option>
                  <option value="contact">Contact for price</option>
                </select>
              </div>
              <div>
                <label className="label">Unit price (USD)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  disabled={form.priceType === 'contact'}
                  onChange={(e) => set('price', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Ships from (city / state)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="City" />
                  <input
                    className="input"
                    maxLength={2}
                    value={form.state}
                    onChange={(e) => set('state', e.target.value)}
                    placeholder="ST"
                  />
                </div>
              </div>
            </div>
          </section>

          <div className="flex flex-col sm:flex-row gap-3">
            <button type="submit" className="btn btn-primary flex-1" disabled={saving || removing}>
              {saving ? 'Saving…' : status === 'removed' ? 'Save and relist' : 'Save changes'}
            </button>
            <button
              type="button"
              className="btn btn-secondary text-red-400"
              disabled={saving || removing || status === 'removed'}
              onClick={removeListing}
            >
              {removing ? 'Removing…' : 'Remove listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
