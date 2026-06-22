'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const fetchCustomers = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) {
        setLoading(false);
        return;
      }

      // For now, show all customers. Later we can filter by service territory.
      const { data } = await supabase
        .from('organizations')
        .select('*')
        .eq('type', 'customer')
        .order('name');

      setCustomers(data || []);
      setLoading(false);
    };

    fetchCustomers();
  }, []);

  if (loading) return <div className="p-8">Loading customers...</div>;

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-6">Customers</h1>

      {customers.length === 0 ? (
        <div className="card p-8 text-center">
          <p>No customers found yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((customer) => (
            <div key={customer.id} className="card p-5">
              <h3 className="font-bold text-lg mb-1">{customer.name}</h3>
              <p className="text-sm text-[var(--text3)]">
                {customer.city}, {customer.state}
              </p>
              {customer.phone && <p className="text-sm mt-1">📞 {customer.phone}</p>}
              {customer.email && <p className="text-sm">✉️ {customer.email}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}