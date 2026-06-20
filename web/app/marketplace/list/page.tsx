'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MODELS, buildManufacturers } from '@/lib/models';
import { toast } from 'sonner';

type ListingType = 'part' | 'used' | 'request';

export default function MarketplaceList() {
  const [listingType, setListingType] = useState<ListingType>('part');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const supabase = getSupabaseClient();

  const [formData, setFormData] = useState({
    // Common
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
    // Used system specific counts
    totalSystemShots: '',
    headPulses: '',
    lampPulses: '',
    handpieceShots: '',
    lastPMDate: '',
    // Dye / PDL specific
    dyeKitSN: '',
    dyePulses: '',
    dyeKitReplacementDate: '',
    // Model-specific HV / calibration
    hvFinal: '',           // VBeam / Perfecta
    hv60J: '',             // GentleLASE family
    hv90J: '',             // GentleYAG family
    lampCurrentAlex: '',   // GMAX / GentleMax Alex
    lampCurrentYag: '',    // GMAX / GentleMax YAG
    fiberTransmission: '',
    // Other
    reasonForSelling: '',
    additionalNotes: '',
    // Request only
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

  // Laser system manufacturers & models from shared MODELS (for Used Systems)
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

  // Conditional visibility helpers for model-specific fields
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (profile?.organization_id) {
        const { data: locs } = await supabase
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
  }, [supabase]);

  // Fetch manufacturers from parts_catalog (for parts)
  useEffect(() => {
    const fetchManufacturers = async () => {
      const { data, error } = await supabase
        .from('parts_catalog')
        .select('brand')
        .not('brand', 'is', null);

      if (!error && data) {
        const unique = [...new Set(data.map((d: any) => d.brand).filter(Boolean))].sort();
        setManufacturers([...unique, 'Other']);
      }
    };
    fetchManufacturers();
  }, [supabase]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleManufacturerChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      manufacturer: value,
      customManufacturer: value === 'Other' ? prev.customManufacturer : '',
      model: '', // reset model when manufacturer changes
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
      const { error } = await supabase.storage.from('marketplace-images').upload(filePath, file);
      if (!error) {
        const { data } = supabase.storage.from('marketplace-images').getPublicUrl(filePath);
        if (data?.publicUrl) urls.push(data.publicUrl);
      }
    }
    return urls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const imageUrls = await uploadImages(user?.id || 'anon');

      const finalManufacturer = formData.manufacturer === 'Other' 
        ? formData.customManufacturer 
        : formData.manufacturer;

      let tableName = 'marketplace_listings';
      let payload: any = {
        listing_type: listingType,
        manufacturer: finalManufacturer,
        model: formData.model,
        serial_number: formData.serialNumber,
        condition: formData.condition,
        price: formData.price ? parseFloat(formData.price) : null,
        images: imageUrls,
        description: formData.description,
        notes: formData.additionalNotes || formData.reasonForSelling,
        created_by: user?.id,
        created_at: new Date().toISOString(),
      };

      if (listingType === 'part') {
        payload = {
          ...payload,
          part_number: formData.partNumber,
          quantity: parseInt(formData.quantity) || 1,
          data: {
            ...formData,
            manufacturer: finalManufacturer,
            images: imageUrls,
          },
        };
      }

      if (listingType === 'used') {
        payload = {
          ...payload,
          year_manufactured: formData.yearManufactured,
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
        };
      }

      if (listingType === 'request') {
        tableName = 'marketplace_requests';
        payload = {
          title: formData.description.substring(0, 80),
          description: formData.description,
          urgency: formData.urgency,
          preferred_date: formData.preferredDate || null,
          error_codes: formData.errorCodes,
          location_id: formData.location_id || null,
          manufacturer: finalManufacturer,
          model: formData.model,
          serial_number: formData.serialNumber,
          images: imageUrls,
          created_by: user?.id,
          created_at: new Date().toISOString(),
        };
      }

      const { error } = await supabase.from(tableName).insert(payload);
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
          {/* === USED LASER SYSTEM === */}
          {listingType === 'used' && (
            <>
              <div className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)]">Used Laser System Details</h3>

                {/* Manufacturer + Model (from MODELS) */}
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
                    {formData.manufacturer === 'Other' && (
                      <input
                        className="input mt-2"
                        placeholder="Enter custom model"
                        value={formData.model}
                        onChange={e => handleInputChange('model', e.target.value)}
                      />
                    )}
                  </div>
                </div>

                {/* Core ID fields */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">Serial Number (S/N)</label>
                    <input className="input" value={formData.serialNumber} onChange={e => handleInputChange('serialNumber', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Year Manufactured</label>
                    <input type="number" className="input" placeholder="e.g. 2018" value={formData.yearManufactured} onChange={e => handleInputChange('yearManufactured', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Condition</label>
                    <select className="select" value={formData.condition} onChange={e => handleInputChange('condition', e.target.value)}>
                      {['New', 'Excellent', 'Good', 'Fair', 'Needs Repair', 'For Parts Only'].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Wavelength / Medium */}
                <div>
                  <label className="label">Wavelength / Lasing Medium</label>
                  <input
                    className="input"
                    value={formData.wavelength || (MODELS[formData.model]?.wavelengths?.[0]?.name ?? '')}
                    onChange={e => handleInputChange('wavelength', e.target.value)}
                    placeholder="e.g. 1064nm Nd:YAG"
                  />
                </div>

                {/* Shot / Pulse Counts */}
                <div>
                  <label className="label font-medium">Pulse / Shot Counts</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-1">
                    <div><input className="input" placeholder="System Total" value={formData.totalSystemShots} onChange={e => handleInputChange('totalSystemShots', e.target.value)} /></div>
                    <div><input className="input" placeholder="Head / Resonator" value={formData.headPulses} onChange={e => handleInputChange('headPulses', e.target.value)} /></div>
                    <div><input className="input" placeholder="Lamp Pulses" value={formData.lampPulses} onChange={e => handleInputChange('lampPulses', e.target.value)} /></div>
                    <div><input className="input" placeholder="Handpiece(s)" value={formData.handpieceShots} onChange={e => handleInputChange('handpieceShots', e.target.value)} /></div>
                  </div>
                </div>

                {/* Maintenance */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Last PM / Service Date</label>
                    <input type="date" className="input" value={formData.lastPMDate} onChange={e => handleInputChange('lastPMDate', e.target.value)} />
                  </div>
                  {showDyeFields && (
                    <div>
                      <label className="label">Last Dye Kit Replacement</label>
                      <input type="date" className="input" value={formData.dyeKitReplacementDate} onChange={e => handleInputChange('dyeKitReplacementDate', e.target.value)} />
                    </div>
                  )}
                </div>

                {/* Model-specific Calibration / HV data */}
                {(showDyeFields || showVBeamHV || showGentleLASEHV || showGentleYAGHV || showGMAXCurrents) && (
                  <div className="border-t border-[var(--border)] pt-4 space-y-3">
                    <div className="text-sm font-medium text-[var(--text2)]">Model-Specific Performance Data</div>

                    {showDyeFields && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="label text-xs">Dye Kit S/N</label>
                          <input className="input" value={formData.dyeKitSN} onChange={e => handleInputChange('dyeKitSN', e.target.value)} placeholder="Dye kit serial" />
                        </div>
                        <div>
                          <label className="label text-xs">Dye Pulses (current kit)</label>
                          <input className="input" value={formData.dyePulses} onChange={e => handleInputChange('dyePulses', e.target.value)} placeholder="e.g. 12450" />
                        </div>
                      </div>
                    )}

                    {showVBeamHV && (
                      <div>
                        <label className="label text-xs">HV Final (VDC) @ Reference Fluence (VBeam)</label>
                        <input className="input" value={formData.hvFinal} onChange={e => handleInputChange('hvFinal', e.target.value)} placeholder="e.g. 620" />
                      </div>
                    )}

                    {showGentleLASEHV && (
                      <div>
                        <label className="label text-xs">HV @ 60J (GentleLASE / Alex family)</label>
                        <input className="input" value={formData.hv60J} onChange={e => handleInputChange('hv60J', e.target.value)} />
                      </div>
                    )}

                    {showGentleYAGHV && (
                      <div>
                        <label className="label text-xs">HV @ 90J (GentleYAG family)</label>
                        <input className="input" value={formData.hv90J} onChange={e => handleInputChange('hv90J', e.target.value)} />
                      </div>
                    )}

                    {showGMAXCurrents && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="label text-xs">Lamp Current - Alex (GMAX)</label>
                          <input className="input" value={formData.lampCurrentAlex} onChange={e => handleInputChange('lampCurrentAlex', e.target.value)} />
                        </div>
                        <div>
                          <label className="label text-xs">Lamp Current - YAG (GMAX)</label>
                          <input className="input" value={formData.lampCurrentYag} onChange={e => handleInputChange('lampCurrentYag', e.target.value)} />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="label text-xs">Fiber Transmission % (last measured)</label>
                      <input className="input" value={formData.fiberTransmission} onChange={e => handleInputChange('fiberTransmission', e.target.value)} placeholder="e.g. 92" />
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="label">Reason for Selling (optional)</label>
                  <input className="input" value={formData.reasonForSelling} onChange={e => handleInputChange('reasonForSelling', e.target.value)} />
                </div>
                <div>
                  <label className="label">Additional Service History / Notes</label>
                  <textarea className="input min-h-[80px]" value={formData.additionalNotes} onChange={e => handleInputChange('additionalNotes', e.target.value)} />
                </div>
              </div>

            </>
          )}

          {/* === PART FOR SALE === */}
          {listingType === 'part' && (
            <>
              <div className="bg-[var(--surface3)] border border-[var(--border)] rounded-xl p-4 space-y-4">
                <h3 className="font-semibold text-[var(--gold)]">Part Details</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Manufacturer / Brand</label>
                    <select className="select" value={formData.manufacturer} onChange={e => handleManufacturerChange(e.target.value)}>
                      <option value="">Select Manufacturer</option>
                      {manufacturers.map(mfr => <option key={mfr} value={mfr}>{mfr}</option>)}
                    </select>
                    {showCustomManufacturer && (
                      <input className="input mt-2" placeholder="Custom manufacturer" value={formData.customManufacturer} onChange={e => handleInputChange('customManufacturer', e.target.value)} />
                    )}
                  </div>
                  <div>
                    <label className="label">Part Number / SKU</label>
                    <input className="input" value={formData.partNumber} onChange={e => handleInputChange('partNumber', e.target.value)} required />
                  </div>
                </div>

                <div>
                  <label className="label">Description</label>
                  <textarea className="input min-h-[80px]" value={formData.description} onChange={e => handleInputChange('description', e.target.value)} placeholder="GentleYAG Handpiece Fiber..." required />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="label">Condition</label>
                    <select className="select" value={formData.condition} onChange={e => handleInputChange('condition', e.target.value)}>
                      {['New', 'Excellent', 'Good', 'Fair', 'Refurbished'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Quantity</label>
                    <input type="number" className="input" value={formData.quantity} onChange={e => handleInputChange('quantity', e.target.value)} />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* === SERVICE REQUEST (existing) === */}
          {listingType === 'request' && (
            <>
              {/* Manufacturer with Other option */}
              <div>
                <label className="label">Manufacturer</label>
                <select 
                  className="select" 
                  value={formData.manufacturer} 
                  onChange={e => handleManufacturerChange(e.target.value)}
                >
                  <option value="">Select Manufacturer</option>
                  {manufacturers.map(mfr => (
                    <option key={mfr} value={mfr}>{mfr}</option>
                  ))}
                </select>

                {formData.manufacturer === 'Other' && (
                  <input
                    className="input mt-2"
                    placeholder="Enter manufacturer name"
                    value={formData.customManufacturer}
                    onChange={e => handleInputChange('customManufacturer', e.target.value)}
                  />
                )}
              </div>

              <div>
                <label className="label">Model</label>
                <input 
                  className="input" 
                  value={formData.model} 
                  onChange={e => handleInputChange('model', e.target.value)} 
                  placeholder="Enter laser model"
                />
              </div>

              <div>
                <label className="label">Serial Number</label>
                <input className="input" value={formData.serialNumber} onChange={e => handleInputChange('serialNumber', e.target.value)} />
              </div>

              <div>
                <label className="label">Problem Description</label>
                <textarea className="input min-h-[120px]" value={formData.description} onChange={e => handleInputChange('description', e.target.value)} required />
              </div>

              <div>
                <label className="label">Error / Fault Codes (if any)</label>
                <input className="input" value={formData.errorCodes} onChange={e => handleInputChange('errorCodes', e.target.value)} />
              </div>

              {/* Location */}
              {locations.length > 0 ? (
                <div>
                  <label className="label">Location</label>
                  <select className="select" value={formData.location_id} onChange={e => handleInputChange('location_id', e.target.value)}>
                    <option value="">Select a location...</option>
                    {locations.map((loc: any) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} {loc.is_primary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="label">Street</label><input className="input" value={formData.street} onChange={e => handleInputChange('street', e.target.value)} /></div>
                  <div><label className="label">City</label><input className="input" value={formData.city} onChange={e => handleInputChange('city', e.target.value)} /></div>
                  <div><label className="label">State</label><input className="input" value={formData.state} onChange={e => handleInputChange('state', e.target.value)} /></div>
                  <div><label className="label">Zip</label><input className="input" value={formData.zip} onChange={e => handleInputChange('zip', e.target.value)} /></div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Urgency</label>
                  <select className="select" value={formData.urgency} onChange={e => handleInputChange('urgency', e.target.value)}>
                    <option>Low</option><option>Medium</option><option>High</option><option>Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="label">Preferred Date</label>
                  <input type="date" className="input" value={formData.preferredDate} onChange={e => handleInputChange('preferredDate', e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* Price for part & used (common) */}
          {(listingType === 'part' || listingType === 'used') && (
            <div>
              <label className="label">Asking Price (USD)</label>
              <input 
                type="number" 
                className="input" 
                value={formData.price} 
                onChange={e => handleInputChange('price', e.target.value)} 
                placeholder="e.g. 1250 or 18500" 
              />
            </div>
          )}

          {/* Image Upload (common to all) */}
          <div>
            <label className="label mb-2">Upload Images (optional)</label>
            <input type="file" multiple accept="image/*" onChange={handleImageSelect} className="block w-full" />
            {images.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-4">
                {images.map((file, index) => (
                  <div key={index} className="relative w-24 h-24 border rounded overflow-hidden">
                    <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removeImage(index)} className="absolute top-1 right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-3 text-lg">
            {loading ? 'Submitting...' : 'Submit Listing'}
          </button>
        </form>
      </div>
    </div>
  );
}