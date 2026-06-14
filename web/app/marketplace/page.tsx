'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { Package, Plus } from 'lucide-react';

export default function Marketplace() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [parts, setParts] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [loading, setLoading] = useState(true);

  const supabase = getSupabaseClient();

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        setLoading(false);
        return;
      }
      setUser(currentUser);

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', currentUser.id)
        .single();

      setProfile(prof);

      if (prof?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('type, name')
          .eq('id', prof.organization_id)
          .single();
        setOrganization(org);
      }

      let query = supabase.from('parts_catalog').select('*');

      if (organization?.type === 'laser_clinic') {
        query = query.eq('is_consumable', true);
      }

      const { data: partsData } = await query.order('name');
      setParts(partsData || []);

      setLoading(false);
    };

    loadData();
  }, [supabase, organization?.type]);

  // Dynamic manufacturers for filter
  const manufacturers = [...new Set(parts.map(p => p.manufacturer).filter(Boolean))].sort();

  // Filtered parts
  const filteredParts = parts.filter(part => {
    const matchesSearch = !searchTerm || 
      (part.name && part.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (part.description && part.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (part.part_number && part.part_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (part.manufacturer && part.manufacturer.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesManufacturer = !selectedManufacturer || part.manufacturer === selectedManufacturer;

    return matchesSearch && matchesManufacturer;
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading Marketplace...</div>
      </div>
    );
  }

  const isLaserClinic = organization?.type === 'laser_clinic';

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold">Marketplace</h1>

          {isLaserClinic && (
            <Link href="/marketplace/service-request/new" className="btn btn-primary flex items-center gap-2">
              <Plus size={18} /> Post Service Request
            </Link>
          )}
        </div>

        {/* Parts Marketplace */}
        <div className="mb-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Package size={24} /> Parts Marketplace
            </h2>
            {isLaserClinic && (
              <span className="text-sm text-[var(--text3)]">Showing only consumables</span>
            )}
          </div>

          {/* Search + Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <input
              type="text"
              placeholder="Search parts by name, description, part number..."
              className="input flex-1"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              className="select w-full md:w-64"
              value={selectedManufacturer}
              onChange={(e) => setSelectedManufacturer(e.target.value)}
            >
              <option value="">All Manufacturers</option>
              {manufacturers.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {filteredParts.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-[var(--text3)]">
                {isLaserClinic 
                  ? "No consumable parts match your search." 
                  : "No parts found."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredParts.map((part) => (
                <div key={part.id} className="card overflow-hidden hover:border-[var(--gold)] transition-colors">
                  {part.image_url ? (
                    <img 
                      src={part.image_url} 
                      alt={part.name} 
                      className="w-full h-48 object-cover" 
                    />
                  ) : (
                    <div className="w-full h-48 bg-[var(--surface3)] flex items-center justify-center">
                      <Package className="w-12 h-12 text-[var(--text3)]" />
                    </div>
                  )}
                  <div className="p-6">
                    <div className="font-bold text-lg mb-1">{part.name}</div>
                    <div className="text-sm text-[var(--text3)] mb-2">{part.part_number} • {part.manufacturer}</div>
                    <div className="text-sm mb-4 line-clamp-3">{part.description}</div>
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-[var(--gold)]">
                        ${part.unit_cost || '—'}
                      </span>
                      <button className="btn btn-secondary text-sm">View Details</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service Requests for Laser Clinics */}
        {isLaserClinic && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Your Service Requests</h2>
            <div className="card p-8 text-center">
              <p className="text-[var(--text3)] mb-4">Post service requests for your equipment here.</p>
              <Link href="/marketplace/service-request/new" className="btn btn-primary">
                Create New Service Request
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}