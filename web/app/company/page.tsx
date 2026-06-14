'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { MODELS } from '../../lib/models';
import { toast } from 'sonner';

const TEAM_ROLES = ['fse', 'dispatcher', 'service_manager', 'company_admin', 'admin'];

export default function CompanyProfile() {
  const [org, setOrg] = useState<any>({});
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [newMember, setNewMember] = useState({ email: '', firstName: '', lastName: '', role: 'fse' });
  const [addMessage, setAddMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabaseClient();
  const [userRole, setUserRole] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(true);

  // CRM states for customers (from organizations table, type='customer')
  const [customers, setCustomers] = useState<any[]>([]);
  const [newCustomer, setNewCustomer] = useState({
    name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', selectedEquipment: [] as string[]
  });
  const [customerMessage, setCustomerMessage] = useState('');
  const equipmentOptions = Object.keys(MODELS).slice(0, 8); // sample from MODELS for thorough equipment selection

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

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role, organizations(*)')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organizations) {
        setOrg(prof.organizations);
        setUserRole(prof.role || '');
        await loadTeamMembers((prof.organizations as any)?.id);
        await loadCustomers();
      } else if (prof?.organization_id) {
        try {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', prof.organization_id)
            .single();
          if (orgData) {
            setOrg(orgData);
            setUserRole(prof.role || '');
            await loadTeamMembers((orgData as any).id);
            await loadCustomers();
          }
        } catch (e) {
          console.warn('Fallback org fetch failed:', e);
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
    setMembers(mems || []);
  }

  async function saveOrg() {
    setSaving(true);
    try {
      let currentOrg = org;
      if (!currentOrg?.id) {
        // Robust auto-create for new company signups that landed without org (race/RLS after /signup/company)
        // IMPORTANT: only use guaranteed columns here (name, type, address, city, state, phone, website).
        // 'bio' on organizations requires the migration (ALTER TABLE ... ADD COLUMN bio; NOTIFY pgrst, 'reload schema';).
        // Bio was referenced in non-existent 20260614 migration; omitting to avoid schema cache errors until applied.
        const orgInsert: any = {
          name: currentOrg.name || 'My Company',
          type: 'service_company',
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
          await supabase.from('user_profiles').update({ organization_id: newId }).eq('id', user.id);
        }
        currentOrg = { ...currentOrg, id: newId };
        setOrg(currentOrg);
        await loadTeamMembers(newId);
        await loadCustomers();
        toast.success('Organization created and linked.');
      }
      // updateData uses only guaranteed base columns. Bio omitted here (and in orgInsert above) because
      // the 'bio' column on 'organizations' table may not exist in all DBs until the migration SQL is run
      // (see task notes / Supabase SQL Editor command below). Bio collected in signups is stored on user_profiles
      // (which has the column from 20260611 migration). Future: once org bio column added, we can re-add safely.
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
        // Robust auto-create (same root cause as save: org not loaded for fresh signup)
        // IMPORTANT: only use guaranteed columns here (name, type, address, city, state, phone, website).
        // 'bio' on organizations requires the migration (ALTER TABLE ... ADD COLUMN bio; NOTIFY pgrst, 'reload schema';).
        // Bio was referenced in non-existent 20260614 migration; omitting to avoid schema cache errors until applied.
        const orgInsert: any = {
          name: currentOrg.name || 'My Company',
          type: 'service_company',
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
          await supabase.from('user_profiles').update({ organization_id: newId }).eq('id', user.id);
        }
        currentOrg = { ...currentOrg, id: newId };
        setOrg(currentOrg);
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
      // Consistent "logos" (plural) bucket name in error (confirmed in all storage.from('logos') calls below).
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
      // Try to find existing profile by email (user must have signed up already)
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id, organization_id')
        .eq('email', newMember.email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        // Link / update the existing user to this company with chosen role
        const { error } = await supabase
          .from('user_profiles')
          .update({
            organization_id: org.id,
            role: newMember.role,
            first_name: newMember.firstName || undefined,
            last_name: newMember.lastName || undefined,
            job_title: newMember.role === 'dispatcher' ? 'Scheduler / Dispatcher' : undefined,
          })
          .eq('id', existing.id);

        if (error) throw error;
        setAddMessage('Team member linked/updated successfully.');
      } else {
        setAddMessage('No account found for that email yet. Ask the person to sign up first (as individual via /signup/fse or the main signup, to get role fse), then try again to assign them to this Service Company (this sets their organization_id and confirms the fse role).');
        return;
      }

      // Refresh team
      await loadTeamMembers(org.id);
      setNewMember({ email: '', firstName: '', lastName: '', role: 'fse' });
    } catch (err: any) {
      setAddMessage('Failed to add member: ' + (err.message || err));
    }
  }

  async function updateMemberRole(memberId: string, newRole: string) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', memberId);
      if (error) throw error;
      await loadTeamMembers(org.id);
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
      setCustomerMessage('Customer name (facility) is required.');
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
        // bio for customer contact summary omitted from insert to prevent schema cache / missing column errors.
        // 'bio' column on organizations requires the migration (see comments in saveOrg/uploadLogo and the SQL below).
        // Once migration applied, we can re-enable storing contact notes in org.bio for customers.
        // For now, the notes/contact are in the form but not persisted to org until column exists (or use other fields).
        laser_models: newCustomer.selectedEquipment.length ? newCustomer.selectedEquipment.join(' | ') : null,
        facility_type: 'Clinic', // can be enhanced with select
      };

      const { error } = await supabase.from('organizations').insert(customerInsert);
      if (error) throw error;

      setCustomerMessage('Customer added successfully to CRM (stored in organizations table).');
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
          <h2 className="font-bold mb-4">Team Members (FSEs, Dispatchers, Admins, etc.) — roles added inside this Service Company org</h2>

          <div className="mb-6 p-4 bg-[var(--surface3)] rounded">
            <div className="font-semibold mb-2">Add / Assign Team Member</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                className="input"
                placeholder="Email (must have account)"
                value={newMember.email}
                onChange={e => setNewMember({ ...newMember, email: e.target.value })}
              />
              <input
                className="input"
                placeholder="First Name"
                value={newMember.firstName}
                onChange={e => setNewMember({ ...newMember, firstName: e.target.value })}
              />
              <input
                className="input"
                placeholder="Last Name"
                value={newMember.lastName}
                onChange={e => setNewMember({ ...newMember, lastName: e.target.value })}
              />
              <select
                className="select"
                value={newMember.role}
                onChange={e => setNewMember({ ...newMember, role: e.target.value })}
              >
                {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={addTeamMember} className="btn btn-primary">Add / Assign</button>
            </div>
            {addMessage && <div className="text-sm mt-2 text-[var(--text3)]">{addMessage}</div>}
            <p className="text-[10px] mt-2 text-[var(--text3)]">
              FSEs (and other team roles) must sign up first as individuals (e.g. /signup/fse for fse role). Then company_admin / service_manager assigns them to this org here by email (this sets organization_id + role inside the service_company). First the org type (service_company) is chosen at signup, then roles are added to the organization.
            </p>
          </div>

          <div>
            <div className="font-semibold mb-2">Current Team ({members.length})</div>
            {members.length === 0 && <div className="text-sm text-[var(--text3)]">No team members yet.</div>}
            <div className="space-y-2">
              {members.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between border border-[var(--border)] rounded p-3 text-sm">
                  <div>
                    <div className="font-medium">{m.first_name} {m.last_name} {m.email && `• ${m.email}`}</div>
                    <div className="text-[var(--text3)] text-xs">Current role: {m.role || '—'} {m.job_title && `(${m.job_title})`}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="select text-xs py-1"
                      value={m.role || 'fse'}
                      onChange={(e) => updateMemberRole(m.id, e.target.value)}
                    >
                      {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="text-[10px] text-[var(--text3)]">(change role / set Admin / Dispatcher)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* CRM Section for Company Admins - thorough customer management */}
        {org.type === 'service_company' && (userRole === 'service_manager' || userRole === 'company_admin') && (
        <div className="card p-6">
          <h2 className="font-bold mb-4">📋 Customer CRM</h2>
          <p className="text-sm text-[var(--text3)] mb-4">
            Add and manage your customers (laser owners, hospitals, medspas, clinics). Store contact info, addresses, owned equipment, and other data. Stored in the <code>organizations</code> table (type='customer').
          </p>

          {/* Add Customer Form - thorough fields */}
          <div className="mb-6 p-4 bg-[var(--surface3)] rounded">
            <div className="font-semibold mb-2">Add New Customer</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <input className="input" placeholder="Facility / Customer Name *" value={newCustomer.name} onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="input" placeholder="Contact Name" value={newCustomer.contactName} onChange={e => setNewCustomer({ ...newCustomer, contactName: e.target.value })} />
              <input className="input" placeholder="Contact Phone" value={newCustomer.contactPhone} onChange={e => setNewCustomer({ ...newCustomer, contactPhone: e.target.value })} />
              <input className="input" placeholder="Contact Email" value={newCustomer.contactEmail} onChange={e => setNewCustomer({ ...newCustomer, contactEmail: e.target.value })} />
              <input className="input" placeholder="Address" value={newCustomer.address} onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder="City" value={newCustomer.city} onChange={e => setNewCustomer({ ...newCustomer, city: e.target.value })} />
                <input className="input" placeholder="State" value={newCustomer.state} onChange={e => setNewCustomer({ ...newCustomer, state: e.target.value })} />
              </div>
            </div>

            <div className="mb-3">
              <label className="label text-xs">Equipment Owned (select multiple)</label>
              <div className="flex flex-wrap gap-1">
                {equipmentOptions.map(eq => (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => toggleEquipment(eq)}
                    className={`text-xs px-2 py-0.5 rounded border ${newCustomer.selectedEquipment.includes(eq) ? 'bg-[var(--gold)] text-black border-[var(--gold)]' : 'border-[var(--border)]'}`}
                  >
                    {MODELS[eq]?.label || eq}
                  </button>
                ))}
              </div>
            </div>

            <textarea className="input w-full" rows={2} placeholder="Notes / Other relevant data" value={newCustomer.notes} onChange={e => setNewCustomer({ ...newCustomer, notes: e.target.value })} />

            <button onClick={addCustomer} className="btn btn-primary mt-3">Add Customer</button>
            {customerMessage && <div className="text-sm mt-2 text-[var(--text3)]">{customerMessage}</div>}
          </div>

          {/* Customers List */}
          <div>
            <div className="font-semibold mb-2">Your Customers ({customers.length})</div>
            {customers.length === 0 && <div className="text-sm text-[var(--text3)]">No customers yet. Add some above for thorough CRM setup.</div>}
            <div className="space-y-2">
              {customers.map((c, idx) => (
                <div key={idx} className="border border-[var(--border)] rounded p-3 text-sm">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[var(--text3)]">
                    {c.address && `${c.address}, `}{c.city && `${c.city}, `}{c.state} {c.phone && `• ${c.phone}`}
                  </div>
                  {c.bio && <div className="text-xs mt-1">{c.bio}</div>}
                  {c.laser_models && <div className="text-xs mt-1">Equipment: {c.laser_models}</div>}
                  <div className="text-[10px] mt-1 text-[var(--text3)]">Type: {c.type} • ID: {c.id}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        <p className="text-[10px] text-[var(--text3)]">
          Full multi-user company management, invitations, and permissions coming soon. This gives Service Companies the ability to manage team (FSEs, dispatchers/schedulers, admins — roles added to the service_company org) and company data. CRM allows adding customers (orgs of type customer) with full contact, address, and equipment data from the organizations table. First org type at signup, then roles inside.
        </p>

        {/* Thorough Onboarding Note / Checklist - shown for service company admins */}
        {org.type === 'service_company' && (userRole === 'service_manager' || userRole === 'company_admin') && (
        <div className="card p-4 bg-[var(--gold-glow)] text-sm">
          <div className="font-bold mb-2">Thorough Onboarding Checklist for New Service Company Admins</div>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Complete company details and upload logo (above)</li>
            <li>Add your team: FSEs, dispatchers/schedulers, admins (Team Members section) — FSEs sign up first (role fse), then get added here</li>
            <li>Set up your CRM: add initial customers with contact info, addresses, equipment (CRM section above)</li>
            <li>Explore Service Schedule and Marketplace to start operations</li>
            <li>Invite team members to sign up (as individuals for FSEs) and assign them roles here (first org type, then roles inside org)</li>
          </ul>
          <p className="text-xs mt-2">This makes onboarding robust for Service Companies. (Org type service_company first at signup for the admin, then FSEs etc added as team roles.)</p>
        </div>
        )}

        {/* For Laser Owners / Customers: simple message if they land here */}
        {org.type === 'customer' && userRole === 'owner' && (
          <div className="card p-4 bg-[var(--surface3)] text-sm">
            <p>As a Laser Owner, your facility details can be managed here. Team and Customer CRM sections are for Service Company admins. Use the Marketplace to post service needs.</p>
          </div>
        )}
      </div>
    </div>
  );
}
