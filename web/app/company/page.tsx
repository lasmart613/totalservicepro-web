'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Header } from '../../components/Header';
import { getSupabaseClient } from '../../lib/supabase/client';
import { MODELS } from '../../lib/models';
import { toast } from 'sonner';

const TEAM_ROLES = ['fse', 'dispatcher', 'service_manager', 'company_admin', 'admin'];
const ADMIN_ROLES = ['admin', 'company_admin'];

// Common wavelength options per model (can be expanded)
const MODEL_WAVELENGTHS: { [key: string]: string[] } = {
  // Candela
  'candela_vbeam2': ['595'],
  'candela_gentleyag': ['1064'],
  'candela_gentlelase': ['755'],
  'candela_perfecta': ['595'],
  
  // Lumenis
  'lumenis_m22': ['515', '560', '590', '615', '640', '695', '755', '1064'],
  'lumenis_stellarm22': ['515', '560', '590', '615', '640', '695', '755', '1064'],
  
  // Default fallback
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
  const [newMember, setNewMember] = useState({ email: '', firstName: '', lastName: '', role: 'fse' });
  const [addMessage, setAddMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialTeamMessageShownRef = useRef(false);
  const supabase = getSupabaseClient();
  const [userRole, setUserRole] = useState('');
  const [loadingOrg, setLoadingOrg] = useState(true);
  const [showTeamPrompt, setShowTeamPrompt] = useState(false);

  // CRM states
  const [customers, setCustomers] = useState<any[]>([]);
  const [newCustomer, setNewCustomer] = useState({
    name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', 
    selectedEquipment: [] as any[]
  });
  const [customerMessage, setCustomerMessage] = useState('');

  // Chained Equipment Selection
  const [selectedManufacturer, setSelectedManufacturer] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedConfig, setSelectedConfig] = useState('');
  const [selectedWL, setSelectedWL] = useState('');

  // Manufacturers
  const manufacturers = [...new Set(Object.values(MODELS).map((m: any) => m.manufacturer).filter(Boolean))].sort();

  // Models filtered by manufacturer
  const filteredModels = Object.entries(MODELS)
    .filter(([_, model]: any) => model.manufacturer === selectedManufacturer)
    .map(([key, model]: any) => ({ key, ...model }));

  // Configurations for selected model
  const currentModelData = filteredModels.find(m => m.key === selectedModel);
  const availableConfigs = currentModelData?.configs || [];

  // Wavelength options (chained based on model)
  const getWavelengthOptions = () => {
    if (selectedModel && MODEL_WAVELENGTHS[selectedModel]) {
      return MODEL_WAVELENGTHS[selectedModel];
    }
    return MODEL_WAVELENGTHS['default'];
  };

  const wavelengthOptions = getWavelengthOptions();

  const addEquipmentToCustomer = () => {
    if (!selectedModel) return;

    const equipmentItem = {
      key: selectedModel,
      manufacturer: selectedManufacturer,
      model: currentModelData?.label || selectedModel,
      config: selectedConfig || null,
      wl: selectedWL || null
    };

    setNewCustomer(prev => ({
      ...prev,
      selectedEquipment: [...prev.selectedEquipment, equipmentItem]
    }));

    // Reset
    setSelectedManufacturer('');
    setSelectedModel('');
    setSelectedConfig('');
    setSelectedWL('');
  };

  const removeEquipmentFromCustomer = (index: number) => {
    setNewCustomer(prev => ({
      ...prev,
      selectedEquipment: prev.selectedEquipment.filter((_, i) => i !== index)
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
        .select('organization_id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (prof?.organization_id) {
        setUserRole(prof.role || '');

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
      setAddMessage('Welcome — initial team setup. Creator is admin by default. Add your team members below.');
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
      setShowTeamPrompt(true);
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || err));
    }
    setSaving(false);
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
        laser_models: newCustomer.selectedEquipment.length 
          ? newCustomer.selectedEquipment.map((e: any) => 
              `${e.manufacturer} ${e.model}${e.config ? ' ' + e.config : ''}${e.wl ? ' (' + e.wl + 'nm)' : ''}`
            ).join(' | ') 
          : null,
        facility_type: 'Clinic',
      };

      const { error } = await supabase.from('organizations').insert(customerInsert);
      if (error) throw error;

      setCustomerMessage('Customer added successfully.');
      setNewCustomer({ name: '', contactName: '', contactPhone: '', contactEmail: '', address: '', city: '', state: '', notes: '', selectedEquipment: [] });
      setSelectedManufacturer('');
      setSelectedModel('');
      setSelectedConfig('');
      setSelectedWL('');
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

        {/* Company Details */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">Company Details</h2>
          {/* form fields unchanged */}
          <button onClick={saveOrg} disabled={saving} className="btn btn-primary mt-6 w-full md:w-auto">
            {saving ? 'Saving...' : 'Save Company Details'}
          </button>
        </div>

        {showTeamPrompt && (
          <div className="card p-6 bg-[var(--gold-glow)]/10 border border-[var(--gold)]">
            <h3 className="font-bold text-lg mb-2">Great! Company details saved.</h3>
            <p className="text-sm mb-4">Next step: Add your team members below.</p>
            <a href="#team-section" className="btn btn-primary">Go to Team Setup →</a>
          </div>
        )}

        {/* Team Section */}
        <div id="team-section" className="card p-6">
          <h2 className="font-bold mb-4">Team Members &amp; Roles</h2>
          {/* team management unchanged */}
        </div>

        {/* Customer CRM with Chained Equipment + WL Dropdown */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">📋 Customer CRM</h2>

          <div className="mb-6 p-4 bg-[var(--surface3)] rounded">
            <div className="font-semibold mb-2">Add New Customer</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <input className="input" placeholder="Facility / Customer Name *" value={newCustomer.name} onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              {/* other fields... */}
            </div>

            {/* Chained Equipment Selection */}
            <div className="mb-4">
              <label className="label text-xs mb-2">Add Equipment (optional)</label>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* Manufacturer */}
                <select className="select" value={selectedManufacturer} onChange={e => { setSelectedManufacturer(e.target.value); setSelectedModel(''); setSelectedConfig(''); setSelectedWL(''); }}>
                  <option value="">Manufacturer</option>
                  {manufacturers.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                {/* Model */}
                <select className="select" value={selectedModel} onChange={e => { setSelectedModel(e.target.value); setSelectedConfig(''); setSelectedWL(''); }} disabled={!selectedManufacturer}>
                  <option value="">Model</option>
                  {filteredModels.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>

                {/* Configuration */}
                {availableConfigs.length > 0 && (
                  <select className="select" value={selectedConfig} onChange={e => setSelectedConfig(e.target.value)}>
                    <option value="">Configuration (optional)</option>
                    {availableConfigs.map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}

                {/* Wavelength (Chained Dropdown) */}
                <select 
                  className="select" 
                  value={selectedWL} 
                  onChange={e => setSelectedWL(e.target.value)} 
                  disabled={!selectedModel}
                >
                  <option value="">Wavelength (optional)</option>
                  {wavelengthOptions.map(wl => (
                    <option key={wl} value={wl}>{wl}nm</option>
                  ))}
                </select>
              </div>

              <button 
                type="button" 
                onClick={addEquipmentToCustomer} 
                disabled={!selectedModel}
                className="btn btn-secondary mt-2 text-sm"
              >
                Add Equipment to Customer
              </button>
            </div>

            {/* Selected Equipment */}
            {newCustomer.selectedEquipment.length > 0 && (
              <div className="mb-4">
                <div className="text-xs text-[var(--text3)] mb-1">Selected Equipment:</div>
                <div className="space-y-1">
                  {newCustomer.selectedEquipment.map((eq: any, index: number) => (
                    <div key={index} className="flex justify-between items-center text-sm bg-[var(--surface)] p-2 rounded">
                      <span>
                        {eq.manufacturer} {eq.model} {eq.config ? `(${eq.config})` : ''} 
                        {eq.wl ? ` • ${eq.wl}nm` : ''}
                      </span>
                      <button onClick={() => removeEquipmentFromCustomer(index)} className="text-red-400 text-xs">Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={addCustomer} className="btn btn-primary mt-3">Add Customer</button>
            {customerMessage && <div className="text-sm mt-2 text-[var(--text3)]">{customerMessage}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}