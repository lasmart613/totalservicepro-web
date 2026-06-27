'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Header } from '@/components/Header';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function NewServiceReport() {
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [currentUserOrgId, setCurrentUserOrgId] = useState<number | null>(null);
  const [customerOptions, setCustomerOptions] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    phone: '',
    email: '',
    contactName: ''
  });

  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.push('/login');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.organization_id) {
        setCurrentUserOrgId(profile.organization_id);
        await loadCustomers(profile.organization_id);
      }
    })();
  }, [router, supabase]);

  async function loadCustomers(orgId: number) {
    const { data, error } = await supabase
      .from('organization_customers')
      .select(`
        customer_organization_id,
        organizations:customer_organization_id!inner (
          id,
          name,
          address,
          city,
          state,
          phone,
          email,
          contact_name
        )
      `)
      .eq('service_organization_id', orgId)
      .order('organizations.name');

    if (error) {
      console.error(error);
    } else {
      const customers = data?.map(item => ({
        id: item.customer_organization_id,
        ...item.organizations
      })) || [];
      setCustomerOptions(customers);
    }
  }

  const filteredCustomers = customerOptions.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectCustomer = (customer: any) => {
    setSelectedCustomer(customer);
    setSearchTerm(customer.name);
  };

  const handleAddNewCustomer = async () => {
    if (!newCustomer.name.trim()) return;

    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: newCustomer.name.trim(),
        address: newCustomer.address.trim(),
        city: newCustomer.city.trim(),
        state: newCustomer.state.trim(),
        phone: newCustomer.phone.trim(),
        email: newCustomer.email.trim(),
        contact_name: newCustomer.contactName.trim(),
        type: 'customer'
      })
      .select()
      .single();

    if (orgError) {
      alert("Failed to create customer");
      return;
    }

    await supabase.from('organization_customers').insert({
      service_organization_id: currentUserOrgId,
      customer_organization_id: org.id
    });

    await loadCustomers(currentUserOrgId!);
    handleSelectCustomer(org);
    setShowAddModal(false);
    setNewCustomer({ name: '', address: '', city: '', state: '', phone: '', email: '', contactName: '' });
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Header />
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="text-[var(--gold)]">
              <ArrowLeft size={24} />
            </Link>
            <h1 className="text-3xl font-bold">New Service Report</h1>
          </div>
          <div className="flex gap-3">
            <button className="btn btn-secondary">Save Draft</button>
            <button className="btn btn-primary flex items-center gap-2">
              <Check size={18} /> Submit Report
            </button>
          </div>
        </div>

        {/* Customer Section - matching your Android version */}
        <div className="section mb-8 p-6">
          <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">🏥 Customer Info</h3>

          <div className="relative mb-4">
            <input
              type="text"
              placeholder="Search customer or type new name..."
              className="input w-full text-lg py-4"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {searchTerm && (
              <div className="absolute z-50 w-full bg-[var(--surface3)] border border-[var(--gold)] rounded-xl mt-1 max-h-80 overflow-auto shadow-xl">
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map((c: any) => (
                    <div key={c.id} className="px-4 py-3 hover:bg-[var(--surface)] cursor-pointer border-b border-[var(--border)] last:border-none" onClick={() => handleSelectCustomer(c)}>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-sm text-[var(--text3)]">{[c.city, c.state].filter(Boolean).join(', ')}</div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-[var(--text2)]">
                    No matching customer found
                  </div>
                )}
              </div>
            )}
          </div>

          <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 text-[var(--gold)] hover:underline">
            <Plus size={18} /> Add New Customer
          </button>

          {selectedCustomer && (
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="label">Address</label><input className="input" defaultValue={selectedCustomer.address} /></div>
              <div><label className="label">City</label><input className="input" defaultValue={selectedCustomer.city} /></div>
              <div><label className="label">State</label><input className="input" defaultValue={selectedCustomer.state} /></div>
              <div><label className="label">Contact Name</label><input className="input" defaultValue={selectedCustomer.contact_name} /></div>
              <div><label className="label">Phone</label><input className="input" defaultValue={selectedCustomer.phone} /></div>
              <div><label className="label">Email</label><input className="input" defaultValue={selectedCustomer.email} /></div>
            </div>
          )}
        </div>

        {/* Add other sections (Equipment, Checklists, etc.) as needed */}
      </div>

      {/* Add New Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-[#1a2233] p-8 rounded-3xl w-full max-w-lg mx-4">
            <h3 className="text-2xl font-bold mb-6">Add New Customer</h3>
            <div className="space-y-4">
              <input className="input" placeholder="Customer Name *" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="input" placeholder="Address" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
              <div className="grid grid-cols-2 gap-4">
                <input className="input" placeholder="City" value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} />
                <input className="input" placeholder="State" value={newCustomer.state} onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })} />
              </div>
              <input className="input" placeholder="Contact Name" value={newCustomer.contactName} onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })} />
              <input className="input" placeholder="Phone" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              <input className="input" placeholder="Email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
            </div>

            <div className="flex gap-4 mt-8">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 rounded-2xl border">Cancel</button>
              <button onClick={handleAddNewCustomer} className="flex-1 py-4 rounded-2xl bg-[var(--gold)] text-black font-bold">Create Customer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}