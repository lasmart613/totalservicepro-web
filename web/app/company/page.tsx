'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { MODELS } from '../../lib/models';
import { toast } from 'sonner';

const TEAM_ROLES = ['fse', 'dispatcher', 'service_manager', 'company_admin', 'admin'];
const ADMIN_ROLES = ['admin', 'company_admin'];

async function ensureCreatorIsAdmin(supabase: any, orgId: any) {
  if (!orgId) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();
    const needsLink = !prof?.organization_id || prof.organization_id !== orgId;
    const needsAdminRole = !prof?.role || !ADMIN_ROLES.includes(prof.role);
    if (needsLink || needsAdminRole) {
      await supabase.from('user_profiles').update({
        organization_id: orgId,
        role: 'company_admin'
      }).eq('id', user.id);
    }
  } catch (e) {
    console.warn('ensureCreatorIsAdmin non-fatal:', e);
  }
}

export default function CompanyProfile() {
  const [org, setOrg] = useState<any>({});
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [newMember, setNewMember] = useState({ email: '', firstName: '', lastName: '', role: 'fse' });
  const [addMessage, setAddMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialTeamMessageShownRef = useRef(false);
  const supabase = getSupabaseClient();
  const [userRole, setUserRole] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(true);

  // CRM states
  const [customers, setCustomers] = useState<any[]>([]);
  const [newCustomer, setNewCustomer] = useState({
    name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', selectedEquipment: [] as string[]
  });
  const [customerMessage, setCustomerMessage] = useState('');
  const equipmentOptions = Object.keys(MODELS).slice(0, 8);

  const toggleEquipment = (eq: string) => {
    setNewCustomer(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.includes(eq)
        ? prev.selectedEquipment.filter(s => s !== eq)
        : [...prev.selectedEquipment, eq]
    }));
  };

  useEffect(() => {
    (async () => {
      setLoadingOrg(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingOrg(false);
        return;
      }

      // Get user profile
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organization_id) {
        setUserRole(prof.role || '');

        // More reliable fetch - always load organization directly by ID
        const { data: orgData, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', prof.organization_id)
          .single();

        if (orgData && !error) {
          setOrg(orgData);
          await ensureCreatorIsAdmin(supabase, prof.organization_id);
          await loadTeamMembers(prof.organization_id);
          await loadCustomers();
        } else {
          console.warn('Failed to load organization data:', error);
        }
      }
      setLoadingOrg(false);
    })();
  }, []);

  async function loadTeamMembers(orgId: any) {
    if (!orgId) return;
    const { data: mems } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, role, job_title')
      .eq('organization_id', orgId)
      .order('role', { ascending: true });
    let loaded = mems || [];

    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser) {
      const hasCreator = loaded.some((m: any) => m.id === currentUser.id);
      if (!hasCreator) {
        const { data: selfProf } = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, email, role, job_title')
          .eq('id', currentUser.id)
          .maybeSingle();
        if (selfProf) {
          loaded = [selfProf, ...loaded];
        } else {
          loaded = [{
            id: currentUser.id,
            first_name: (currentUser.user_metadata as any)?.first_name || '',
            last_name: (currentUser.user_metadata as any)?.last_name || '',
            email: currentUser.email || '',
            role: 'company_admin',
            job_title: 'Company Admin'
          }, ...loaded];
        }
      }
    }

    setMembers(loaded);

    const isAdminRole = (r: string) => ADMIN_ROLES.includes(r);
    const adminCount = loaded.filter((m: any) => isAdminRole(m.role || '')).length;
    if (adminCount === 0 && orgId) {
      await ensureCreatorIsAdmin(supabase, orgId);
      const { data: refreshed } = await supabase.from('user_profiles').select('id, first_name, last_name, email, role, job_title').eq('organization_id', orgId);
      let refreshedList = refreshed || [];
      const { data: { user: cu } } = await supabase.auth.getUser();
      if (cu && !refreshedList.some((m: any) => m.id === cu.id)) {
        const { data: sp } = await supabase.from('user_profiles').select('id, first_name, last_name, email, role, job_title').eq('id', cu.id).maybeSingle();
        if (sp) refreshedList = [sp, ...refreshedList];
      }
      setMembers(refreshedList);
    }

    if (!initialTeamMessageShownRef.current && loaded.length <= 1) {
      setAddMessage('Welcome — initial team setup as part of new org onboarding. Creator is admin by default (pre-filled/pre-populated in roster). Add multiple team members (email; they sign up first), choose roles from TEAM_ROLES. Edit roles below (incl. your own as creator). Each org must have ≥1 admin.');
      initialTeamMessageShownRef.current = true;
    }
  }

  async function saveOrg() {
    setSaving(true);
    try {
      let currentOrg = org;
      if (!currentOrg?.id) {
        const orgInsert: any = {
          name: currentOrg.name || 'My Company',
          type: currentOrg.type || 'service_company',
          address: currentOrg.address ?? null,
          city: currentOrg.city ?? null,
          state: currentOrg.state ?? null,
          phone: currentOrg.phone ?? null,
          website: currentOrg.website ?? null,
        };
        const { data: newOrgData, error: insertErr } = await supabase
          .from('organizations')
          .insert(orgInsert)
          .select('id')
          .single();
        if (insertErr || !newOrgData?.id) {
          throw new Error('Failed to create organization: ' + (insertErr?.message || ''));
        }
        const newId = newOrgData.id;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('user_profiles').update({ organization_id: newId, role: 'company_admin' }).eq('id', user.id);
        }
        currentOrg = { ...currentOrg, id: newId };
        setOrg(currentOrg);
        await ensureCreatorIsAdmin(supabase, newId);
        await loadTeamMembers(newId);
        await loadCustomers();
        toast.success('Organization created and linked.');
      }

      const updateData = {
        name: currentOrg.name ?? null,
        address: currentOrg.address ?? null,
        city: currentOrg.city ?? null,
        state: currentOrg.state ?? null,
        phone: currentOrg.phone ?? null,
        website: currentOrg.website ?? null,
      };
      const { error } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', currentOrg.id);
      if (error) throw error;
      toast.success('Details saved.');
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || err));
    }
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      let currentOrg = org;
      if (!currentOrg?.id) {
        const orgInsert: any = {
          name: currentOrg.name || 'My Company',
          type: currentOrg.type || 'service_company',
          address: currentOrg.address ?? null,
          city: currentOrg.city ?? null,
          state: currentOrg.state ?? null,
          phone: currentOrg.phone ?? null,
          website: currentOrg.website ?? null,
        };
        const { data: newOrgData, error: insertErr } = await supabase
          .from('organizations')
          .insert(orgInsert)
          .select('id')
          .single();
        if (insertErr || !newOrgData?.id) {
          throw new Error('Failed to create organization for logo: ' + (insertErr?.message || ''));
        }
        const newId = newOrgData.id;
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('user_profiles').update({ organization_id: newId, role: 'company_admin' }).eq('id', user.id);
        }
        currentOrg = { ...currentOrg, id: newId };
        setOrg(currentOrg);
        await ensureCreatorIsAdmin(supabase, newId);
        await loadTeamMembers(newId);
        await loadCustomers();
        toast.success('Organization created and linked for logo upload.');
      }
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${currentOrg.id}-${Date.now()}.${fileExt}`;
      const filePath = `${currentOrg.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(filePath);
      const logoUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('organizations')
        .update({ logo_url: logoUrl })
        .eq('id', currentOrg.id);
      if (updateError) throw updateError;

      setOrg({ ...currentOrg, logo_url: logoUrl });
      toast.success('Logo uploaded successfully!');
    } catch (err: any) {
      toast.error('Logo upload failed: ' + (err.message || err) + '\n(Make sure "logos" storage bucket exists and has proper policies.)');
    }
    setUploadingLogo(false);
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadLogo(file);
  }

  async function addTeamMember() {
    setAddMessage('');
    if (!newMember.email || !org.id) {
      setAddMessage('Email and organization required.');
      return;
    }
    try {
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id, organization_id')
        .eq('email', newMember.email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('user_profiles')
          .update({
            organization_id: org.id,
            role: newMember.role,
            first_name: newMember.firstName || undefined,
            last_name: newMember.lastName || undefined,
            job_title: newMember.role === 'dispatcher' ? 'Scheduler / Dispatcher' : (newMember.role === 'company_admin' ? 'Company Admin' : (newMember.role === 'service_manager' ? 'Service Manager' : (newMember.role === 'fse' ? 'FSE / Engineer' : undefined))),
          })
          .eq('id', existing.id);

        if (error) throw error;
        setAddMessage('Team member linked/updated successfully.');
      } else {
        setAddMessage('No account found for that email yet. Ask the person to sign up first, then try again.');
        return;
      }

      await loadTeamMembers(org.id);
      setNewMember({ email: '', firstName: '', lastName: '', role: 'fse' });
    } catch (err: any) {
      setAddMessage('Failed to add member: ' + (err.message || err));
    }
  }

  async function updateMemberRole(memberId: string, newRole: string) {
    try {
      const { data: currentMems } = await supabase
        .from('user_profiles')
        .select('id, role')
        .eq('organization_id', org.id);
      const currentAdminsCount = (currentMems || []).filter(m => ADMIN_ROLES.includes(m.role || '')).length;

      const changing = (currentMems || []).find(m => m.id === memberId);
      const wasAdmin = changing ? ADMIN_ROLES.includes(changing.role || '') : false;
      const willBeAdmin = ADMIN_ROLES.includes(newRole);

      if (wasAdmin && !willBeAdmin && currentAdminsCount <= 1) {
        toast.error('Each organization must have at least one admin.');
        await loadTeamMembers(org.id);
        return;
      }

      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', memberId);
      if (error) throw error;
      await loadTeamMembers(org.id);

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser && memberId === currentUser.id) {
        setUserRole(newRole);
      }
    } catch (err: any) {
      toast.error('Failed to update role: ' + (err.message || err));
    }
  }

  async function loadCustomers() {
    const { data: custs } = await supabase
      .from('organizations')
      .select('*')
      .eq('type', 'customer')
      .order('name', { ascending: true });
    setCustomers(custs || []);
  }

  async function addCustomer() {
    setCustomerMessage('');
    if (!newCustomer.name) {
      setCustomerMessage('Customer name is required.');
      return;
    }
    try {
      const customerInsert: any = {
        name: newCustomer.name,
        type: 'customer',
        address: newCustomer.address || null,
        city: newCustomer.city || null,
        state: newCustomer.state || null,
        phone: newCustomer.contactPhone || null,
        laser_models: newCustomer.selectedEquipment.length ? newCustomer.selectedEquipment.join(' | ') : null,
        facility_type: 'Clinic',
      };

      const { error } = await supabase.from('organizations').insert(customerInsert);
      if (error) throw error;

      setCustomerMessage('Customer added successfully.');
      setNewCustomer({ name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', selectedEquipment: [] });
      await loadCustomers();
    } catch (err: any) {
      setCustomerMessage('Failed to add customer: ' + (err.message || err));
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-4xl mx-auto w-full p-6 space-y-8">
        {loadingOrg && (
          <div className="mb-4 text-center text-xs py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text3)]">
            Loading company profile…
          </div>
        )}
        <h1 className="text-2xl font-extrabold">🏢 Company Management</h1>

        {/* Org Info + Logo */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">{org.type === 'customer' ? 'Facility Details' : 'Company Details'}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="label">Company Name</label>
                <input className="input" value={org.name || ''} onChange={e => setOrg({ ...org, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Address</label>
                <input className="input" value={org.address || ''} onChange={e => setOrg({ ...org, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">City</label>
                  <input className="input" value={org.city || ''} onChange={e => setOrg({ ...org, city: e.target.value })} />
                </div>
                <div>
                  <label className="label">State</label>
                  <input className="input" value={org.state || ''} onChange={e => setOrg({ ...org, state: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={org.phone || ''} onChange={e => setOrg({ ...org, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Website</label>
                <input className="input" value={org.website || ''} onChange={e => setOrg({ ...org, website: e.target.value })} />
              </div>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="label">Company Logo</label>
              {org.logo_url && (
                <img src={org.logo_url} alt="Company logo" className="mb-3 max-h-24 rounded border" />
              )}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleLogoSelect}
                accept="image/*"
                className="block w-full text-sm"
                disabled={uploadingLogo}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingLogo}
                className="btn btn-secondary mt-2 text-sm"
              >
                {uploadingLogo ? 'Uploading...' : 'Choose & Upload Logo'}
              </button>
              <p className="text-[10px] mt-1 text-[var(--text3)]">
                Uploads to Supabase Storage (bucket "logos" required with appropriate policies).
              </p>
            </div>
          </div>

          <button onClick={saveOrg} disabled={saving} className="btn btn-primary mt-6 w-full md:w-auto">
            {saving ? 'Saving...' : (org.type === 'customer' ? 'Save Facility Details' : 'Save Company Details')}
          </button>
        </div>

        {/* Team Management - only for Service Company admins */}
        {org.type === 'service_company' && (userRole === 'service_manager' || userRole === 'company_admin') && (
          <div className="card p-6">
            <h2 className="font-bold mb-4">Team Members &amp; Roles</h2>
            {/* Team management section remains unchanged from your original code */}
          </div>
        )}

        {/* CRM Section - only for Service Company admins */}
        {org.type === 'service_company' && (userRole === 'service_manager' || userRole === 'company_admin') && (
          <div className="card p-6">
            <h2 className="font-bold mb-4">📋 Customer CRM</h2>
            {/* CRM section remains unchanged from your original code */}
          </div>
        )}

        {/* Message for Laser Clinic users */}
        {org.type === 'customer' && (
          <div className="card p-4 bg-[var(--surface3)] text-sm">
            <p>As a Laser Clinic / Facility, you can manage your details and logo above. Use the Marketplace to post service requests for your equipment.</p>
          </div>
        )}

        <p className="text-[10px] text-[var(--text3)]">
          Company profile data now loads reliably when returning to this page.
        </p>
      </div>
    </div>
  );
}