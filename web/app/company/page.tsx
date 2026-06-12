'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

export default function CompanyProfile() {
  const [org, setOrg] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: prof } = await supabase.from('user_profiles').select('organization_id, organizations(*)').eq('id', user.id).maybeSingle();
      if (prof?.organizations) setOrg(prof.organizations);
    })();
  }, []);

  async function save() {
    setSaving(true);
    // For demo: update via profile relation (real app would have proper org management)
    alert('Company profile save would update organizations table (admin only in full flow).');
    setSaving(false);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-lg mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">🏢 Company Profile</h1>
        <div className="card p-5 space-y-4">
          <div><label className="label">Company Name</label><input className="input" value={org.name || ''} onChange={e => setOrg({ ...org, name: e.target.value })} /></div>
          <div><label className="label">Address</label><input className="input" value={org.address || ''} onChange={e => setOrg({ ...org, address: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">City</label><input className="input" value={org.city || ''} onChange={e => setOrg({ ...org, city: e.target.value })} /></div>
            <div><label className="label">State</label><input className="input" value={org.state || ''} onChange={e => setOrg({ ...org, state: e.target.value })} /></div>
          </div>
          <div><label className="label">Phone</label><input className="input" value={org.phone || ''} onChange={e => setOrg({ ...org, phone: e.target.value })} /></div>
        </div>
        <button onClick={save} className="btn btn-primary mt-5 w-full">Save Company</button>
        <p className="text-[10px] mt-3 text-[var(--text3)]">Visible to admins &amp; service managers. Used for report letterhead &amp; tech snapshots.</p>
      </div>
    </div>
  );
}
