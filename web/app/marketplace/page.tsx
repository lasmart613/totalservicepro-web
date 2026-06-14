'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { Package, Wrench, Plus } from 'lucide-react';

export default function Marketplace() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'service' | 'parts'>('service');

  useEffect(() => {
    // ... (keep your existing user/profile loading logic)
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold">Marketplace</h1>
          <Link href="/" className="text-[var(--gold)] hover:underline">← Back to Dashboard</Link>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)] mb-8">
          <button onClick={() => setActiveTab('service')} className={`px-8 py-4 font-medium ${activeTab === 'service' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : ''}`}>
            Service Requests
          </button>
          <button onClick={() => setActiveTab('parts')} className={`px-8 py-4 font-medium ${activeTab === 'parts' ? 'border-b-2 border-[var(--gold)] text-[var(--gold)]' : ''}`}>
            Parts Marketplace
          </button>
        </div>

        {activeTab === 'parts' && profile?.role === 'parts_supplier' && (
          <div className="mb-8 flex justify-end">
            <Link href="/marketplace/parts/new" className="btn btn-primary flex items-center gap-2">
              <Plus size={20} /> List New Part
            </Link>
          </div>
        )}

        {/* Rest of your content... */}
        <div className="text-center py-20 text-[var(--text3)]">
          Full marketplace features are being built.<br />
          Parts listing + bulk upload coming very soon.<br />
          (Bidding: Service Company orgs and their FSE role members respond to owner needs.)
        </div>
      </div>
    </div>
  );
}