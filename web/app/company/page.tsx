'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { MODELS } from '../../lib/models';

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, organizations(*)')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organizations) {
        setOrg(prof.organizations);
        setUserRole(prof.role || '');
        await loadTeamMembers(prof.organizations.id);
        await loadCustomers();
      }
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
      if (!org?.id) {
        alert('Organization not loaded yet. Please refresh the page.');
        setSaving(false);
        return;
      }
      const updateData = {
        name: org.name ?? null,
        address: org.address ?? null,
        city: org.city ?? null,
        state: org.state ?? null,
        phone: org.phone ?? null,
        website: org.website ?? null,
        bio: org.bio ?? null,
      };
      const { error } = await supabase
        .from('organizations')
        .update(updateData)
        .eq('id', org.id);
      if (error) throw error;
      alert('Details saved.');
    } catch (err: any) {
      alert('Save failed: ' + (err.message || err));
    }
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    if (!org.id) return alert('No organization loaded.');
    setUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${org.id}-${Date.now()}.${fileExt}`;
      const filePath = `${org.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(filePath);
      const logoUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('organizations')
        .update({ logo_url: logoUrl })
        .eq('id', org.id);
      if (updateError) throw updateError;

      setOrg({ ...org, logo_url: logoUrl });
      alert('Logo uploaded successfully!');
    } catch (err: any) {
      alert('Logo upload failed: ' + (err.message || err) + '\n(Make sure "logos" storage bucket exists and has proper policies.)');
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
        setAddMessage('No account found for that email yet. Ask the person to sign up first (via /signup/fse or appropriate), then try again to assign them to the company.');
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
      alert('Failed to update role: ' + (err.message || err));
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
        // bio column added via 20260614 migration for contact info storage on customer orgs
        bio: (newCustomer.contactName || newCustomer.contactEmail || newCustomer.notes)
          ? `Contact: ${newCustomer.contactName || ''} (${newCustomer.contactEmail || ''}, ${newCustomer.contactPhone || ''})\n${newCustomer.notes || ''}`
          : null,
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
          <h2 className="font-bold mb-4">Team Members (FSEs, Dispatchers, Admins, etc.)</h2>

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
              Members must sign up first via the appropriate flow. Then you can assign them here by email (sets organization_id + role).
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
          Full multi-user company management, invitations, and permissions coming soon. This gives Service Companies the ability to manage team (FSEs, dispatchers/schedulers, admins) and company data. CRM allows adding customers with full contact, address, and equipment data from the organizations table.
        </p>

        {/* Thorough Onboarding Note / Checklist - shown for service company admins */}
        {org.type === 'service_company' && (userRole === 'service_manager' || userRole === 'company_admin') && (
        <div className="card p-4 bg-[var(--gold-glow)] text-sm">
          <div className="font-bold mb-2">Thorough Onboarding Checklist for New Service Company Admins</div>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Complete company details and upload logo (above)</li>
            <li>Add your team: FSEs, dispatchers/schedulers, admins (Team Members section)</li>
            <li>Set up your CRM: add initial customers with contact info, addresses, equipment (CRM section above)</li>
            <li>Explore Service Schedule and Marketplace to start operations</li>
            <li>Invite team members to sign up and assign them roles here</li>
          </ul>
          <p className="text-xs mt-2">This makes onboarding robust for Service Companies.</p>
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
