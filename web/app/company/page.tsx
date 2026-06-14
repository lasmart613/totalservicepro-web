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
  const [showTeamPrompt, setShowTeamPrompt] = useState(false);

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
      setAddMessage('Welcome — initial team setup as part of new org onboarding. Creator is admin by default (pre-filled in roster). Add your team members below.');
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
      setShowTeamPrompt(true); // Show prompt to move to team section
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || err));
    }
    setSaving(false);
  }

  // ... (rest of the functions like uploadLogo, addTeamMember, updateMemberRole, loadCustomers, addCustomer remain the same as previous version)

  // For brevity in this response, the full supporting functions (uploadLogo, addTeamMember, etc.) are kept identical to the previous full file I provided.

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

        {/* Company Details Form */}
        <div className="card p-6">
          <h2 className="font-bold mb-4">Company Details</h2>
          {/* ... existing form fields for name, address, phone, website, logo ... */}
          <button onClick={saveOrg} disabled={saving} className="btn btn-primary mt-6 w-full md:w-auto">
            {saving ? 'Saving...' : 'Save Company Details'}
          </button>
        </div>

        {/* Success prompt after saving details */}
        {showTeamPrompt && (
          <div className="card p-6 bg-[var(--gold-glow)]/10 border border-[var(--gold)]">
            <h3 className="font-bold text-lg mb-2">Great! Your company details are saved.</h3>
            <p className="text-sm mb-4">Next step: Add your team members (FSEs, admins, dispatchers, schedulers, etc.).</p>
            <a href="#team-section" className="btn btn-primary">Go to Team Setup →</a>
          </div>
        )}

        {/* Team Management Section */}
        <div id="team-section" className="card p-6">
          <h2 className="font-bold mb-4">Team Members &amp; Roles</h2>
          {/* ... existing team add form and member list ... */}
          {members.length <= 1 && (
            <div className="mt-4 p-4 bg-[var(--surface3)] rounded text-sm">
              This is a new organization. Start by adding your first team members below. The creator is automatically set as <strong>company_admin</strong>.
            </div>
          )}
        </div>

        {/* Customer CRM Section (unchanged) */}
        {/* ... existing CRM section ... */}

        <p className="text-[10px] text-[var(--text3)]">
          After initial signup, focus on building your team here. Company details can be edited anytime.
        </p>
      </div>
    </div>
  );
}