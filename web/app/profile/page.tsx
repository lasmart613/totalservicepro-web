'use client';

import React, { useEffect, useState } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';

export default function Profile() {
  const [profile, setProfile] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const supabase = getSupabaseClient();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
      if (data) setProfile(data);
      else setProfile({ first_name: user.user_metadata?.first_name || '', last_name: user.user_metadata?.last_name || '', email: user.email });
    })();
  }, []);

  async function save() {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('user_profiles').upsert({ id: user.id, ...profile });
    await supabase.auth.updateUser({ data: { first_name: profile.first_name, last_name: profile.last_name } });
    setSaving(false);
    alert('Profile saved');
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-lg mx-auto w-full p-6">
        <h1 className="text-xl font-bold mb-4">👤 Your Profile</h1>

        <div className="space-y-4 card p-5">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">First Name</label><input className="input" value={profile.first_name || ''} onChange={e => setProfile({ ...profile, first_name: e.target.value })} /></div>
            <div><label className="label">Last Name</label><input className="input" value={profile.last_name || ''} onChange={e => setProfile({ ...profile, last_name: e.target.value })} /></div>
          </div>
          <div><label className="label">Phone</label><input className="input" value={profile.phone || ''} onChange={e => setProfile({ ...profile, phone: e.target.value })} /></div>
          <div><label className="label">Job Title</label><input className="input" value={profile.job_title || ''} onChange={e => setProfile({ ...profile, job_title: e.target.value })} /></div>
          <div><label className="label">Role (read-only for now)</label><input className="input" value={profile.role || 'Not set (set during signup)'} disabled /></div>
          <p className="text-[10px] text-[var(--text3)] mt-1">Signup is by org type first: Service Company signups get role company_admin (you create the org, pre-populated as admin); Owner gets 'owner'; Parts gets 'parts_supplier'. FSEs sign up via the FSE flow (role 'fse', no org initially) and are added to a Service Company by its admin (via /company Team add people and roles to the organization, which sets organization_id + role). Roster allows editing roles (incl creator) with at least 1 admin enforced. Sole props supported. If role/org incorrect, contact support or have admin update via Team.</p>
        </div>

        <button onClick={save} disabled={saving} className="btn btn-primary mt-5 w-full">Save Profile</button>
        <p className="text-xs text-center mt-4 text-[var(--text3)]">Changes sync across web and Android apps.</p>
      </div>
    </div>
  );
}
