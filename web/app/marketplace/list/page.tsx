'use client';

import React, { useState } from 'react';
import { Header } from '../../../components/Header';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { toast } from 'sonner';

type ListingType = 'part' | 'used' | 'request';

export default function MarketplaceList() {
  const [listingType, setListingType] = useState<ListingType>('part');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const supabase = getSupabaseClient();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    partNumber: '',
    condition: 'New',
    quantity: '1',
    manufacturer: '',
    model: '',
    serialNumber: '',
    urgency: 'Medium',
    preferredDate: '',
    errorCodes: '',
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setImages(prev => [...prev, ...Array.from(e.target.files)]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const uploadImages = async (): Promise<string[]> => {
    if (images.length === 0) return [];
    const urls: string[] = [];

    for (const file of images) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `listings/${fileName}`;

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
      const imageUrls = await uploadImages();
      const { data: { user } } = await supabase.auth.getUser();

      const payload = {
        type: listingType,
        data: {
          ...formData,
          images: imageUrls,
        },
        created_by: user?.id,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('marketplace_parts').insert(payload);
      if (error) throw error;

      toast.success('Listing created successfully!');
      setFormData({
        title: '', description: '', price: '', partNumber: '', condition: 'New', quantity: '1',
        manufacturer: '', model: '', serialNumber: '', urgency: 'Medium', preferredDate: '', errorCodes: '',
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
          {/* Common Fields */}
          <div>
            <label className="label">Title</label>
            <input className="input" value={formData.title} onChange={e => handleInputChange('title', e.target.value)} required />
          </div>

          <div>
            <label className="label">Description / Problem Description</label>
            <textarea className="input min-h-[120px]" value={formData.description} onChange={e => handleInputChange('description', e.target.value)} required />
          </div>

          {/* Service Request Specific Fields */}
          {listingType === 'request' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Manufacturer</label>
                  <input className="input" value={formData.manufacturer} onChange={e => handleInputChange('manufacturer', e.target.value)} />
                </div>
                <div>
                  <label className="label">Model</label>
                  <input className="input" value={formData.model} onChange={e => handleInputChange('model', e.target.value)} />
                </div>
                <div>
                  <label className="label">Serial Number</label>
                  <input className="input" value={formData.serialNumber} onChange={e => handleInputChange('serialNumber', e.target.value)} />
                </div>
              </div>

              <div>
                <label className="label">Error / Fault Codes (if any)</label>
                <input className="input" value={formData.errorCodes} onChange={e => handleInputChange('errorCodes', e.target.value)} placeholder="e.g. Fault 12.1, E-45" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">Urgency</label>
                  <select className="select" value={formData.urgency} onChange={e => handleInputChange('urgency', e.target.value)}>
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="label">Preferred Date</label>
                  <input type="date" className="input" value={formData.preferredDate} onChange={e => handleInputChange('preferredDate', e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* Image Upload */}
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