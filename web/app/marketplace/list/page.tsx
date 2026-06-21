'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MODELS, buildManufacturers } from '@/lib/models';
import { toast } from 'sonner';

type ListingType = 'part' | 'used' | 'request';

// Force dynamic to avoid prerender errors
export const dynamic = 'force-dynamic';

function MarketplaceListContent() {
  const searchParams = useSearchParams();
  const [listingType, setListingType] = useState<ListingType>('part');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [locations, setLocations] = useState<any[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);

  // Pre-select type from ?type= query
  useEffect(() => {
    const t = searchParams.get('type') as ListingType | null;
    if (t && ['part', 'used', 'request'].includes(t)) {
      setListingType(t);
    }
  }, [searchParams]);

  const [formData, setFormData] = useState({
    description: '',
    price: '',
    partNumber: '',
    condition: 'New',
    quantity: '1',
    manufacturer: '',
    customManufacturer: '',
    model: '',
    serialNumber: '',
    yearManufactured: '',
    wavelength: '',
    totalSystemShots: '',
    headPulses: '',
    lampPulses: '',
    handpieceShots: '',
    lastPMDate: '',
    dyeKitSN: '',
    dyePulses: '',
    dyeKitReplacementDate: '',
    hvFinal: '',
    hv60J: '',
    hv90J: '',
    lampCurrentAlex: '',
    lampCurrentYag: '',
    fiberTransmission: '',
    reasonForSelling: '',
    additionalNotes: '',
    urgency: 'Medium',
    preferredDate: '',
    errorCodes: '',
    location_id: '',
    street: '',
    city: '',
    state: '',
    zip: '',
  });

  const showCustomManufacturer = formData.manufacturer === 'Other';

  const laserManufacturers = useMemo(() => {
    const mfgs = Object.values(MODELS).map(m => m.mfg);
    return [...new Set(mfgs), 'Other'].sort();
  }, []);

  const laserModels = useMemo(() => {
    if (!formData.manufacturer || formData.manufacturer === 'Other') {
      return Object.keys(MODELS);
    }
    return Object.entries(MODELS)
      .filter(([_, def]) => def.mfg === formData.manufacturer)
      .map(([key]) => key);
  }, [formData.manufacturer]);

  const modelKey = formData.model;
  const mfgKey = formData.manufacturer;
  const isDyePDL = /vbeam|perfecta|dye|pdl|gentle.*dye/i.test(`${modelKey} ${mfgKey}`);
  const isGentleLASE = /gentlelase|alex|755/i.test(`${modelKey} ${mfgKey}`);
  const isGentleYAG = /gentleyag|yag.*gentle/i.test(`${modelKey} ${mfgKey}`);
  const isGMAX = /gmax|gentlemax/i.test(`${modelKey} ${mfgKey}`);
  const isSciton = /sciton/i.test(`${mfgKey}`);
  const showDyeFields = isDyePDL;
  const showVBeamHV = /vbeam|perfecta/i.test(modelKey);
  const showGentleLASEHV = isGentleLASE;
  const showGentleYAGHV = isGentleYAG;
  const showGMAXCurrents = isGMAX;

  // Fetch locations
  useEffect(() => {
    const fetchLocations = async () => {
      const { data: { user } } = await getSupabaseClient().auth.getUser();
      if (!user) return;

      const { data: profile } = await getSupabaseClient()
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (profile?.organization_id) {
        const { data: locs } = await getSupabaseClient()
          .from('locations')
          .select('*')
          .eq('organization_id', profile.organization_id)
          .order('is_primary', { ascending: false });

        setLocations(locs || []);
        const primary = locs?.find((l: any) => l.is_primary);
        if (primary) setFormData(prev => ({ ...prev, location_id: primary.id }));
      }
    };
    fetchLocations();
  }, []);

  // Fetch manufacturers from parts_catalog
  useEffect(() => {
    const fetchManufacturers = async () => {
      const { data, error } = await getSupabaseClient()
        .from('parts_catalog')
        .select('brand')
        .not('brand', 'is', null);

      if (!error && data) {
        const unique = [...new Set(data.map((d: any) => d.brand).filter(Boolean))].sort();
        setManufacturers([...unique, 'Other']);
      }
    };
    fetchManufacturers();
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleManufacturerChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      manufacturer: value,
      customManufacturer: value === 'Other' ? prev.customManufacturer : '',
      model: '',
    }));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setImages(prev => [...prev, ...Array.from(e.target.files as FileList)]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const uploadImages = async (userId: string): Promise<string[]> => {
    if (images.length === 0) return [];
    const urls: string[] = [];
    for (const file of images) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${userId}/listings/${fileName}`;
      const { error } = await getSupabaseClient().storage.from('marketplace-images').upload(filePath, file);
      if (!error) {
        const { data } = getSupabaseClient().storage.from('marketplace-images').getPublicUrl(filePath);
        if (data?.publicUrl) urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await getSupabaseClient().auth.getUser();
      if (!user?.id) {
        toast.error('You must be logged in to create a listing');
        setLoading(false);
        return;
      }

      const imageUrls = await uploadImages(user.id);

      if (imageUrls.length > 1 && featuredIndex > 0) {
        const featured = imageUrls.splice(featuredIndex, 1)[0];
        imageUrls.unshift(featured);
      }

      const finalManufacturer = formData.manufacturer === 'Other' 
        ? formData.customManufacturer 
        : formData.manufacturer;

      let computedTitle = '';
      if (listingType === 'part') {
        computedTitle = formData.partNumber || formData.description?.substring(0, 80) || 'Part for Sale';
      } else if (listingType === 'used') {
        computedTitle = [finalManufacturer, formData.model, formData.serialNumber ? `(S/N ${formData.serialNumber})` : '']
          .filter(Boolean).join(' ').trim();
        if (!computedTitle) computedTitle = formData.description?.substring(0, 80) || 'Used Laser System';
      } else {
        computedTitle = formData.description?.substring(0, 80) || 'Service Request';
      }

      let tableName = 'marketplace_listings';
      let payload: any = {
        listing_type: listingType,
        title: computedTitle,
        manufacturer: finalManufacturer,
        model: formData.model,
        serial_number: formData.serialNumber,
        condition: formData.condition,
        price: formData.price ? parseFloat(formData.price) : null,
        images: imageUrls,
        description: formData.description,
        notes: formData.additionalNotes || formData.reasonForSelling,
        seller_id: user.id,
        created_by: user.id,
        created_at: new Date().toISOString(),
      };

      if (listingType === 'part') {
        payload = {
          ...payload,
          part_number: formData.partNumber,
          quantity: parseInt(formData.quantity) || 1,
          qty: parseInt(formData.quantity) || 1,
          details: {
            ...formData,
            manufacturer: finalManufacturer,
            images: imageUrls,
          },
        };
      }

      if (listingType === 'used') {
        payload = {
          ...payload,
          year_manufactured: formData.yearManufactured ? parseInt(formData.yearManufactured, 10) : null,
          details: {
            wavelength: formData.wavelength,
            shot_counts: {
              system: formData.totalSystemShots,
              head: formData.headPulses,
              lamp: formData.lampPulses,
              handpiece: formData.handpieceShots,
            },
            performance_data: {
              last_pm_date: formData.lastPMDate,
              dye_kit_sn: formData.dyeKitSN,
              dye_pulses: formData.dyePulses,
              dye_replacement_date: formData.dyeKitReplacementDate,
              hv_final: formData.hvFinal,
              hv_60j: formData.hv60J,
              hv_90j: formData.hv90J,
              lamp_current_alex: formData.lampCurrentAlex,
              lamp_current_yag: formData.lampCurrentYag,
              fiber_transmission: formData.fiberTransmission,
            },
          },
        };
      }

      if (listingType === 'request') {
        tableName = 'marketplace_requests';
        const requestTitle = formData.description.substring(0, 80) || 'Service Request';
        payload = {
          title: requestTitle,
          description: formData.description,
          urgency: formData.urgency,
          preferred_date: formData.preferredDate || null,
          error_codes: formData.errorCodes,
          location_id: formData.location_id || null,
          manufacturer: finalManufacturer,
          model: formData.model,
          serial_number: formData.serialNumber,
          images: imageUrls,
          created_by: user.id,
          created_at: new Date().toISOString(),
        };
      }

      const { error } = await getSupabaseClient().from(tableName).insert(payload);
      if (error) throw error;

      toast.success('Listing created successfully!');
      setFormData({
        description: '', price: '', partNumber: '', condition: 'New', quantity: '1',
        manufacturer: '', customManufacturer: '', model: '', serialNumber: '',
        yearManufactured: '', wavelength: '', totalSystemShots: '', headPulses: '', lampPulses: '', handpieceShots: '',
        lastPMDate: '', dyeKitSN: '', dyePulses: '', dyeKitReplacementDate: '',
        hvFinal: '', hv60J: '', hv90J: '', lampCurrentAlex: '', lampCurrentYag: '', fiberTransmission: '',
        reasonForSelling: '', additionalNotes: '',
        urgency: 'Medium', preferredDate: '', errorCodes: '', location_id: '',
        street: '', city: '', state: '', zip: '',
      });
      setImages([]);

    } catch (err: any) {
      toast.error('Failed to create listing: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-2xl mx-auto w-full px-4 py-8">
        <h1 className="text-3xl font-extrabold mb-6">Post a Marketplace Listing</h1>

        <div className="flex gap-2 mb-8">
          {[
            { key: 'part', label: 'Part for Sale' },
            { key: 'used', label: 'Used Laser System' },
            { key: 'request', label: 'Service Request' },
          ].map((type) => (
            <button
              key={type.key}
              onClick={() => setListingType(type.key as ListingType)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                listingType === type.key ? 'bg-[var(--gold)] text-black' : 'bg-[var(--surface3)]'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* USED LASER SYSTEM */}
          {listingType === 'used' && (
            <div className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
              <h3 className="font-semibold text-[var(--gold)]">Used Laser System Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Make / Manufacturer</label>
                  <select
                    className="select"
                    value={formData.manufacturer}
                    onChange={e => handleManufacturerChange(e.target.value)}
                    required
                  >
                    <option value="">Select Make</option>
                    {laserManufacturers.map(mfr => (
                      <option key={mfr} value={mfr}>{mfr}</option>
                    ))}
                  </select>
                  {showCustomManufacturer && (
                    <input
                      className="input mt-2"
                      placeholder="Enter custom manufacturer"
                      value={formData.customManufacturer}
                      onChange={e => handleInputChange('customManufacturer', e.target.value)}
                    />
                  )}
                </div>

                <div>
                  <label className="label">Model</label>
                  <select
                    className="select"
                    value={formData.model}
                    onChange={e => handleInputChange('model', e.target.value)}
                    required
                  >
                    <option value="">Select Model</option>
                    {laserModels.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Wavelength / Lasing Medium</label>
                <input
                  className="input"
                  value={formData.wavelength || (MODELS[formData.model]?.wavelengths?.[0]?.name ?? '')}
                  onChange={e => handleInputChange('wavelength', e.target.value)}
                  placeholder="e.g. 10600 nm (CO₂)"
                />
              </div>

              {/* ... rest of your used system form (keep exactly as you had it) ... */}

              <div>
                <label className="label">Description</label>
                <textarea 
                  className="input min-h-[80px]" 
                  value={formData.description} 
                  onChange={e => handleInputChange('description', e.target.value)} 
                />
              </div>

              {!(formData.model?.toLowerCase().includes('co2') || formData.model?.toLowerCase().includes('acupulse') || (formData.wavelength || '').includes('10600') || (formData.wavelength || '').includes('10,600') || (formData.wavelength || '').toLowerCase().includes('co2')) && (
                <div>
                  <label className="label">Pulse / Shot Counts</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                    <div><input className="input" placeholder="System Total" value={formData.totalSystemShots} onChange={e => handleInputChange('totalSystemShots', e.target.value)} /></div>
                    <div><input className="input" placeholder="Head / Resonator" value={formData.headPulses} onChange={e => handleInputChange('headPulses', e.target.value)} /></div>
                    <div><input className="input" placeholder="Lamp Pulses" value={formData.lampPulses} onChange={e => handleInputChange('lampPulses', e.target.value)} /></div>
                    <div><input className="input" placeholder="Handpiece(s)" value={formData.handpieceShots} onChange={e => handleInputChange('handpieceShots', e.target.value)} /></div>
                  </div>
                </div>
              )}

              {/* Add all your other used system fields here (maintenance, etc.) */}
            </div>
          )}

          {/* PART FOR SALE */}
          {listingType === 'part' && (
            <div className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
              <h3 className="font-semibold text-[var(--gold)]">Part Details</h3>
              {/* Your part form fields */}
            </div>
          )}

          {/* SERVICE REQUEST */}
          {listingType === 'request' && (
            <>
              {/* Your service request form fields */}
            </>
          )}

          {/* Price + Image Upload (common) */}
          {(listingType === 'part' || listingType === 'used') && (
            <div>
              <label className="label">Asking Price (USD)</label>
              <input type="number" className="input" value={formData.price} onChange={e => handleInputChange('price', e.target.value)} />
            </div>
          )}

          <div>
            <label className="label mb-2">Upload Images (optional)</label>
            <input type="file" multiple accept="image/*" onChange={handleImageSelect} className="block w-full" />
            {/* Image preview code */}
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 text-lg">
            {loading ? 'Submitting...' : 'Submit Listing'}
          </button>
        </form>
      </div>
    </div>
  );
}

// Wrap with Suspense to fix the useSearchParams() error
export default function MarketplaceList() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading form...</div>}>
      <MarketplaceListContent />
    </Suspense>
  );
}