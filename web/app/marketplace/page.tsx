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

      // Get user profile + organization
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

      // Fetch parts based on organization type
      let query = supabase.from('parts_catalog').select('*');

      if (organization?.type === 'laser_clinic') {
        // Laser Clinic → only show consumables
        query = query.eq('is_consumable', true);
      }

      const { data: partsData } = await query.order('name');
      setParts(partsData || []);

      setLoading(false);
    };

    loadData();
  }, [supabase, organization?.type]);

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

          {/* Show Post Service Request button for Laser Clinics */}
          {isLaserClinic && (
            <Link href="/marketplace/service-request/new" className="btn btn-primary flex items-center gap-2">
              <Plus size={18} /> Post Service Request
            </Link>
          )}
        </div>

        {/* Parts Section */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Package size={24} /> Parts Marketplace
            </h2>
            {isLaserClinic && (
              <span className="text-sm text-[var(--text3)]">Showing only consumables</span>
            )}
          </div>

          {parts.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-[var(--text3)]">
                {isLaserClinic 
                  ? "No consumable parts are currently available." 
                  : "No parts found."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {parts.map((part) => (
                <div key={part.id} className="card p-6 hover:border-[var(--gold)] transition-colors">
                  <div className="font-bold text-lg mb-1">{part.name}</div>
                  <div className="text-sm text-[var(--text3)] mb-2">{part.part_number}</div>
                  <div className="text-sm mb-4 line-clamp-3">{part.description}</div>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-[var(--gold)]">
                      ${part.unit_cost || '—'}
                    </span>
                    <button className="btn btn-secondary text-sm">View Details</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service Requests Section (for Laser Clinics) */}
        {isLaserClinic && (
          <div>
            <h2 className="text-2xl font-bold mb-6">Your Service Requests</h2>
            <div className="card p-8 text-center">
              <p className="text-[var(--text3)] mb-4">You can post service requests for your equipment here.</p>
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