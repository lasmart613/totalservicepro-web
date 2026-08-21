'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { AddCustomerModal } from '@/components/AddCustomerModal';
import { getSupabaseClient } from '@/lib/supabase/client';
import { canAddCustomers, isOwnerish, isServiceCompany, isSupplier } from '@/lib/roles';

export default function CustomersDirectory() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [userOrgType, setUserOrgType] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [serviceOrgId, setServiceOrgId] = useState<string | number | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const supabase = getSupabaseClient();

  const loadCustomers = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    if (!prof?.organization_id) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const orgId = prof.organization_id;
    setServiceOrgId(orgId);

    const { data: org } = await supabase
      .from('organizations')
      .select('type, name')
      .eq('id', orgId)
      .maybeSingle();

    const orgType = org?.type || '';
    const role = prof.role || '';
    setUserOrgType(orgType);
    setUserRole(role);

    // Owners denied; service companies + suppliers allowed
    if (isOwnerish(role, orgType)) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    const allowed =
      isServiceCompany(role, orgType) ||
      isSupplier(role, orgType) ||
      orgType === 'service_company' ||
      orgType === 'parts_supplier';

    if (!allowed) {
      setAccessDenied(true);
      setLoading(false);
      return;
    }

    // Only customers linked to THIS service org via organization_customers
    const { data: links, error: linkErr } = await supabase
      .from('organization_customers')
      .select('customer_organization_id')
      .eq('service_organization_id', orgId)
      .limit(500);

    if (linkErr) {
      console.warn('organization_customers load failed:', linkErr);
      setCustomers([]);
      setLoading(false);
      return;
    }

    const customerIds = Array.from(
      new Set(
        (links || [])
          .map((r: any) => r.customer_organization_id)
          .filter((id: any) => id != null)
      )
    );

    if (customerIds.length === 0) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    const { data: custs } = await supabase
      .from('organizations')
      .select(
        'id, name, address, city, state, phone, email, laser_models, facility_type, biz_type, type'
      )
      .in('id', customerIds)
      .in('type', ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'])
      .order('name', { ascending: true });

    setCustomers(custs || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const filtered = customers.filter(
    (c) =>
      (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.city || '').toLowerCase().includes(search.toLowerCase()) ||
      (c.state || '').toLowerCase().includes(search.toLowerCase())
  );

  const allowAdd = canAddCustomers(userRole, userOrgType);
  const addDeniedReason = isSupplier(userRole, userOrgType)
    ? 'Parts suppliers can view the directory but cannot add customers.'
    : 'Only service company staff can add customers.';

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
              The Customer Directory is only available for{' '}
              <strong>Service Companies</strong> and <strong>Parts Suppliers</strong>.
            </p>
            <Link href="/" className="btn btn-primary mt-6 inline-block">
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full px-4 py-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold">👥 Customer Directory</h1>
            <p className="text-sm text-[var(--text3)]">Customers managed by your organization</p>
          </div>
          {allowAdd && (
            <button type="button" className="btn btn-primary text-sm" onClick={() => setShowAdd(true)}>
              + Add Customer
            </button>
          )}
        </div>
        {!loading && !allowAdd && (
          <p className="text-xs text-[var(--text3)] mb-4 -mt-2">{addDeniedReason}</p>
        )}

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
            <div className="text-4xl mb-3">👥</div>
            <p className="font-semibold mb-1">
              {search.trim() ? 'No customers match your search' : 'No customers yet'}
            </p>
            <p className="text-sm text-[var(--text3)] mb-4">
              {search.trim()
                ? 'Try a different name, city, or state.'
                : allowAdd
                  ? 'Add a customer to build your CRM directory.'
                  : addDeniedReason}
            </p>
            {!search.trim() && allowAdd && (
              <button type="button" className="btn btn-primary inline-block" onClick={() => setShowAdd(true)}>
                + Add Customer
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((c) => (
              <Link
                key={c.id}
                href={`/customers/${c.id}`}
                className="card p-5 block transition-colors hover:border-[var(--gold-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
              >
                <div className="font-semibold text-lg mb-1 text-[var(--text)]">
                  {c.name || 'Unnamed Customer'}
                </div>
                <div className="text-sm text-[var(--text3)] mb-2">
                  {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                </div>
                {c.address && <div className="text-sm mb-1">{c.address}</div>}
                {c.phone && <div className="text-sm">📞 {c.phone}</div>}
                {c.email && <div className="text-sm">✉️ {c.email}</div>}

                {c.laser_models && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <div className="text-xs uppercase tracking-widest text-[var(--text3)] mb-1">
                      Equipment
                    </div>
                    <div className="text-sm text-[var(--text)] line-clamp-2">{c.laser_models}</div>
                  </div>
                )}

                {c.facility_type && (
                  <div className="mt-2 text-xs text-[var(--text3)]">Type: {c.facility_type}</div>
                )}

                <div className="mt-3 text-xs font-semibold text-[var(--gold)]">View profile →</div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-[var(--text3)]">
          Showing only customers linked to your organization
          {userOrgType ? ` (${userOrgType})` : ''}. Access limited to service companies and parts
          suppliers.
        </div>
      </div>

      <AddCustomerModal
        open={showAdd}
        serviceOrgId={serviceOrgId}
        onClose={() => setShowAdd(false)}
        onCreated={() => {
          loadCustomers();
        }}
      />
    </div>
  );
}
