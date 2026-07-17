'use client';

import React, { useEffect, useState, useRef, Suspense } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient, claimPendingInvitations } from '@/lib/supabase/client';
import { MODELS } from '@/lib/models';
import { toast } from 'sonner';
import { useSearchParams } from 'next/navigation';
import {
  isAdmin,
  isOwnerish,
  isSupplier,
  isServiceCompany,
  canAccessCompanyProfile,
} from '@/lib/roles';

const TEAM_ROLES = ['company_admin', 'service_manager', 'fse', 'dispatcher', 'billing_manager', 'admin'];
const ADDITIONAL_ROLES = ['fse', 'dispatcher', 'service_manager', 'billing_manager'];
const ADMIN_ROLES = ['admin', 'company_admin'];

const MODEL_WAVELENGTHS: { [key: string]: string[] } = {
  'candela_vbeam2': ['595'],
  'candela_gentleyag': ['1064'],
  'candela_gentlelase': ['755'],
  'default': ['532', '595', '755', '1064', '10600']
};

/** Only force admin for service-company creators — never overwrite owner/supplier roles. */
async function ensureServiceCreatorLinked(supabase: any, orgId: any, orgType?: string | null) {
  if (!orgId) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .maybeSingle();

    // Never elevate owner / customer / supplier to company_admin
    if (isOwnerish(prof?.role, orgType) || isSupplier(prof?.role, orgType)) {
      const needsLink = !prof?.organization_id || prof.organization_id !== orgId;
      if (needsLink) {
        await supabase.from('user_profiles').update({ organization_id: orgId }).eq('id', user.id);
      }
      await claimPendingInvitations?.(supabase, user.id, user.email || '');
      return;
    }

    if (!isServiceCompany(prof?.role, orgType) && orgType && orgType !== 'service_company') {
      await claimPendingInvitations?.(supabase, user.id, user.email || '');
      return;
    }

    const needsLink = !prof?.organization_id || prof.organization_id !== orgId;
    const needsAdminRole = !prof?.role || !ADMIN_ROLES.includes(prof.role);
    // Only auto-admin if they already look like service staff without a role
    if (needsLink || (needsAdminRole && !prof?.role)) {
      await supabase.from('user_profiles').update({
        organization_id: orgId,
        ...(needsAdminRole && !prof?.role ? { role: 'company_admin' } : { organization_id: orgId }),
      }).eq('id', user.id);
    } else if (needsLink) {
      await supabase.from('user_profiles').update({ organization_id: orgId }).eq('id', user.id);
    }
    await claimPendingInvitations?.(supabase, user.id, user.email || '');
  } catch (e) {
    console.warn('ensureServiceCreatorLinked non-fatal:', e);
  }
}

function CompanyProfile() {
  const [org, setOrg] = useState<any>({});
  const [members, setMembers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [addMessage, setAddMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabaseClient();
  const searchParams = useSearchParams();
  const justSetup = searchParams.get('justSetup');
  const [userRole, setUserRole] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [showTeamPrompt, setShowTeamPrompt] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  // Chained Equipment + Serial (for customer form)
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedConfig, setSelectedConfig] = useState('');
  const [selectedWL, setSelectedWL] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

  // DB-driven (preferred) + fallback
  const [dbMfrs, setDbMfrs] = useState<any[]>([]);
  const [dbModels, setDbModels] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data: m } = await supabase.from('manufacturers').select('id,name').order('name');
        setDbMfrs(m || []);
        const { data: lm } = await supabase.from('laser_models').select('id,name,label,manufacturer_id').order('name');
        setDbModels(lm || []);
      } catch {}
    })();
  }, [supabase]);

  const mfrList = dbMfrs.length > 0 ? dbMfrs.map((m:any)=> m.name || m.id) : [...new Set(Object.values(MODELS).map((m: any) => m.manufacturer).filter(Boolean))].sort();
  const filteredModels = selectedManufacturer 
    ? (dbModels.length > 0 
        ? dbModels.filter((m:any) => String(m.manufacturer_id) === String(selectedManufacturer) || m.manufacturer === selectedManufacturer).map((m:any) => ({key: m.name, label: m.label || m.name, manufacturer: selectedManufacturer }))
        : Object.entries(MODELS).filter(([_, model]: any) => model.manufacturer === selectedManufacturer).map(([key, model]: any) => ({ key, ...model })))
    : [];

  const currentModelData = filteredModels.find(m => m.key === selectedModel);
  const availableConfigs = currentModelData?.configs || [];
  const wavelengthOptions = selectedModel && MODEL_WAVELENGTHS[selectedModel] 
    ? MODEL_WAVELENGTHS[selectedModel] 
    : MODEL_WAVELENGTHS['default'];

  const addEquipmentToCustomer = () => {
    if (!selectedModel) return;
    const equipmentItem = {
      key: selectedModel,
      manufacturer: selectedManufacturer,
      model: currentModelData?.label || selectedModel,
      config: selectedConfig || null,
      wl: selectedWL || null,
      serialNumber: serialNumber.trim() || null
    };
    setNewCustomer(prev => ({
      ...prev,
      selectedEquipment: [...prev.selectedEquipment, equipmentItem]
    }));
    setSelectedManufacturer(''); setSelectedModel(''); setSelectedConfig(''); setSelectedWL(''); setSerialNumber('');
  };

  const removeEquipmentFromCustomer = (index: number) => {
    setNewCustomer(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.filter((_, i) => i !== index)
    }));
  };

  // CRM state
  const [customers, setCustomers] = useState<any[]>([]);
  const [newCustomer, setNewCustomer] = useState({
    name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', 
    selectedEquipment: [] as any[]
  });
  const [customerMessage, setCustomerMessage] = useState('');

  const TIME_ZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Moscow',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Seoul',
    'Asia/Hong_Kong',
    'Australia/Sydney',
    'Australia/Melbourne',
    'Australia/Perth',
    'America/Toronto',
    'America/Vancouver',
    'America/Sao_Paulo',
    'America/Mexico_City',
  ];

  const [newTeam, setNewTeam] = useState({ email: '', fullName: '', role: 'fse', additional: [] as string[], title: '', contact: '', timeZone: 'America/New_York', yearsExp: '', territories: '', competencies: '' });

  useEffect(() => {
    (async () => {
      setLoadingOrg(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingOrg(false); return; }

      const { data: prof } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();

      setUserRole(prof?.role || '');

      if (prof?.role && !canAccessCompanyProfile(prof.role)) {
        // Still allow if they have an org (edge); only hard-deny unlinked low roles
        if (!prof.organization_id) {
          setAccessDenied(true);
          setLoadingOrg(false);
          return;
        }
      }

      if (prof?.organization_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', prof.organization_id)
          .single();
        if (orgData) {
          setOrg(orgData);
          await ensureServiceCreatorLinked(supabase, prof.organization_id, orgData.type);
          // Team + CRM only for service company admins
          if (isServiceCompany(prof.role, orgData.type) && (isAdmin(prof.role) || prof.role === 'service_manager')) {
            await loadTeamMembers(prof.organization_id);
            await loadCustomers(prof.organization_id);
          }
        }
      }
      setLoadingOrg(false);
    })();
  }, []);

  async function loadTeamMembers(orgId: any) {
    if (!orgId) return;
    const { data: mems } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, email, role, job_title, additional_roles')
      .eq('organization_id', orgId)
      .order('role', { ascending: true });
    let loaded = mems || [];

    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser && !loaded.some((m: any) => m.id === currentUser.id)) {
      const { data: selfProf } = await supabase.from('user_profiles').select('id, first_name, last_name, email, role, job_title, additional_roles').eq('id', currentUser.id).maybeSingle();
      if (selfProf) loaded = [selfProf, ...loaded];
    }
    setMembers(loaded);
  }

  async function saveOrg() {
    setSaving(true);
    try {
      let currentOrg = org;
      if (!currentOrg?.id) {
        const inferredType = ownerMode
          ? 'customer'
          : supplierMode
            ? 'parts_supplier'
            : 'service_company';
        const orgInsert: any = {
          name: currentOrg.name || (ownerMode ? 'My Facility' : supplierMode ? 'My Supplier Co' : 'My Company'),
          type: inferredType,
          address: currentOrg.address ?? null,
          city: currentOrg.city ?? null,
          state: currentOrg.state ?? null,
          phone: currentOrg.phone ?? null,
          website: currentOrg.website ?? null,
        };
        const { data: newOrgData } = await supabase.from('organizations').insert(orgInsert).select('id').single();
        if (newOrgData?.id) {
          currentOrg = { ...currentOrg, id: newOrgData.id, type: inferredType };
          setOrg(currentOrg);
          await ensureServiceCreatorLinked(supabase, newOrgData.id, inferredType);
          if (inferredType === 'service_company') {
            await loadTeamMembers(newOrgData.id);
          }
        }
      }

      const updateData = {
        name: currentOrg.name ?? null,
        address: currentOrg.address ?? null,
        city: currentOrg.city ?? null,
        state: currentOrg.state ?? null,
        phone: currentOrg.phone ?? null,
        website: currentOrg.website ?? null,
      };
      await supabase.from('organizations').update(updateData).eq('id', currentOrg.id);
      toast.success('Details saved.');
      if (serviceAdminMode) setShowTeamPrompt(true);
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || err));
    }
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `logo-${org.id}-${Date.now()}.${fileExt}`;
      const filePath = `${org.id}/${fileName}`;

      await supabase.storage.from('logos').upload(filePath, file, { upsert: true });
      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(filePath);
      await supabase.from('organizations').update({ logo_url: urlData.publicUrl }).eq('id', org.id);
      setOrg({ ...org, logo_url: urlData.publicUrl });
      toast.success('Logo uploaded successfully!');
    } catch (err: any) {
      toast.error('Logo upload failed: ' + (err.message || err));
    }
    setUploadingLogo(false);
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadLogo(file);
  }

  async function addTeamMember() {
    if (!newTeam.email || !newTeam.fullName) {
      setAddMessage('Email and full name required.');
      return;
    }
    setAddMessage('Processing...');
    try {
      const { data: { user: cur } } = await supabase.auth.getUser();
      if (!cur || !org?.id) throw new Error('No org');

      const em = newTeam.email.toLowerCase().trim();
      const chosenRole = newTeam.role || 'fse';
      const chosenAddl = newTeam.additional || [];
      const splitName = newTeam.fullName.trim().split(' ');
      const fn = splitName[0] || '';
      const ln = splitName.slice(1).join(' ') || '';

      const { data: existing } = await supabase.from('user_profiles').select('id').eq('email', em).maybeSingle();

      if (existing?.id) {
        await supabase.from('user_profiles').update({
          organization_id: org.id,
          role: chosenRole,
          additional_roles: chosenAddl.length ? chosenAddl : null,
          job_title: [chosenRole, ...chosenAddl].join(' + '),
          first_name: fn,
          last_name: ln || undefined,
        }).eq('id', existing.id);
        toast.success('Existing user linked/updated in org with role(s).');
      } else {
        // Best practice per requirements: use invitations, do not pre-create users
        await supabase.from('engineer_invitations').insert({
          organization_id: org.id,
          email: em,
          role: chosenRole,
          first_name: fn || null,
          last_name: ln || null,
          invited_by: cur.id,
          accepted: false
        });
        toast.success('Invitation created for ' + em + ' (sign up first, then auto assigned to RSP org + roles).');
      }
      await loadTeamMembers(org.id);
    } catch (e: any) {
      toast.error('Add failed: ' + (e.message || e));
    }
    setNewTeam({ email: '', fullName: '', role: 'fse', additional: [], title: '', contact: '', timeZone: 'America/New_York', yearsExp: '', territories: '', competencies: '' });
    setAddMessage('');
  }

  function toggleNewTeamAddl(r: string) {
    setNewTeam(prev => ({
      ...prev,
      additional: prev.additional.includes(r) ? prev.additional.filter(x => x !== r) : [...prev.additional, r]
    }));
  }

  async function loadCustomers(serviceOrgId?: any) {
    const sid = serviceOrgId ?? org?.id;
    if (!sid) {
      setCustomers([]);
      return;
    }
    // Scope to customers linked to this service org only
    const { data: links, error: linkErr } = await supabase
      .from('organization_customers')
      .select('customer_organization_id')
      .eq('service_organization_id', sid)
      .limit(500);

    if (linkErr) {
      console.warn('organization_customers load failed:', linkErr);
      setCustomers([]);
      return;
    }

    const ids = Array.from(
      new Set(
        (links || [])
          .map((r: any) => r.customer_organization_id)
          .filter((id: any) => id != null)
      )
    );
    if (ids.length === 0) {
      setCustomers([]);
      return;
    }

    const { data: custs } = await supabase
      .from('organizations')
      .select('*')
      .in('id', ids)
      .in('type', ['customer', 'laser_clinic'])
      .order('name');
    setCustomers(custs || []);
  }

  async function addCustomer() {
    if (!newCustomer.name) { setCustomerMessage('Customer name is required.'); return; }
    if (!org?.id) { setCustomerMessage('Your organization is not loaded yet.'); return; }
    try {
      const customerInsert: any = {
        name: newCustomer.name,
        type: 'customer',
        address: newCustomer.address || null,
        city: newCustomer.city || null,
        state: newCustomer.state || null,
        phone: newCustomer.contactPhone || null,
        laser_models: newCustomer.selectedEquipment.length 
          ? newCustomer.selectedEquipment.map((e: any) => `${e.manufacturer} ${e.model}${e.config ? ' ' + e.config : ''}${e.wl ? ' (' + e.wl + 'nm)' : ''}${e.serialNumber ? ' [SN: ' + e.serialNumber + ']' : ''}`).join(' | ')
          : null,
        facility_type: 'Clinic',
      };
      const { data: created, error: insErr } = await supabase
        .from('organizations')
        .insert(customerInsert)
        .select('id')
        .single();
      if (insErr) throw insErr;

      // Link to this service company so Customer Directory / CRM only show MY customers
      if (created?.id) {
        const { error: linkErr } = await supabase.from('organization_customers').insert({
          service_organization_id: org.id,
          customer_organization_id: created.id,
        });
        if (linkErr && !/duplicate|unique|23505/i.test(linkErr.message || '')) {
          console.warn('organization_customers link failed:', linkErr);
        }
      }

      setCustomerMessage('Customer added successfully.');
      setNewCustomer({ name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', selectedEquipment: [] });
      await loadCustomers(org.id);
    } catch (err: any) {
      setCustomerMessage('Failed to add customer: ' + (err.message || err));
    }
  }

  const ownerMode = isOwnerish(userRole, org?.type);
  const supplierMode = isSupplier(userRole, org?.type);
  const serviceAdminMode =
    isServiceCompany(userRole, org?.type) &&
    (isAdmin(userRole) || userRole === 'service_manager');
  const profileTitle = ownerMode
    ? 'Facility Profile'
    : supplierMode
      ? 'Supplier Profile'
      : 'Company Management';
  const detailsTitle = ownerMode
    ? 'Facility Details'
    : supplierMode
      ? 'Supplier Details'
      : 'Company Details';

  if (accessDenied) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="max-w-xl mx-auto p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-[var(--text3)]">Company profile is for org admins, facility owners, or suppliers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="max-w-7xl mx-auto w-full p-6 space-y-8">
        {loadingOrg && <div className="mb-4 text-center text-xs py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text3)]">Loading company profile…</div>}
        {justSetup && (
          <div className="mb-4 p-4 rounded bg-green-900/20 border border-green-600 text-sm">
            🎉 Onboarding complete! Your details, team (if added), and logo have been saved. Review or update company info below anytime. Use the Profile page (Settings) for personal phone/job/role. Go to Hub for main navigation.
          </div>
        )}
        <h1 className="text-2xl font-extrabold">🏢 {profileTitle}</h1>

        {/* Company Details Form - FULLY RESTORED */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">{detailsTitle}</h2>
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
              {org.logo_url && <img src={org.logo_url} alt="Company logo" className="mb-3 max-h-24 rounded border" />}
              <input type="file" ref={fileInputRef} onChange={handleLogoSelect} accept="image/*" className="block w-full text-sm" disabled={uploadingLogo} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo} className="btn btn-secondary mt-2 text-sm">
                {uploadingLogo ? 'Uploading...' : 'Choose & Upload Logo'}
              </button>
            </div>
          </div>

          <button onClick={saveOrg} disabled={saving} className="btn btn-primary mt-6 w-full md:w-auto">
            {saving ? 'Saving...' : ownerMode ? 'Save Facility Details' : supplierMode ? 'Save Supplier Details' : 'Save Company Details'}
          </button>
        </div>

        {/* Team + CRM: service company admins only (hidden for owners / suppliers) */}
        {serviceAdminMode && (
          <>
            {showTeamPrompt && (
              <div className="card p-6 bg-[var(--gold-glow)]/10 border border-[var(--gold)]">
                <h3 className="font-bold text-lg mb-2">Great! Company details saved.</h3>
                <p className="text-sm mb-4">Next step: Build your team below.</p>
                <a href="#team-section" className="btn btn-primary">Go to Team Setup →</a>
              </div>
            )}

            <div id="team-section" className="card p-6">
              <h2 className="font-bold mb-4">Team Members &amp; Roles</h2>
              <p className="text-xs text-[var(--text3)] mb-3">Add or assign people to roles in this RSP org. Creator/admin changeable but always keep &gt;=1 admin. Use invites for new signups (they sign up first using org tiles or login, then get claimed/assigned here).</p>
              <div className="mb-4">
                <h3 className="font-semibold mb-2">Add / Assign Team Member (general roles)</h3>
                <div className="space-y-2 text-sm">
                  <input className="input" placeholder="Email" value={newTeam.email} onChange={e => setNewTeam({...newTeam, email: e.target.value})} />
                  <input className="input" placeholder="Full Name" value={newTeam.fullName} onChange={e => setNewTeam({...newTeam, fullName: e.target.value})} />
                  <div className="grid grid-cols-2 gap-2">
                    <select className="select" value={newTeam.role} onChange={e => setNewTeam({...newTeam, role: e.target.value})}>
                      {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input className="input" placeholder="Job Title override" value={newTeam.title} onChange={e => setNewTeam({...newTeam, title: e.target.value})} />
                  </div>
                  <div>
                    <div className="text-[10px] mb-1">Additional Roles (for multi-role members)</div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {ADDITIONAL_ROLES.map(ar => (
                        <button key={ar} type="button" onClick={() => toggleNewTeamAddl(ar)} className={`text-[10px] px-1.5 py-px border rounded ${newTeam.additional.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{ar}</button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Contact Phone" value={newTeam.contact} onChange={e => setNewTeam({...newTeam, contact: e.target.value})} />
                    <select className="select" value={newTeam.timeZone} onChange={e => setNewTeam({...newTeam, timeZone: e.target.value})}>
                      {TIME_ZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Years Exp" value={newTeam.yearsExp} onChange={e => setNewTeam({...newTeam, yearsExp: e.target.value})} />
                    <input className="input" placeholder="Territories / Competencies" value={newTeam.competencies || newTeam.territories} onChange={e => setNewTeam({...newTeam, competencies: e.target.value})} />
                  </div>
                  <button onClick={addTeamMember} className="btn btn-primary text-sm w-full">Add / Link by Email (or create invite)</button>
                  {addMessage && <div className="text-xs text-[var(--text3)]">{addMessage}</div>}
                  <div className="text-[10px] text-[var(--text3)]">Existing account? Assigned immediately. New? Invitation record created (they sign up using 3 org tiles or login, then claim on signin).</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Current Team</h3>
                {members.length === 0 ? <p className="text-xs text-[var(--text3)]">No team members yet.</p> : (
                  <ul className="text-sm">
                    {members.map((m: any, i: number) => (
                      <li key={i} className="py-1 border-b border-[var(--border)] last:border-0">{m.first_name} {m.last_name} — {m.role || 'member'}{m.additional_roles?.length ? ' + ' + (Array.isArray(m.additional_roles)?m.additional_roles.join('+') : m.additional_roles) : ''} {m.email}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <p className="text-[10px] text-[var(--text3)]">
              Customer CRM has been moved out of this page per your request (will be added as its own permission-based section).
            </p>
          </>
        )}

        {(ownerMode || supplierMode) && (
          <p className="text-sm text-[var(--text3)]">
            {ownerMode
              ? 'Manage your lasers from My Lasers. Post service needs on the Marketplace.'
              : 'Manage catalog items from Parts and list inventory on the Marketplace.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Next.js requires Suspense around useSearchParams for static generation */
export default function CompanyProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-[var(--text3)]">
          Loading company profile…
        </div>
      }
    >
      <CompanyProfile />
    </Suspense>
  );
}