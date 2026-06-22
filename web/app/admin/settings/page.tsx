'use client';

import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function AdminSettings() {
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    const loadOrg = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (profile?.organization_id) {
        const { data } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single();

        setOrg(data);
      }
      setLoading(false);
    };

    loadOrg();
  }, []);

  const handleSave = async () => {
    if (!org) return;

    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({
        name: org.name,
        address: org.address,
        city: org.city,
        state: org.state,
        phone: org.phone,
        website: org.website,
      })
      .eq('id', org.id);

    if (error) {
      toast.error('Failed to save changes');
    } else {
      toast.success('Organization settings saved');
    }
    setSaving(false);
  };

  if (loading) return <div className="p-8">Loading settings...</div>;
  if (!org) return <div className="p-8">No organization found.</div>;

  return (
    <div>
      <h1 className="text-3xl font-extrabold mb-8">Organization Settings</h1>

      <div className="max-w-2xl card p-8 space-y-6">
        <div>
          <label className="label">Organization Name</label>
          <input
            className="input"
            value={org.name || ''}
            onChange={(e) => setOrg({ ...org, name: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Address</label>
            <input
              className="input"
              value={org.address || ''}
              onChange={(e) => setOrg({ ...org, address: e.target.value })}
            />
          </div>
          <div>
            <label className="label">City</label>
            <input
              className="input"
              value={org.city || ''}
              onChange={(e) => setOrg({ ...org, city: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">State / Province</label>
            <input
              className="input"
              value={org.state || ''}
              onChange={(e) => setOrg({ ...org, state: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              value={org.phone || ''}
              onChange={(e) => setOrg({ ...org, phone: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Website</label>
          <input
            className="input"
            value={org.website || ''}
            onChange={(e) => setOrg({ ...org, website: e.target.value })}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn btn-primary mt-4"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}