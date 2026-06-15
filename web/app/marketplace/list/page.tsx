'use client';

import React, { useState } from 'react';
import { Header } from '../../../components/Header';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { toast } from 'sonner';

export default function MarketplaceList() {
  const [activeTab, setActiveTab] = useState<'part' | 'used' | 'request'>('part');
  const [loading, setLoading] = useState(false);
  const supabase = getSupabaseClient();

  // Simple form states
  const [partForm, setPartForm] = useState({
    partNumber: '',
    description: '',
    price: '',
    condition: 'New',
    quantity: '1',
  });

  const [usedSystemForm, setUsedSystemForm] = useState({
    manufacturer: '',
    model: '',
    serialNumber: '',
    price: '',
    condition: 'Good',
    description: '',
  });

  const [requestForm, setRequestForm] = useState({
    title: '',
    description: '',
    urgency: 'Medium',
    preferredDate: '',
  });

  const handleSubmit = async (type: string) => {
    setLoading(true);
    try {
      // TODO: Replace with actual insert into marketplace_listing or relevant table
      console.log(`Submitting ${type} listing:`, 
        type === 'part' ? partForm : 
        type === 'used' ? usedSystemForm : requestForm
      );

      // Example insert (adjust table/fields as needed)
      const { error } = await supabase.from('marketplace_listing').insert({
        type: type,
        data: type === 'part' ? partForm : 
              type === 'used' ? usedSystemForm : requestForm,
        created_at: new Date().toISOString(),
      });

      if (error) throw error;

      toast.success(`${type === 'part' ? 'Part' : type === 'used' ? 'Used System' : 'Service Request'} listing created!`);
      
      // Reset forms
      if (type === 'part') setPartForm({ partNumber: '', description: '', price: '', condition: 'New', quantity: '1' });
      if (type === 'used') setUsedSystemForm({ manufacturer: '', model: '', serialNumber: '', price: '', condition: 'Good', description: '' });
      if (type === 'request') setRequestForm({ title: '', description: '', urgency: 'Medium', preferredDate: '' });

    } catch (err: any) {
      toast.error('Failed to create listing: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-3xl mx-auto w-full px-4 py-8">
        <h1 className="text-3xl font-extrabold mb-2">Create Marketplace Listing</h1>
        <p className="text-[var(--text3)] mb-8">List parts, used equipment, or post service needs.</p>

        {/* Tab / Category Selector */}
        <div className="flex border-b border-[var(--border)] mb-8">
          <button
            onClick={() => setActiveTab('part')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${activeTab === 'part' ? 'border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            List a Part
          </button>
          <button
            onClick={() => setActiveTab('used')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${activeTab === 'used' ? 'border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            List Used System
          </button>
          <button
            onClick={() => setActiveTab('request')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${activeTab === 'request' ? 'border-[var(--gold)] text-[var(--gold)]' : 'text-[var(--text3)]'}`}
          >
            Post Service Request
          </button>
        </div>

        {/* PART LISTING FORM */}
        {activeTab === 'part' && (
          <div className="card p-6">
            <h2 className="font-bold text-xl mb-4">List a Part for Sale</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="input" placeholder="Part Number" value={partForm.partNumber} onChange={e => setPartForm({ ...partForm, partNumber: e.target.value })} />
              <input className="input" placeholder="Price ($)" type="number" value={partForm.price} onChange={e => setPartForm({ ...partForm, price: e.target.value })} />
              <input className="input md:col-span-2" placeholder="Description" value={partForm.description} onChange={e => setPartForm({ ...partForm, description: e.target.value })} />
              <select className="select" value={partForm.condition} onChange={e => setPartForm({ ...partForm, condition: e.target.value })}>
                <option>New</option>
                <option>Like New</option>
                <option>Good</option>
                <option>Fair</option>
              </select>
              <input className="input" placeholder="Quantity" type="number" value={partForm.quantity} onChange={e => setPartForm({ ...partForm, quantity: e.target.value })} />
            </div>
            <button 
              onClick={() => handleSubmit('part')} 
              disabled={loading}
              className="btn btn-primary mt-6 w-full"
            >
              {loading ? 'Creating Listing...' : 'List Part for Sale'}
            </button>
          </div>
        )}

        {/* USED LASER SYSTEM FORM */}
        {activeTab === 'used' && (
          <div className="card p-6">
            <h2 className="font-bold text-xl mb-4">List a Used Laser System</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="input" placeholder="Manufacturer" value={usedSystemForm.manufacturer} onChange={e => setUsedSystemForm({ ...usedSystemForm, manufacturer: e.target.value })} />
              <input className="input" placeholder="Model" value={usedSystemForm.model} onChange={e => setUsedSystemForm({ ...usedSystemForm, model: e.target.value })} />
              <input className="input" placeholder="Serial Number (optional)" value={usedSystemForm.serialNumber} onChange={e => setUsedSystemForm({ ...usedSystemForm, serialNumber: e.target.value })} />
              <input className="input" placeholder="Asking Price ($)" type="number" value={usedSystemForm.price} onChange={e => setUsedSystemForm({ ...usedSystemForm, price: e.target.value })} />
              <select className="select" value={usedSystemForm.condition} onChange={e => setUsedSystemForm({ ...usedSystemForm, condition: e.target.value })}>
                <option>Excellent</option>
                <option>Good</option>
                <option>Fair</option>
                <option>Needs Work</option>
              </select>
              <input className="input md:col-span-2" placeholder="Description / Notes" value={usedSystemForm.description} onChange={e => setUsedSystemForm({ ...usedSystemForm, description: e.target.value })} />
            </div>
            <button 
              onClick={() => handleSubmit('used')} 
              disabled={loading}
              className="btn btn-primary mt-6 w-full"
            >
              {loading ? 'Creating Listing...' : 'List Used System for Sale'}
            </button>
          </div>
        )}

        {/* SERVICE REQUEST FORM */}
        {activeTab === 'request' && (
          <div className="card p-6">
            <h2 className="font-bold text-xl mb-4">Post a Service Request / Need</h2>
            <div className="grid grid-cols-1 gap-4">
              <input className="input" placeholder="Title (e.g. Need PM on Candela GentleYAG)" value={requestForm.title} onChange={e => setRequestForm({ ...requestForm, title: e.target.value })} />
              <textarea 
                className="input min-h-[120px]" 
                placeholder="Describe what you need..." 
                value={requestForm.description} 
                onChange={e => setRequestForm({ ...requestForm, description: e.target.value })} 
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select className="select" value={requestForm.urgency} onChange={e => setRequestForm({ ...requestForm, urgency: e.target.value })}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Emergency</option>
                </select>
                <input className="input" type="date" value={requestForm.preferredDate} onChange={e => setRequestForm({ ...requestForm, preferredDate: e.target.value })} />
              </div>
            </div>
            <button 
              onClick={() => handleSubmit('request')} 
              disabled={loading}
              className="btn btn-primary mt-6 w-full"
            >
              {loading ? 'Posting Request...' : 'Post Service Request'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}