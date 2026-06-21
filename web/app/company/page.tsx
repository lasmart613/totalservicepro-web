'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Header } from '@/components/Header';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MODELS } from '@/lib/models';
import { toast } from 'sonner';

const TEAM_ROLES = ['fse', 'dispatcher', 'service_manager', 'company_admin', 'admin'];
const ADMIN_ROLES = ['admin', 'company_admin'];

const MODEL_WAVELENGTHS: { [key: string]: string[] } = {
  'candela_vbeam2': ['595'],
  'candela_gentleyag': ['1064'],
  'candela_gentlelase': ['755'],
  'default': ['532', '595', '755', '1064', '10600']
};

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
  const [addMessage, setAddMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabaseClient();
  const [userRole, setUserRole] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [showTeamPrompt, setShowTeamPrompt] = useState(false);

  // Chained Equipment + Serial (for customer form)
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedConfig, setSelectedConfig] = useState('');
  const [selectedWL, setSelectedWL] = useState('');
  const [serialNumber, setSerialNumber] = useState('');

  const manufacturers = [...new Set(Object.values(MODELS).map((m: any) => m.manufacturer).filter(Boolean))].sort();
  const filteredModels = Object.entries(MODELS)
    .filter(([_, model]: any) => model.manufacturer === selectedManufacturer)
    .map(([key, model]: any) => ({ key, ...model }));

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
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Australia/Sydney',
    'Asia/Dubai',
    'Asia/Kolkata',
  ];

  const [newFSE, setNewFSE] = useState({ email: '', fullName: '', title: '', contact: '', timeZone: 'America/New_York', yearsExp: '', territories: '', competencies: '' });

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

      if (prof?.organization_id) {
        setUserRole(prof.role || '');
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', prof.organization_id)
          .single();
        if (orgData) {
          setOrg(orgData);
          await ensureCreatorIsAdmin(supabase, prof.organization_id);
          await loadTeamMembers(prof.organization_id);
          await loadCustomers();
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
    if (currentUser && !loaded.some((m: any) => m.id === currentUser.id)) {
      const { data: selfProf } = await supabase.from('user_profiles').select('id, first_name, last_name, email, role, job_title').eq('id', currentUser.id).maybeSingle();
      if (selfProf) loaded = [selfProf, ...loaded];
    }
    setMembers(loaded);
  }

  async function saveOrg() {
    setSaving(true);
    try {
      let currentOrg = org;
      if (!currentOrg?.id) {
        const orgInsert: any = {
          name: currentOrg.name || 'My Company',
          type: 'service_company',
          address: currentOrg.address ?? null,
          city: currentOrg.city ?? null,
          state: currentOrg.state ?? null,
          phone: currentOrg.phone ?? null,
          website: currentOrg.website ?? null,
        };
        const { data: newOrgData } = await supabase.from('organizations').insert(orgInsert).select('id').single();
        if (newOrgData?.id) {
          currentOrg = { ...currentOrg, id: newOrgData.id };
          setOrg(currentOrg);
          await ensureCreatorIsAdmin(supabase, newOrgData.id);
          await loadTeamMembers(newOrgData.id);
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
      setShowTeamPrompt(true);
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
    if (!newFSE.email || !newFSE.fullName) {
      setAddMessage('Email and full name required for FSE.');
      return;
    }
    setAddMessage('Adding FSE... (in full impl, would invite or link profile by email, set org/role/timezone etc.)');
    // For now, toast and clear. In real, query user_profiles by email or send invite, update org_id, role='fse', and save extra fields like timeZone.
    toast.success(`FSE ${newFSE.fullName} details captured. Time Zone: ${newFSE.timeZone}. Link via /company Team or invite.`);
    setNewFSE({ email: '', fullName: '', title: '', contact: '', timeZone: 'America/New_York', yearsExp: '', territories: '', competencies: '' });
    setAddMessage('');
    // TODO: actual profile link logic
  }

  async function loadCustomers() {
    const { data: custs } = await supabase.from('organizations').select('*').eq('type', 'customer').order('name');
    setCustomers(custs || []);
  }

  async function addCustomer() {
    if (!newCustomer.name) { setCustomerMessage('Customer name is required.'); return; }
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
      await supabase.from('organizations').insert(customerInsert);
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
        {loadingOrg && <div className="mb-4 text-center text-xs py-1.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text3)]">Loading company profile…</div>}
        <h1 className="text-2xl font-extrabold">🏢 Company Management</h1>

        {/* Company Details Form - FULLY RESTORED */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">Company Details</h2>
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
            {saving ? 'Saving...' : 'Save Company Details'}
          </button>
        </div>

        {showTeamPrompt && (
          <div className="card p-6 bg-[var(--gold-glow)]/10 border border-[var(--gold)]">
            <h3 className="font-bold text-lg mb-2">Great! Company details saved.</h3>
            <p className="text-sm mb-4">Next step: Build your team below.</p>
            <a href="#team-section" className="btn btn-primary">Go to Team Setup →</a>
          </div>
        )}

        {/* Team Section */}
        <div id="team-section" className="card p-6">
          <h2 className="font-bold mb-4">Team Members &amp; Roles</h2>
          <div className="mb-4">
            <h3 className="font-semibold mb-2">Add FSE / Engineer</h3>
            <div className="space-y-2 text-sm">
              <input className="input" placeholder="FSE Email (must have account)" value={newFSE.email} onChange={e => setNewFSE({...newFSE, email: e.target.value})} />
              <input className="input" placeholder="Full Name" value={newFSE.fullName} onChange={e => setNewFSE({...newFSE, fullName: e.target.value})} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Title" value={newFSE.title} onChange={e => setNewFSE({...newFSE, title: e.target.value})} />
                <input className="input" placeholder="Contact" value={newFSE.contact} onChange={e => setNewFSE({...newFSE, contact: e.target.value})} />
              </div>
              <div>
                <label className="text-xs">Time Zone</label>
                <select className="select" value={newFSE.timeZone} onChange={e => setNewFSE({...newFSE, timeZone: e.target.value})}>
                  {TIME_ZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Years Experience" value={newFSE.yearsExp} onChange={e => setNewFSE({...newFSE, yearsExp: e.target.value})} />
                <input className="input" placeholder="Territories" value={newFSE.territories} onChange={e => setNewFSE({...newFSE, territories: e.target.value})} />
              </div>
              <input className="input" placeholder="Competencies (e.g. Lumenis CO2, Candela)" value={newFSE.competencies} onChange={e => setNewFSE({...newFSE, competencies: e.target.value})} />
              <button onClick={addTeamMember} className="btn btn-primary text-sm w-full">Add / Link FSE</button>
              {addMessage && <div className="text-xs text-[var(--text3)]">{addMessage}</div>}
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Current Team</h3>
            {members.length === 0 ? <p className="text-xs text-[var(--text3)]">No team members yet.</p> : (
              <ul className="text-sm">
                {members.map((m: any, i: number) => (
                  <li key={i} className="py-1 border-b border-[var(--border)] last:border-0">{m.first_name} {m.last_name} — {m.role || 'member'} {m.email}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <p className="text-[10px] text-[var(--text3)]">
          Customer CRM has been moved out of this page per your request (will be added as its own permission-based section).
        </p>
      </div>
    </div>
  );
}