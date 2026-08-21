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
import { ownerDetailsLabel, ownerProfileLabel, roleLabel } from '@/lib/labels';
import { listManufacturers } from '@/lib/laser-catalog';
import { LOGO_ACCEPT, validateLogoFile } from '@/lib/customer-logo';
import { persistCustomerLogo } from '@/lib/customer-form';
import { saveOwnOrganizationProfile } from '@/lib/org-profile-client';

const FACILITY_TYPES = [
  'Hospital',
  'Med Spa',
  'Clinic',
  'Private Practice',
  'Surgery Center',
  'Research / University',
  'Rental fleet',
  'Reseller inventory',
  'Other',
];

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
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [inviteHistory, setInviteHistory] = useState<any[]>([]);
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
  const [linkedOrgId, setLinkedOrgId] = useState<string | number | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [newContact, setNewContact] = useState({
    first_name: '',
    last_name: '',
    title: '',
    phone: '',
    email: '',
  });
  const [savingContact, setSavingContact] = useState(false);

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
        setLinkedOrgId(prof.organization_id);
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
          if (isOwnerish(prof.role, orgData.type)) {
            await loadFacilityContacts(prof.organization_id);
          }
        }
      }
      setLoadingOrg(false);
    })();
  }, []);

  async function loadTeamMembers(orgId: any) {
    if (!orgId) return;

    // Prefer server list (bypasses RLS that only allows reading your own profile)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        // Sync links first, then list
        await fetch('/api/team/sync', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }).catch(() => null);

        const listRes = await fetch('/api/team/list', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        if (listRes.ok) {
          const json = await listRes.json();
          if (Array.isArray(json.members)) setMembers(json.members);
          if (Array.isArray(json.pendingInvites)) setPendingInvites(json.pendingInvites);
          if (Array.isArray(json.invites)) setInviteHistory(json.invites);
          return;
        } else {
          const errBody = await listRes.json().catch(() => ({}));
          console.warn('team list failed', listRes.status, errBody);
          // Don't scare users after onboarding for optional-column schema lag
          if (!/additional_roles/i.test(String(errBody.error || ''))) {
            toast.error(
              errBody.error ||
                'Could not load full team roster (server). Showing limited list.'
            );
          }
        }
      }
    } catch (e) {
      console.warn('team list non-fatal', e);
    }

    // Fallback: client query (may only return yourself under strict RLS)
    // additional_roles is optional — older DBs may not have the column yet
    const teamColsFull = 'id, first_name, last_name, email, role, job_title, additional_roles';
    const teamColsSafe = 'id, first_name, last_name, email, role, job_title';
    let { data: mems, error: memErr } = await supabase
      .from('user_profiles')
      .select(teamColsFull)
      .eq('organization_id', orgId);
    if (memErr && /additional_roles|column/i.test(memErr.message || '')) {
      ({ data: mems, error: memErr } = await supabase
        .from('user_profiles')
        .select(teamColsSafe)
        .eq('organization_id', orgId));
    }
    if (memErr) console.warn('team members client query', memErr);

    let loaded = mems || [];
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (currentUser && !loaded.some((m: any) => m.id === currentUser.id)) {
      let { data: selfProf, error: selfErr } = await supabase
        .from('user_profiles')
        .select(teamColsFull)
        .eq('id', currentUser.id)
        .maybeSingle();
      if (selfErr && /additional_roles|column/i.test(selfErr.message || '')) {
        ({ data: selfProf } = await supabase
          .from('user_profiles')
          .select(teamColsSafe)
          .eq('id', currentUser.id)
          .maybeSingle());
      }
      if (selfProf) loaded = [selfProf, ...loaded];
    }
    setMembers(loaded);

    // Fallback pending invites (often empty under RLS)
    try {
      const { data: invs } = await supabase
        .from('engineer_invitations')
        .select('id, email, role, first_name, last_name, created_at, accepted')
        .eq('organization_id', orgId)
        .eq('accepted', false)
        .order('created_at', { ascending: false });
      setPendingInvites(invs || []);
      setInviteHistory(invs || []);
    } catch {
      /* ignore */
    }
  }

  async function resendInviteEmail(email: string, role?: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not signed in');
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, role: role || 'fse' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Resend failed');
      if (json.inviteUrl && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(json.inviteUrl);
          toast.message('Invite link copied to clipboard');
        } catch {
          /* ignore */
        }
      }
      if (json.emailed) toast.success(`Invite email sent to ${email}`);
      else if (json.rateLimited) {
        toast.error(json.message || 'Invite email could not be sent. Use the copied link.', { duration: 12000 });
      } else toast.message(json.message || 'Invite processed', { duration: 10000 });
      await loadTeamMembers(org.id);
    } catch (e: any) {
      toast.error(e?.message || 'Resend failed');
    }
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
          list_in_directory: !!currentOrg.list_in_directory,
        };
        let { data: newOrgData, error: insErr } = await supabase
          .from('organizations')
          .insert(orgInsert)
          .select('id')
          .single();
        if (insErr && /list_in_directory|column/i.test(insErr.message || '')) {
          delete orgInsert.list_in_directory;
          ({ data: newOrgData, error: insErr } = await supabase
            .from('organizations')
            .insert(orgInsert)
            .select('id')
            .single());
        }
        if (newOrgData?.id) {
          currentOrg = { ...currentOrg, id: newOrgData.id, type: inferredType };
          setOrg(currentOrg);
          await ensureServiceCreatorLinked(supabase, newOrgData.id, inferredType);
          if (inferredType === 'service_company') {
            await loadTeamMembers(newOrgData.id);
          }
        }
      }

      const saveId = linkedOrgId ?? currentOrg.id;
      if (!saveId) throw new Error('No facility is linked to this account.');
      if (linkedOrgId != null && String(currentOrg.id) !== String(linkedOrgId)) {
        throw new Error('You can only edit your own facility profile.');
      }

      const updateData: Record<string, unknown> = {
        id: saveId,
        name: currentOrg.name ?? null,
        address: currentOrg.address ?? null,
        city: currentOrg.city ?? null,
        state: currentOrg.state ?? null,
        zip: currentOrg.zip ?? null,
        phone: currentOrg.phone ?? null,
        email: currentOrg.email ?? null,
        website: currentOrg.website ?? null,
        contact_name: currentOrg.contact_name ?? null,
        notes: currentOrg.notes ?? null,
        facility_type: currentOrg.facility_type ?? null,
        list_in_directory: !!currentOrg.list_in_directory,
        supported_brands: Array.isArray(currentOrg.supported_brands) ? currentOrg.supported_brands : null,
      };

      // Claimed owners: client PATCH is a silent RLS no-op (204, 0 rows).
      // Same service-role path as invite/claim — only the caller's linked org.
      const { data: sessionData } = await supabase.auth.getSession();
      const access = sessionData.session?.access_token;
      if (!access) throw new Error('Sign-in session missing. Sign in again to save.');
      const saved = await saveOwnOrganizationProfile(access, updateData);
      if (!saved.ok || !saved.org) throw new Error(saved.error || 'Save did not persist.');
      setOrg({ ...currentOrg, ...saved.org, id: saved.org.id ?? saveId });
      toast.success('Details saved.');
      if (serviceAdminMode) setShowTeamPrompt(true);
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || err));
    }
    setSaving(false);
  }

  async function uploadLogo(file: File) {
    const orgId = linkedOrgId ?? org.id;
    if (!orgId) {
      toast.error('Save facility details first, then upload a logo.');
      return;
    }
    const invalid = validateLogoFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploadingLogo(true);
    try {
      const url = await persistCustomerLogo(supabase, orgId, file);
      if (!url) throw new Error('Upload did not return a logo URL');
      const { data: sessionData } = await supabase.auth.getSession();
      const access = sessionData.session?.access_token;
      if (access) {
        const saved = await saveOwnOrganizationProfile(access, { id: orgId, logo_url: url });
        if (!saved.ok) throw new Error(saved.error || 'Logo file uploaded but profile did not save.');
        setOrg({ ...org, ...(saved.org || {}), logo_url: (saved.org?.logo_url as string) || url });
      } else {
        setOrg({ ...org, logo_url: url });
      }
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
    setAddMessage('Sending invite…');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || !org?.id) throw new Error('No org / not signed in');

      const em = newTeam.email.toLowerCase().trim();
      const chosenRole = newTeam.role || 'fse';
      const splitName = newTeam.fullName.trim().split(' ');
      const fn = splitName[0] || '';
      const ln = splitName.slice(1).join(' ') || '';

      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: em,
          role: chosenRole,
          firstName: fn,
          lastName: ln,
          jobTitle: newTeam.title || [chosenRole, ...(newTeam.additional || [])].join(' + '),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Invite failed');

      if (json.inviteUrl && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(json.inviteUrl);
        } catch {
          /* ignore */
        }
      }

      if (json.emailed) {
        toast.success(json.message || `Invite email sent to ${em}`);
      } else if (json.linked) {
        toast.success(json.message || 'Existing user linked to your org');
      } else if (json.rateLimited) {
        toast.error(
          json.message ||
            'Invite email could not be sent. Copy the invite link and send it yourself.',
          { duration: 15000 }
        );
      } else {
        toast.message(json.message || 'Invitation saved (email may not have been sent)', {
          description: json.inviteUrl || json.signupUrl || undefined,
          duration: 12000,
        });
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
      .in('type', ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'])
      .order('name');
    setCustomers(custs || []);
  }

  async function loadFacilityContacts(orgId?: string | number | null) {
    const id = orgId ?? linkedOrgId ?? org?.id;
    if (!id) {
      setContacts([]);
      return;
    }
    const { data, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, title, phone, email, is_primary')
      .eq('organization_id', id)
      .order('first_name', { ascending: true })
      .limit(50);
    if (error) {
      console.warn('facility contacts', error);
      setContacts([]);
      return;
    }
    setContacts(data || []);
  }

  async function addFacilityContact() {
    const orgId = linkedOrgId ?? org?.id;
    if (!orgId) {
      toast.error('Facility is not linked yet.');
      return;
    }
    const first = newContact.first_name.trim();
    if (!first) {
      toast.error('Contact first name is required.');
      return;
    }
    setSavingContact(true);
    try {
      const { error } = await supabase.from('contacts').insert({
        organization_id: orgId,
        first_name: first,
        last_name: newContact.last_name.trim() || null,
        title: newContact.title.trim() || null,
        phone: newContact.phone.trim() || null,
        email: newContact.email.trim() || null,
      });
      if (error) throw error;
      setNewContact({ first_name: '', last_name: '', title: '', phone: '', email: '' });
      toast.success('Contact added');
      await loadFacilityContacts(orgId);
    } catch (e: any) {
      toast.error(e?.message || 'Could not add contact');
    } finally {
      setSavingContact(false);
    }
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
    ? ownerProfileLabel(org?.type, org?.facility_type)
    : supplierMode
      ? 'Supplier Profile'
      : 'Company Management';
  const detailsTitle = ownerMode
    ? ownerDetailsLabel(org?.type, org?.facility_type)
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
            {ownerMode
              ? 'This is your clinic profile. Edit anything your service company prefilled, add a logo, extra contacts, and lasers. Changes save on this facility only.'
              : 'Onboarding complete! Your details, team (if added), and logo have been saved. Review or update company info below anytime. Use Settings for personal phone/job/role.'}
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
                <label className="label">ZIP</label>
                <input className="input" value={org.zip || ''} onChange={e => setOrg({ ...org, zip: e.target.value })} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={org.phone || ''} onChange={e => setOrg({ ...org, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={org.email || ''}
                  onChange={e => setOrg({ ...org, email: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Website</label>
                <input className="input" value={org.website || ''} onChange={e => setOrg({ ...org, website: e.target.value })} />
              </div>
              <div>
                <label className="label">Primary contact</label>
                <input
                  className="input"
                  value={org.contact_name || ''}
                  onChange={e => setOrg({ ...org, contact_name: e.target.value })}
                  placeholder="Name at the front desk / clinic"
                />
              </div>
              {ownerMode && (
                <div>
                  <label className="label">Facility type</label>
                  <select
                    className="select"
                    value={org.facility_type || ''}
                    onChange={e => setOrg({ ...org, facility_type: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {FACILITY_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Notes{ownerMode ? ' / hours' : ''}</label>
                <textarea
                  className="input min-h-[80px]"
                  value={org.notes || ''}
                  onChange={e => setOrg({ ...org, notes: e.target.value })}
                  placeholder={
                    ownerMode
                      ? 'Hours, access notes, parking, preferences…'
                      : 'Internal notes'
                  }
                />
              </div>
              {!ownerMode && (
              <div>
                <label className="label">Brands serviced</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {listManufacturers().map((b) => {
                    const selected = Array.isArray(org.supported_brands) && org.supported_brands.includes(b);
                    return (
                      <button
                        key={b}
                        type="button"
                        className={`text-xs px-2 py-1 rounded border ${
                          selected
                            ? 'bg-[var(--gold)] text-black border-[var(--gold)]'
                            : 'border-[var(--border)] text-[var(--text2)]'
                        }`}
                        onClick={() => {
                          const cur = Array.isArray(org.supported_brands) ? [...org.supported_brands] : [];
                          setOrg({
                            ...org,
                            supported_brands: selected ? cur.filter((x) => x !== b) : [...cur, b],
                          });
                        }}
                      >
                        {b}
                      </button>
                    );
                  })}
                </div>
              </div>
              )}
              <label className="flex items-start gap-3 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 accent-[var(--gold)]"
                  checked={!!org.list_in_directory}
                  onChange={(e) => setOrg({ ...org, list_in_directory: e.target.checked })}
                />
                <span className="text-sm font-semibold leading-snug">
                  List my organization in the Total Service Pro directory for free
                  <span className="block text-[11px] font-normal text-[var(--text3)] mt-0.5">
                    Appears in the{' '}
                    <a href="/directory" className="text-[var(--gold)] hover:underline">
                      TSP Directory
                    </a>{' '}
                    so others can find you. Change anytime. Free for all org types.
                  </span>
                </span>
              </label>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="label">Company Logo</label>
              {org.logo_url && <img src={org.logo_url} alt="Company logo" className="mb-3 max-h-24 rounded border" />}
              <input type="file" ref={fileInputRef} onChange={handleLogoSelect} accept={LOGO_ACCEPT} className="block w-full text-sm" disabled={uploadingLogo} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingLogo} className="btn btn-secondary mt-2 text-sm">
                {uploadingLogo ? 'Uploading...' : org.logo_url ? 'Replace logo' : 'Choose & Upload Logo'}
              </button>
              <p className="text-xs text-[var(--text3)] mt-2">PNG, JPG, WebP, or SVG. Max 2 MB.</p>
            </div>
          </div>

          <button onClick={saveOrg} disabled={saving} className="btn btn-primary mt-6 w-full md:w-auto">
            {saving
              ? 'Saving...'
              : ownerMode
                ? `Save ${ownerDetailsLabel(org?.type, org?.facility_type)}`
                : supplierMode
                  ? 'Save Supplier Details'
                  : 'Save Company Details'}
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
                      {TEAM_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                    </select>
                    <input className="input" placeholder="Job Title override" value={newTeam.title} onChange={e => setNewTeam({...newTeam, title: e.target.value})} />
                  </div>
                  <div>
                    <div className="text-[10px] mb-1">Additional Roles (for multi-role members)</div>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {ADDITIONAL_ROLES.map(ar => (
                        <button key={ar} type="button" onClick={() => toggleNewTeamAddl(ar)} className={`text-[10px] px-1.5 py-px border rounded ${newTeam.additional.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{roleLabel(ar)}</button>
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

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="font-semibold">Current Team</h3>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    onClick={async () => {
                      setAddMessage('Syncing team…');
                      await loadTeamMembers(org.id);
                      setAddMessage('');
                      toast.success('Team list refreshed');
                    }}
                  >
                    Refresh / sync invites
                  </button>
                </div>
                <p className="text-xs text-[var(--text3)] mb-2">{members.length} member(s)</p>
                {members.length === 0 ? <p className="text-xs text-[var(--text3)]">No team members yet.</p> : (
                  <ul className="text-sm">
                    {members.map((m: any, i: number) => (
                      <li key={m.id || i} className="py-2 border-b border-[var(--border)] last:border-0">
                        <div className="font-medium">
                          {[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[var(--surface3)] capitalize">
                            {roleLabel(m.role)}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--text3)]">{m.email || 'no email'}</div>
                        {m.job_title && (
                          <div className="text-xs text-[var(--text3)]">{m.job_title}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mb-6">
                <h3 className="font-semibold mb-2">
                  Pending invites ({pendingInvites.length})
                </h3>
                <p className="text-[10px] text-[var(--text3)] mb-2">
                  Invites that are still open, or accepted but not yet on the roster. Once someone finishes
                  setup they move to Current Team (not pending).
                </p>
                {pendingInvites.length === 0 ? (
                  <p className="text-xs text-[var(--text3)]">No pending invites.</p>
                ) : (
                  <ul className="text-sm">
                    {pendingInvites.map((inv: any) => (
                      <li
                        key={inv.id}
                        className="py-2 border-b border-[var(--border)] last:border-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium">{inv.email}</div>
                          <div className="text-xs text-[var(--text3)] capitalize">
                            {roleLabel(inv.role || 'fse')}
                            {inv.created_at
                              ? ` · invited ${new Date(inv.created_at).toLocaleDateString()}`
                              : ''}
                            {inv.accepted ? ' · marked accepted' : ' · waiting'}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary text-xs self-start"
                          onClick={() => resendInviteEmail(inv.email, inv.role)}
                        >
                          Resend / copy link
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {inviteHistory.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Invite history</h3>
                  <p className="text-[10px] text-[var(--text3)] mb-2">
                    All invite records for your organization (including completed).
                  </p>
                  <ul className="text-xs text-[var(--text2)] max-h-48 overflow-y-auto">
                    {inviteHistory.map((inv: any) => {
                      const onTeam = members.some(
                        (m: any) =>
                          (m.email || '').toLowerCase() === (inv.email || '').toLowerCase()
                      );
                      return (
                        <li
                          key={inv.id}
                          className="py-1.5 border-b border-[var(--border)] last:border-0 flex justify-between gap-2"
                        >
                          <span className="truncate">{inv.email}</span>
                          <span className="shrink-0 text-[var(--text3)]">
                            {onTeam
                              ? 'on team'
                              : inv.accepted
                                ? 'accepted'
                                : 'pending'}
                            {' · '}
                            {inv.created_at
                              ? new Date(inv.created_at).toLocaleDateString()
                              : '—'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <p className="text-sm text-[var(--text3)]">
              Add and manage customers from the{' '}
              <a href="/customers" className="text-[var(--gold)] hover:underline">
                Customer Directory
              </a>
              .
            </p>
          </>
        )}

        {ownerMode && (
          <div className="card p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-bold">Contacts</h2>
                <p className="text-xs text-[var(--text3)] mt-1">
                  Add people at this facility. Extra contacts are in addition to the primary contact above.
                </p>
              </div>
              <a href="/my-lasers" className="btn btn-secondary text-sm">
                Add / edit lasers
              </a>
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-[var(--text3)]">No extra contacts yet.</p>
            ) : (
              <ul className="text-sm divide-y divide-[var(--border)]">
                {contacts.map((c: any) => (
                  <li key={c.id} className="py-2 flex justify-between gap-3">
                    <span>
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                      {c.title ? <span className="text-[var(--text3)]"> · {c.title}</span> : null}
                    </span>
                    <span className="text-[var(--text3)] text-xs">
                      {[c.phone, c.email].filter(Boolean).join(' · ') || ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="First name *"
                value={newContact.first_name}
                onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Last name"
                value={newContact.last_name}
                onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Title"
                value={newContact.title}
                onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
              />
              <input
                className="input"
                placeholder="Phone"
                value={newContact.phone}
                onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
              />
              <input
                className="input sm:col-span-2"
                type="email"
                placeholder="Email"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary text-sm"
              disabled={savingContact}
              onClick={addFacilityContact}
            >
              {savingContact ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        )}

        {(ownerMode || supplierMode) && (
          <p className="text-sm text-[var(--text3)]">
            {ownerMode
              ? 'You can only edit this facility. Add lasers on My Lasers. Post service needs on the Marketplace.'
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