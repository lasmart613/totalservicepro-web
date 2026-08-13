'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { listManufacturers, listModelsForManufacturer, OTHER_MODEL } from '@/lib/laser-catalog';
import { toast } from 'sonner';
import { canPostMarketplaceNeed, isPro, isSupplier, isOwnerish, isServiceCompany } from '@/lib/roles';

type ListingType = 'part' | 'consumable' | 'used' | 'request';

export const dynamic = 'force-dynamic';

type QtyBreak = { min_qty: string; unit_price: string };

function MarketplaceListContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [listingType, setListingType] = useState<ListingType>('part');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [userRole, setUserRole] = useState('');
  const [orgType, setOrgType] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<number | string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [enableBreaks, setEnableBreaks] = useState(false);
  const [breaks, setBreaks] = useState<QtyBreak[]>([
    { min_qty: '5', unit_price: '' },
    { min_qty: '10', unit_price: '' },
  ]);

  const [form, setForm] = useState({
    // shared / used
    title: '',
    description: '',
    price: '',
    priceType: 'fixed',
    condition: 'New',
    manufacturer: '',
    customManufacturer: '',
    model: '',
    customModel: '',
    serialNumber: '',
    yearManufactured: '',
    wavelength: '',
    totalSystemShots: '',
    headPulses: '',
    lampPulses: '',
    handpieceShots: '',
    lastPMDate: '',
    serviceNotes: '',
    reasonForSelling: '',
    includesAccessories: 'yes',
    fulfillment: 'either',
    shipCost: '',
    shipPolicy: '',
    city: '',
    state: '',
    // parts / consumables
    partNumber: '',
    sku: '',
    partCategory: 'Other',
    compatible: '',
    oemType: 'oem',
    warranty: '',
    quantity: '1',
    minOrder: '1',
    uom: 'each',
    freeShipOver: '',
    leadTime: '1–2 business days',
    shipMethod: '',
    localPickup: false,
    international: false,
    packSize: '',
    unitsPerCase: '',
    expiration: '',
    shelfLife: '',
    sterile: '',
    storage: '',
    // service request (inline → service_requests table)
    serviceType: 'Emergency Repair',
    urgency: 'Medium',
    preferredDate: '',
    errorCodes: '',
    customerSite: '',
    budget: '',
  });

  const set = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  useEffect(() => {
    const t = (searchParams.get('type') || '').toLowerCase();
    if (t === 'part' || t === 'parts') setListingType('part');
    else if (t === 'consumable' || t === 'consumables') setListingType('consumable');
    else if (t === 'used' || t === 'equipment') setListingType('used');
    else if (t === 'request' || t === 'service') setListingType('request');
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser();
      if (!user) return;
      const { data: profile } = await getSupabaseClient()
        .from('user_profiles')
        .select('organization_id, role, organizations(type, name, city, state)')
        .eq('id', user.id)
        .maybeSingle();
      setUserRole(profile?.role || '');
      setOrgId(profile?.organization_id ?? null);
      const org = (profile as any)?.organizations;
      setOrgType(org?.type || null);
      setOrgName(org?.name || '');
      if (org?.city) set('city', org.city);
      if (org?.state) set('state', org.state);

      if (!searchParams.get('type')) {
        if (isSupplier(profile?.role, org?.type)) setListingType('part');
        else if (isOwnerish(profile?.role, org?.type)) setListingType('request');
        else if (isServiceCompany(profile?.role, org?.type) || isPro(profile?.role)) setListingType('request');
      }
    })();
  }, [searchParams]);

  // Defaults when switching type
  useEffect(() => {
    if (listingType === 'used') {
      setForm((p) => ({ ...p, condition: p.condition === 'New' ? 'Good' : p.condition }));
    } else if (listingType === 'part' || listingType === 'consumable') {
      setForm((p) => ({
        ...p,
        condition: listingType === 'consumable' ? 'New sealed' : (p.condition === 'Good' ? 'New' : p.condition),
        partCategory: listingType === 'consumable' ? 'Coupling gel / medium' : (p.partCategory === 'Coupling gel / medium' ? 'Other' : p.partCategory),
      }));
    } else if (listingType === 'request') {
      const pro = isPro(userRole) || isServiceCompany(userRole, orgType);
      if (pro && !isOwnerish(userRole, orgType)) {
        setForm((p) => ({ ...p, serviceType: 'Subcontract Repair' }));
      }
    }
  }, [listingType, userRole, orgType]);

  const mfrOptions = useMemo(() => {
    const list = listManufacturers();
    return list.includes('Other') ? list : [...list, 'Other'];
  }, []);

  const modelOptions = useMemo(() => {
    if (!form.manufacturer || form.manufacturer === 'Other') return [];
    return listModelsForManufacturer(form.manufacturer);
  }, [form.manufacturer]);

  const showCustomMfr = form.manufacturer === 'Other';
  const showCustomModel = form.model === OTHER_MODEL || form.manufacturer === 'Other' || !modelOptions.length;

  const resolvedManufacturer = () => {
    if (form.manufacturer === 'Other') return form.customManufacturer.trim();
    return form.manufacturer.trim();
  };
  const resolvedModel = () => {
    if (form.model === OTHER_MODEL || form.manufacturer === 'Other' || !modelOptions.length) {
      return form.customModel.trim() || (form.model !== OTHER_MODEL ? form.model.trim() : '');
    }
    return form.model.trim();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    const left = 8 - images.length;
    const slice = files.slice(0, left);
    if (!slice.length) return;
    setImages((prev) => [...prev, ...slice]);
    slice.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => setPreviews((p) => [...p, String(reader.result || '')]);
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
    if (featuredIndex === index) setFeaturedIndex(0);
    else if (featuredIndex > index) setFeaturedIndex((f) => f - 1);
  };

  const uploadImages = async (userId: string): Promise<string[]> => {
    if (!images.length) return [];
    const urls: string[] = [];
    const ordered = images.map((f, i) => ({ f, i }));
    if (featuredIndex > 0 && featuredIndex < ordered.length) {
      const [feat] = ordered.splice(featuredIndex, 1);
      ordered.unshift(feat);
    }
    for (let n = 0; n < ordered.length; n++) {
      const file = ordered[n].f;
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${userId}/listings/${Date.now()}_${n}.${ext}`;
      const buckets = ['marketplace-images', 'equipment-photos', 'equipment'];
      let uploaded = false;
      for (const b of buckets) {
        const { error } = await getSupabaseClient().storage.from(b).upload(path, file, {
          upsert: true,
          contentType: file.type || `image/${ext}`,
        });
        if (!error) {
          const { data } = getSupabaseClient().storage.from(b).getPublicUrl(path);
          if (data?.publicUrl) {
            urls.push(data.publicUrl);
            uploaded = true;
            break;
          }
        }
      }
      if (!uploaded) console.warn('image upload failed', file.name);
    }
    return urls;
  };

  /** Best-effort: remember custom brand in manufacturers table for future dropdowns */
  async function rememberManufacturer(name: string) {
    if (!name || name === 'Other') return;
    try {
      await getSupabaseClient().from('manufacturers').upsert({ name }, { onConflict: 'name' });
    } catch {
      /* table may not exist / no unique constraint */
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser();
      if (!user?.id) {
        toast.error('You must be logged in');
        return;
      }

      // ── Service request (service_requests table) ─────────────────────
      if (listingType === 'request') {
        const pro = isPro(userRole) || isServiceCompany(userRole, orgType);
        const owner = isOwnerish(userRole, orgType);
        if (!owner && !pro && !canPostMarketplaceNeed(userRole, orgType)) {
          toast.error('You do not have permission to post service requests.');
          return;
        }
        if (!orgId) {
          toast.error('No organization linked to your profile.');
          return;
        }
        const mfr = resolvedManufacturer();
        const model = resolvedModel();
        if (!mfr || !model) {
          toast.error('Enter manufacturer and model (use Other to type a new brand or model).');
          return;
        }
        if (!form.description.trim()) {
          toast.error('Please describe the work needed.');
          return;
        }
        await rememberManufacturer(mfr);

        const isSub = pro && !owner;
        let description = form.description.trim();
        if (isSub && !description.startsWith('[Subcontract RFQ]')) {
          description = `[Subcontract RFQ] ${description}`;
        }
        if (form.customerSite.trim()) {
          description += `. Customer/site: ${form.customerSite.trim()}.`;
        }
        const budget = form.budget ? parseFloat(form.budget) : null;
        if (isSub && budget != null && !isNaN(budget)) {
          description += ` Sub pay budget: $${budget}.`;
        }
        const serviceType = form.serviceType || (isSub ? 'Subcontract Repair' : 'Emergency Repair');
        const title =
          (isSub && !/subcontract/i.test(serviceType) ? `Subcontract · ${serviceType}` : serviceType) +
          ': ' +
          [mfr, model].filter(Boolean).join(' ');

        const payload: any = {
          organization_id: orgId,
          posted_by: user.id,
          created_by: user.id,
          title,
          description,
          service_type: isSub && !/subcontract/i.test(serviceType) ? `Subcontract · ${serviceType}` : serviceType,
          model_type: model,
          manufacturer: mfr,
          model,
          serial_number: form.serialNumber.trim() || null,
          urgency: form.urgency || 'Medium',
          preferred_date: form.preferredDate || null,
          deadline: form.preferredDate || null,
          error_codes: form.errorCodes.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() ? form.state.trim().toUpperCase() : null,
          location: [form.city, form.state].filter(Boolean).join(', ') || null,
          status: 'open',
          category: 'service',
          budget_max: budget != null && !isNaN(budget) ? budget : null,
        };

        let { error } = await getSupabaseClient().from('service_requests').insert(payload);
        if (error) {
          const slim = {
            organization_id: orgId,
            posted_by: user.id,
            created_by: user.id,
            title,
            description,
            service_type: payload.service_type,
            model_type: model,
            manufacturer: mfr,
            model,
            urgency: payload.urgency,
            status: 'open',
            category: 'service',
          };
          const r2 = await getSupabaseClient().from('service_requests').insert(slim);
          if (r2.error) throw r2.error;
        }
        toast.success(isSub ? 'Subcontract RFQ posted' : 'Service request posted');
        router.push('/service-requests');
        return;
      }

      // ── Parts / consumables / used → marketplace_listings ────────────
      if (listingType === 'part' || listingType === 'consumable') {
        if (!isSupplier(userRole, orgType) && !isPro(userRole) && !canPostMarketplaceNeed(userRole, orgType) && !isServiceCompany(userRole, orgType)) {
          toast.error('You do not have permission to post parts listings.');
          return;
        }
        if (!form.partNumber.trim()) {
          toast.error('Part / catalog number is required.');
          return;
        }
        if (!form.title.trim()) {
          toast.error('Listing title is required.');
          return;
        }
        const brand = form.manufacturer === 'Other' ? form.customManufacturer.trim() : (form.manufacturer.trim() || form.customManufacturer.trim());
        if (!brand) {
          toast.error('Brand / manufacturer is required.');
          return;
        }
        if (!form.description.trim()) {
          toast.error('Description is required.');
          return;
        }
        const qty = parseInt(form.quantity, 10);
        if (!(qty > 0)) {
          toast.error('Quantity available must be at least 1.');
          return;
        }
        if (form.priceType !== 'contact') {
          const p = parseFloat(form.price);
          if (!(p >= 0) || isNaN(p)) {
            toast.error('Enter a unit price, or set price type to Contact for price.');
            return;
          }
        }
        await rememberManufacturer(brand);
      }

      if (listingType === 'used') {
        const mfr = resolvedManufacturer();
        const model = resolvedModel();
        if (!mfr || !model) {
          toast.error('Manufacturer and model are required (use Other to type new values).');
          return;
        }
        if (!form.description.trim()) {
          toast.error('Description is required.');
          return;
        }
        if (form.priceType !== 'contact') {
          const p = parseFloat(form.price);
          if (!(p > 0) || isNaN(p)) {
            toast.error('Enter an asking price, or set price type to Contact for price.');
            return;
          }
        }
        await rememberManufacturer(mfr);
      }

      const imageUrls = await uploadImages(user.id);
      const mfr = listingType === 'used' ? resolvedManufacturer() : (form.manufacturer === 'Other' ? form.customManufacturer.trim() : form.manufacturer.trim() || form.customManufacturer.trim());
      const model = listingType === 'used' ? resolvedModel() : (form.compatible.trim() || form.customModel.trim() || form.model.trim() || null);

      let computedTitle = form.title.trim();
      if (!computedTitle) {
        if (listingType === 'used') {
          computedTitle = [mfr, model, form.serialNumber ? `(S/N ${form.serialNumber})` : ''].filter(Boolean).join(' ');
        } else {
          computedTitle = form.partNumber || form.description.slice(0, 80) || 'Part for Sale';
        }
      }

      const qtyBreaks = enableBreaks
        ? breaks
            .map((b) => ({
              min_qty: parseInt(b.min_qty, 10),
              unit_price: parseFloat(b.unit_price),
            }))
            .filter((b) => b.min_qty > 1 && !isNaN(b.unit_price) && b.unit_price >= 0)
            .sort((a, b) => a.min_qty - b.min_qty)
        : [];

      const isCons = listingType === 'consumable';
      const qty = parseInt(form.quantity, 10) || 1;

      let details: any = { seller_org_name: orgName || null };
      if (listingType === 'part' || listingType === 'consumable') {
        details = {
          kind: isCons ? 'consumable' : 'part',
          sku: form.sku.trim() || null,
          part_category: form.partCategory || null,
          compatible_models: form.compatible.trim() || null,
          oem_type: isCons ? null : form.oemType,
          warranty: form.warranty.trim() || null,
          quantity_available: qty,
          min_order_qty: parseInt(form.minOrder, 10) || 1,
          unit_of_measure: form.uom || 'each',
          quantity_breaks: qtyBreaks,
          shipping: {
            cost: form.shipCost !== '' ? parseFloat(form.shipCost) : null,
            free_over: form.freeShipOver !== '' ? parseFloat(form.freeShipOver) : null,
            lead_time: form.leadTime || null,
            method: form.shipMethod.trim() || null,
            local_pickup: !!form.localPickup,
            international: !!form.international,
            policy: form.shipPolicy.trim() || null,
          },
          seller_org_name: orgName || null,
        };
        if (isCons) {
          details.pack_size = form.packSize.trim() || null;
          details.units_per_case = form.unitsPerCase ? parseFloat(form.unitsPerCase) : null;
          details.expiration = form.expiration || null;
          details.shelf_life = form.shelfLife.trim() || null;
          details.sterile = form.sterile || null;
          details.storage = form.storage.trim() || null;
        }
      } else if (listingType === 'used') {
        details = {
          kind: 'equipment',
          wavelength: form.wavelength.trim() || null,
          includes_accessories: form.includesAccessories,
          reason_for_selling: form.reasonForSelling.trim() || null,
          service_notes: form.serviceNotes.trim() || null,
          last_pm_date: form.lastPMDate || null,
          shot_counts: {
            system: form.totalSystemShots || null,
            head: form.headPulses || null,
            lamp: form.lampPulses || null,
            handpiece: form.handpieceShots || null,
          },
          shipping: {
            fulfillment: form.fulfillment,
            cost: form.shipCost !== '' ? parseFloat(form.shipCost) : null,
            policy: form.shipPolicy.trim() || null,
            local_pickup: form.fulfillment === 'pickup' || form.fulfillment === 'either',
          },
          seller_org_name: orgName || null,
        };
      }

      const payload: any = {
        listing_type: listingType === 'used' ? 'used' : isCons ? 'consumable' : 'part',
        category: listingType === 'used' ? 'equipment' : isCons ? 'consumables' : 'parts',
        title: computedTitle,
        manufacturer: mfr || null,
        model: model || null,
        serial_number: form.serialNumber.trim() || null,
        condition: form.condition || null,
        price: form.priceType === 'contact' ? null : form.price !== '' ? parseFloat(form.price) : null,
        price_type: form.priceType || 'fixed',
        description: form.description.trim(),
        notes: form.shipPolicy.trim() || form.reasonForSelling.trim() || form.serviceNotes.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() ? form.state.trim().toUpperCase() : null,
        images: imageUrls,
        photos: imageUrls,
        details,
        seller_id: user.id,
        created_by: user.id,
        organization_id: orgId,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (listingType === 'part' || listingType === 'consumable') {
        payload.part_number = form.partNumber.trim();
        payload.quantity = qty;
      }
      if (listingType === 'used') {
        payload.year_manufactured = form.yearManufactured ? parseInt(form.yearManufactured, 10) : null;
        payload.wavelength = form.wavelength.trim() || null;
      }

      let { error } = await getSupabaseClient().from('marketplace_listings').insert([payload]);
      if (error) {
        // progressive fallback without optional columns
        const core = { ...payload };
        delete core.details;
        delete core.listing_type;
        delete core.photos;
        delete core.quantity;
        delete core.part_number;
        delete core.organization_id;
        delete core.wavelength;
        delete core.year_manufactured;
        const r2 = await getSupabaseClient().from('marketplace_listings').insert([core]);
        if (r2.error) throw r2.error;
      }

      toast.success('Listing published!');
      if (listingType === 'used') router.push('/marketplace/used-systems');
      else if (isCons) router.push('/marketplace/consumables');
      else router.push('/marketplace/parts');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed: ' + (err?.message || 'Could not create listing'));
    } finally {
      setLoading(false);
    }
  };

  const partCategories = listingType === 'consumable'
    ? [
        'Coupling gel / medium', 'Disposable tip / spacer', 'Filter / window (consumable)',
        'Flashlamp (consumable stock)', 'Coolant / distilled water', 'Cryogen / gas',
        'Protective eyewear', 'Calibration target', 'Cleaning / disinfectant',
        'Tubing / disposable kit', 'Other consumable',
      ]
    : [
        'Optical / Handpiece', 'Flashlamp / Lamp', 'Power supply', 'Cooling / Chiller',
        'Control board / PCB', 'Fiber / Cable', 'Sensor / Detector', 'Filter / Window',
        'Pump / Flow', 'Housing / Cosmetic', 'Other',
      ];

  const conditionOptions =
    listingType === 'used'
      ? ['Excellent', 'Good', 'Fair', 'For parts', 'Refurbished']
      : listingType === 'consumable'
        ? ['New sealed', 'New open box', 'Near expiry', 'Expired (lab/training only)', 'Partial pack']
        : ['New', 'New open box', 'Refurbished', 'Used - Excellent', 'Used - Good', 'Used - Fair', 'For parts / as-is'];

  const isRequest = listingType === 'request';
  const isPartish = listingType === 'part' || listingType === 'consumable';
  const proPosting = (isPro(userRole) || isServiceCompany(userRole, orgType)) && !isOwnerish(userRole, orgType);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <Link href="/marketplace" className="text-sm text-[var(--gold)] hover:underline">← Marketplace</Link>
        <h1 className="text-3xl font-extrabold mt-1 mb-2">Post a Marketplace Listing</h1>
        <p className="text-sm text-[var(--text3)] mb-6">
          Each listing type uses a form tailored to that product — same structure as the Android app.
        </p>

        <div className="flex flex-wrap gap-2 mb-8">
          {[
            { key: 'part' as const, label: 'Parts for Sale' },
            { key: 'consumable' as const, label: 'Consumables' },
            { key: 'used' as const, label: 'Used Laser' },
            { key: 'request' as const, label: proPosting ? 'Subcontract RFQ' : 'Service Request' },
          ].map((type) => (
            <button
              key={type.key}
              type="button"
              onClick={() => setListingType(type.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                listingType === type.key ? 'bg-[var(--gold)] text-black' : 'bg-[var(--surface3)]'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── PHOTOS (sales only) ── */}
          {!isRequest && (
            <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Photos</h3>
              <p className="text-xs text-[var(--text3)]">Up to 8 photos. First / starred photo is the cover.</p>
              <div className="flex flex-wrap gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button type="button" className="absolute top-0.5 right-0.5 bg-black/70 text-white w-5 h-5 rounded-full text-xs" onClick={() => removeImage(i)}>×</button>
                    <button
                      type="button"
                      className={`absolute bottom-0 left-0 right-0 text-[9px] font-bold py-0.5 ${i === featuredIndex ? 'bg-[var(--gold)] text-black' : 'bg-black/60 text-white'}`}
                      onClick={() => setFeaturedIndex(i)}
                    >
                      {i === featuredIndex ? 'COVER' : 'Set cover'}
                    </button>
                  </div>
                ))}
                {images.length < 8 && (
                  <label className="w-20 h-20 rounded-lg border border-dashed border-[var(--border)] flex items-center justify-center text-2xl text-[var(--text3)] cursor-pointer hover:border-[var(--gold)]">
                    +
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
                  </label>
                )}
              </div>
            </section>
          )}

          {/* ── PARTS / CONSUMABLES ── */}
          {isPartish && (
            <>
              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">
                  {listingType === 'consumable' ? 'Consumable identity' : 'Part identity'}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">{listingType === 'consumable' ? 'Product / catalog # *' : 'Part number / OEM # *'}</label>
                    <input className="input" value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} placeholder="e.g. 7122-00-1234" required />
                  </div>
                  <div>
                    <label className="label">Your SKU</label>
                    <input className="input" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Listing title *</label>
                  <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Candela GentleMax Pro Flashlamp" required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Brand / manufacturer *</label>
                    <input className="input" list="brandList" value={form.manufacturer === 'Other' ? form.customManufacturer : form.manufacturer} onChange={(e) => {
                      const v = e.target.value;
                      if (mfrOptions.includes(v)) {
                        setForm((p) => ({ ...p, manufacturer: v, customManufacturer: v === 'Other' ? p.customManufacturer : '' }));
                      } else {
                        setForm((p) => ({ ...p, manufacturer: 'Other', customManufacturer: v }));
                      }
                    }} placeholder="Type brand or pick from list" required />
                    <datalist id="brandList">
                      {mfrOptions.map((m) => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="label">{listingType === 'consumable' ? 'Consumable type' : 'Part category'}</label>
                    <select className="input" value={form.partCategory} onChange={(e) => set('partCategory', e.target.value)}>
                      {partCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Compatible systems / models</label>
                  <input className="input" value={form.compatible} onChange={(e) => set('compatible', e.target.value)} placeholder="Comma-separated models" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Condition *</label>
                    <select className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                      {conditionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {listingType === 'part' && (
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
                  )}
                  <div>
                    <label className="label">{listingType === 'consumable' ? 'Lot / batch #' : 'Serial / lot #'}</label>
                    <input className="input" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">{listingType === 'consumable' ? 'Return / freshness' : 'Warranty'}</label>
                    <input className="input" value={form.warranty} onChange={(e) => set('warranty', e.target.value)} placeholder="e.g. 90 days" />
                  </div>
                </div>

                {listingType === 'consumable' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[var(--border)] pt-3">
                    <div>
                      <label className="label">Pack / unit size</label>
                      <input className="input" value={form.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder="e.g. 1 L bottle, box of 50" />
                    </div>
                    <div>
                      <label className="label">Units per case</label>
                      <input className="input" type="number" min={1} value={form.unitsPerCase} onChange={(e) => set('unitsPerCase', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Expiration / best-by</label>
                      <input className="input" type="date" value={form.expiration} onChange={(e) => set('expiration', e.target.value)} />
                    </div>
                    <div>
                      <label className="label">Shelf life</label>
                      <input className="input" value={form.shelfLife} onChange={(e) => set('shelfLife', e.target.value)} placeholder="e.g. 24 months unopened" />
                    </div>
                    <div>
                      <label className="label">Sterile / sealed</label>
                      <select className="input" value={form.sterile} onChange={(e) => set('sterile', e.target.value)}>
                        <option value="">Not specified</option>
                        <option value="sterile_sealed">Sterile, factory sealed</option>
                        <option value="sealed">Sealed (non-sterile)</option>
                        <option value="opened">Opened / partial</option>
                        <option value="n_a">N/A</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Storage</label>
                      <input className="input" value={form.storage} onChange={(e) => set('storage', e.target.value)} placeholder="Room temp / refrigerate" />
                    </div>
                  </div>
                )}

                <div>
                  <label className="label">Description *</label>
                  <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} required
                    placeholder={listingType === 'consumable' ? 'Pack contents, storage, restrictions…' : 'What it is, what’s included, condition notes…'} />
                </div>
              </section>

              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Quantity & pricing</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="label">Qty available *</label>
                    <input className="input" type="number" min={1} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required />
                  </div>
                  <div>
                    <label className="label">Min order qty</label>
                    <input className="input" type="number" min={1} value={form.minOrder} onChange={(e) => set('minOrder', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Unit of measure</label>
                    <select className="input" value={form.uom} onChange={(e) => set('uom', e.target.value)}>
                      <option value="each">Each</option>
                      <option value="pair">Pair</option>
                      <option value="set">Set</option>
                      <option value="box">Box</option>
                      <option value="pack">Pack</option>
                      <option value="case">Case</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Unit price (USD) *</label>
                    <input className="input" type="number" min={0} step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} disabled={form.priceType === 'contact'} />
                  </div>
                  <div>
                    <label className="label">Price type</label>
                    <select className="input" value={form.priceType} onChange={(e) => set('priceType', e.target.value)}>
                      <option value="fixed">Fixed price</option>
                      <option value="obo">Or best offer (OBO)</option>
                      <option value="contact">Contact for price</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                  <input type="checkbox" checked={enableBreaks} onChange={(e) => setEnableBreaks(e.target.checked)} />
                  Offer quantity discounts
                </label>
                {enableBreaks && (
                  <div className="space-y-2">
                    {breaks.map((b, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div>
                          <label className="label">Min qty</label>
                          <input className="input" type="number" min={2} value={b.min_qty} onChange={(e) => {
                            const next = [...breaks]; next[i] = { ...next[i], min_qty: e.target.value }; setBreaks(next);
                          }} />
                        </div>
                        <div>
                          <label className="label">Unit price ($)</label>
                          <input className="input" type="number" min={0} step="0.01" value={b.unit_price} onChange={(e) => {
                            const next = [...breaks]; next[i] = { ...next[i], unit_price: e.target.value }; setBreaks(next);
                          }} />
                        </div>
                        <button type="button" className="btn btn-secondary text-sm mb-0.5" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}>Remove</button>
                      </div>
                    ))}
                    {breaks.length < 5 && (
                      <button type="button" className="btn btn-secondary text-sm" onClick={() => setBreaks([...breaks, { min_qty: '', unit_price: '' }])}>+ Add discount tier</button>
                    )}
                  </div>
                )}
              </section>

              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Shipping & fulfillment</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Shipping cost (USD)</label>
                    <input className="input" type="number" min={0} step="0.01" value={form.shipCost} onChange={(e) => set('shipCost', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Free shipping over ($)</label>
                    <input className="input" type="number" min={0} value={form.freeShipOver} onChange={(e) => set('freeShipOver', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Ships from city</label>
                    <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">State</label>
                    <input className="input" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Lead time</label>
                    <select className="input" value={form.leadTime} onChange={(e) => set('leadTime', e.target.value)}>
                      <option>Same day</option>
                      <option>1–2 business days</option>
                      <option>3–5 business days</option>
                      <option>1–2 weeks</option>
                      <option>2–4 weeks</option>
                      <option>Made to order</option>
                      <option>Contact seller</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Shipping method notes</label>
                    <input className="input" value={form.shipMethod} onChange={(e) => set('shipMethod', e.target.value)} placeholder="UPS Ground, freight…" />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.localPickup} onChange={(e) => set('localPickup', e.target.checked)} /> Local pickup available</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.international} onChange={(e) => set('international', e.target.checked)} /> International shipping</label>
                <div>
                  <label className="label">Shipping policy</label>
                  <textarea className="input min-h-[70px]" value={form.shipPolicy} onChange={(e) => set('shipPolicy', e.target.value)} placeholder="Returns, packaging, insurance…" />
                </div>
              </section>
            </>
          )}

          {/* ── USED LASER ── */}
          {listingType === 'used' && (
            <>
              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Laser identity</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Manufacturer *</label>
                    <select className="input" value={form.manufacturer} onChange={(e) => {
                      setForm((p) => ({ ...p, manufacturer: e.target.value, model: '', customModel: e.target.value === 'Other' ? p.customModel : '' }));
                    }} required>
                      <option value="">Select…</option>
                      {mfrOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {showCustomMfr && (
                      <input className="input mt-2" value={form.customManufacturer} onChange={(e) => set('customManufacturer', e.target.value)} placeholder="Type manufacturer name (e.g. new IPL brand)" required />
                    )}
                  </div>
                  <div>
                    <label className="label">Model *</label>
                    {!showCustomMfr && modelOptions.length > 0 ? (
                      <>
                        <select className="input" value={form.model} onChange={(e) => set('model', e.target.value)} required>
                          <option value="">Select model…</option>
                          {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                          <option value={OTHER_MODEL}>Other / not listed…</option>
                        </select>
                        {form.model === OTHER_MODEL && (
                          <input className="input mt-2" value={form.customModel} onChange={(e) => set('customModel', e.target.value)} placeholder="Type model name" required />
                        )}
                      </>
                    ) : (
                      <input className="input" value={form.customModel} onChange={(e) => set('customModel', e.target.value)} placeholder="Type model name" required />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Serial number</label>
                    <input className="input" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Year manufactured</label>
                    <input className="input" type="number" min={1990} max={2035} value={form.yearManufactured} onChange={(e) => set('yearManufactured', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Wavelength / medium</label>
                  <input className="input" value={form.wavelength} onChange={(e) => set('wavelength', e.target.value)} placeholder="e.g. IPL 500–1200 nm" />
                </div>
              </section>

              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Condition & pricing</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Condition *</label>
                    <select className="input" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                      {conditionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Asking price (USD)</label>
                    <input className="input" type="number" min={0} value={form.price} onChange={(e) => set('price', e.target.value)} disabled={form.priceType === 'contact'} />
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
                    <label className="label">Includes handpieces / accessories?</label>
                    <select className="input" value={form.includesAccessories} onChange={(e) => set('includesAccessories', e.target.value)}>
                      <option value="yes">Yes — listed in description</option>
                      <option value="partial">Partial / some</option>
                      <option value="no">No — base unit only</option>
                    </select>
                  </div>
                </div>
              </section>

              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Pulse / shot counts</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div><label className="label">System total</label><input className="input" value={form.totalSystemShots} onChange={(e) => set('totalSystemShots', e.target.value)} /></div>
                  <div><label className="label">Head / resonator</label><input className="input" value={form.headPulses} onChange={(e) => set('headPulses', e.target.value)} /></div>
                  <div><label className="label">Flashlamp</label><input className="input" value={form.lampPulses} onChange={(e) => set('lampPulses', e.target.value)} /></div>
                  <div><label className="label">Handpiece</label><input className="input" value={form.handpieceShots} onChange={(e) => set('handpieceShots', e.target.value)} /></div>
                </div>
              </section>

              <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">Service history & location</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div><label className="label">Last PM date</label><input className="input" type="date" value={form.lastPMDate} onChange={(e) => set('lastPMDate', e.target.value)} /></div>
                  <div><label className="label">Reason for selling</label><input className="input" value={form.reasonForSelling} onChange={(e) => set('reasonForSelling', e.target.value)} /></div>
                  <div><label className="label">City</label><input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
                  <div><label className="label">State</label><input className="input" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
                  <div>
                    <label className="label">Fulfillment</label>
                    <select className="input" value={form.fulfillment} onChange={(e) => set('fulfillment', e.target.value)}>
                      <option value="pickup">Buyer pickup only</option>
                      <option value="freight">Seller arranges freight</option>
                      <option value="either">Pickup or freight</option>
                      <option value="included">Delivery / install included</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Est. freight (USD)</label>
                    <input className="input" type="number" min={0} value={form.shipCost} onChange={(e) => set('shipCost', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="label">Service history notes</label>
                  <textarea className="input min-h-[60px]" value={form.serviceNotes} onChange={(e) => set('serviceNotes', e.target.value)} />
                </div>
                <div>
                  <label className="label">Shipping / pickup notes</label>
                  <textarea className="input min-h-[60px]" value={form.shipPolicy} onChange={(e) => set('shipPolicy', e.target.value)} />
                </div>
                <div>
                  <label className="label">Listing title (optional)</label>
                  <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Auto from make/model if blank" />
                </div>
                <div>
                  <label className="label">Full description *</label>
                  <textarea className="input min-h-[100px]" value={form.description} onChange={(e) => set('description', e.target.value)} required />
                </div>
              </section>
            </>
          )}

          {/* ── SERVICE REQUEST / SUBCONTRACT RFQ ── */}
          {isRequest && (
            <section className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
              <h3 className="font-semibold text-[var(--gold)] uppercase text-sm tracking-wide">
                {proPosting ? 'Subcontract RFQ' : 'Service request'}
              </h3>
              <p className="text-xs text-[var(--text3)]">
                {proPosting
                  ? 'Post overflow work for other service companies to bid. Use Other to add a make/model not in the catalog (e.g. a new IPL).'
                  : 'Describe the work needed. Service companies can bid. Use Other to type a manufacturer or model not listed yet.'}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Manufacturer *</label>
                  <select
                    className="input"
                    value={form.manufacturer}
                    onChange={(e) => setForm((p) => ({
                      ...p,
                      manufacturer: e.target.value,
                      model: '',
                      customModel: '',
                      customManufacturer: e.target.value === 'Other' ? p.customManufacturer : '',
                    }))}
                    required
                  >
                    <option value="">Select brand…</option>
                    {mfrOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {showCustomMfr && (
                    <input
                      className="input mt-2"
                      value={form.customManufacturer}
                      onChange={(e) => set('customManufacturer', e.target.value)}
                      placeholder="Type manufacturer (e.g. new IPL brand)"
                      required
                    />
                  )}
                </div>
                <div>
                  <label className="label">Model *</label>
                  {!showCustomMfr && modelOptions.length > 0 ? (
                    <>
                      <select className="input" value={form.model} onChange={(e) => set('model', e.target.value)} required>
                        <option value="">Select model…</option>
                        {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value={OTHER_MODEL}>Other / not listed…</option>
                      </select>
                      {(form.model === OTHER_MODEL) && (
                        <input className="input mt-2" value={form.customModel} onChange={(e) => set('customModel', e.target.value)} placeholder="Type model name" required />
                      )}
                    </>
                  ) : (
                    <input className="input" value={form.customModel} onChange={(e) => set('customModel', e.target.value)} placeholder="Type model name" required />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Serial #</label>
                  <input className="input" value={form.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
                </div>
                {proPosting && (
                  <div>
                    <label className="label">Customer / site (optional)</label>
                    <input className="input" value={form.customerSite} onChange={(e) => set('customerSite', e.target.value)} placeholder="Clinic name" />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Service type</label>
                  <select className="input" value={form.serviceType} onChange={(e) => set('serviceType', e.target.value)}>
                    {proPosting && <option value="Subcontract Repair">Subcontract Repair</option>}
                    <option value="Emergency Repair">Emergency Repair</option>
                    <option value="PM">PM</option>
                    <option value="Install / Commission">Install / Commission</option>
                    <option value="Calibration">Calibration</option>
                    <option value="Full Contract">Full Contract</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">Urgency</label>
                  <select className="input" value={form.urgency} onChange={(e) => set('urgency', e.target.value)}>
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="label">Preferred date</label>
                  <input className="input" type="date" value={form.preferredDate} onChange={(e) => set('preferredDate', e.target.value)} />
                </div>
                <div>
                  <label className="label">Error codes</label>
                  <input className="input" value={form.errorCodes} onChange={(e) => set('errorCodes', e.target.value)} />
                </div>
                {proPosting && (
                  <div>
                    <label className="label">Sub pay budget (optional)</label>
                    <input className="input" type="number" min={0} value={form.budget} onChange={(e) => set('budget', e.target.value)} placeholder="What you can pay a sub" />
                  </div>
                )}
                <div>
                  <label className="label">City</label>
                  <input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
                </div>
                <div>
                  <label className="label">State</label>
                  <input className="input" maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">Description *</label>
                <textarea
                  className="input min-h-[120px]"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  required
                  placeholder={proPosting
                    ? 'Scope of work, symptoms, access notes, what you need the subcontractor to do…'
                    : 'Symptoms, timeline, access notes…'}
                />
              </div>
              <p className="text-xs text-[var(--text3)]">
                Prefer the dedicated flow?{' '}
                <Link href="/service-requests" className="text-[var(--gold)] underline">Open Service Requests</Link>
              </p>
            </section>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 text-lg font-extrabold">
            {loading
              ? 'Submitting…'
              : isRequest
                ? (proPosting ? 'Post Subcontract RFQ' : 'Post Service Request')
                : listingType === 'used'
                  ? 'Publish Equipment Listing'
                  : listingType === 'consumable'
                    ? 'Publish Consumable Listing'
                    : 'Publish Part Listing'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function MarketplaceList() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading form…</div>}>
      <MarketplaceListContent />
    </Suspense>
  );
}
