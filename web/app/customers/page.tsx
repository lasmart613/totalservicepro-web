'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function CustomersDirectory() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [userOrgType, setUserOrgType] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const load = async () => {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Get user's organization and type
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('type, name')
          .eq('id', prof.organization_id)
          .maybeSingle();

        const orgType = org?.type || '';
        setUserOrgType(orgType);

        const allowed = orgType === 'service_company' || orgType === 'parts_supplier';
        if (!allowed) {
          setAccessDenied(true);
          setLoading(false);
          return;
        }
      } else {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      // Fetch customers (all type=customer for now; in future can scope further to org)
      const { data: custs } = await supabase
        .from('organizations')
        .select('id, name, address, city, state, phone, email, laser_models, facility_type')
        .eq('type', 'customer')
        .order('name', { ascending: true });

      setCustomers(custs || []);
      setLoading(false);
    };

    load();
  }, [supabase]);

  const filtered = customers.filter(c => 
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.city || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.state || '').toLowerCase().includes(search.toLowerCase())
  );

  if (accessDenied) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-2xl mx-auto w-full px-4 py-8">
          <h1 className="text-2xl font-extrabold mb-2">👥 Customers</h1>
          <div className="card p-8 text-center">
            <div className="text-5xl mb-4">🔒</div>
            <div className="font-bold text-xl mb-3">Access Restricted</div>
            <p className="text-[var(--text3)]">
              The Customer Directory is only available for <strong>Service Companies</strong> and <strong>Parts Suppliers</strong>.
            </p>
            <Link href="/" className="btn btn-primary mt-6 inline-block">Go to Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-5xl mx-auto w-full px-4 py-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold">👥 Customer Directory</h1>
            <p className="text-sm text-[var(--text3)]">Customers managed by your organization</p>
          </div>
          <Link href="/company" className="btn btn-secondary text-sm">+ Add Customer (via Company)</Link>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name, city or state..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full md:w-80"
          />
        </div>

        {loading ? (
          <div className="card p-8 text-center text-[var(--text3)]">Loading customers...</div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[var(--text3)]">No customers found.</p>
            <p className="text-xs mt-2 text-[var(--text3)]">Add customers from the Company page.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <div key={c.id} className="card p-5">
                <div className="font-semibold text-lg mb-1">{c.name || 'Unnamed Customer'}</div>
                <div className="text-sm text-[var(--text3)] mb-2">
                  {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                </div>
                {c.address && <div className="text-sm mb-1">{c.address}</div>}
                {c.phone && <div className="text-sm">📞 {c.phone}</div>}
                {c.email && <div className="text-sm">✉️ {c.email}</div>}

                {c.laser_models && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <div className="text-xs uppercase tracking-widest text-[var(--text3)] mb-1">Equipment</div>
                    <div className="text-sm text-[var(--text)] line-clamp-2">{c.laser_models}</div>
                  </div>
                )}

                {c.facility_type && (
                  <div className="mt-2 text-xs text-[var(--text3)]">Type: {c.facility_type}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-[var(--text3)]">
          Showing customers of type "customer" in the organizations table. Access limited to service companies and parts suppliers.
        </div>
      </div>
    </div>
  );
}
