'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Header } from '@/components/Header';
import { Upload, ArrowRight, Check } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { isOwnerish, isSupplier } from '@/lib/roles';
import { roleLabel } from '@/lib/labels';
import { listManufacturers, listModelsForManufacturer, OTHER_MODEL } from '@/lib/laser-catalog';
import { applyPendingSignup, resolvePendingSignup } from '@/lib/pending-signup';

type OrgType = 'service' | 'clinic' | 'supplier';
type TeamMember = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  additionalRoles: string[];
  isCreator?: boolean;
};

type LaserDraft = {
  id: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  notes: string;
};

const BRANDS = listManufacturers();
const SUPPLIER_CATEGORIES = [
  'Consumables (tips, fibers, dyes)',
  'Handpieces & Rebuild Kits',
  'Optics, Lenses, Mirrors',
  'Electronics / Boards / Power Supplies',
  'Gas, Coolant, DI Systems',
  'Safety / Interlock / E-Stop Parts',
  'Fibers & Delivery Systems',
  'Full Systems / Refurbs',
  'Other / Specialty Parts',
];
const TEAM_ROLES = ['company_admin', 'service_manager', 'fse', 'dispatcher', 'billing_manager', 'admin'];
const ADDITIONAL_ROLES = ['fse', 'dispatcher', 'service_manager', 'billing_manager'];
const ADMIN_ROLES = ['company_admin', 'admin'];

export default function Onboarding() {
  const supabase = getSupabaseClient();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [existingOrgId, setExistingOrgId] = useState<number | string | null>(null);
  const [existingOrgType, setExistingOrgType] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<string>('');

  // Team state (service company)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isSoleProp, setIsSoleProp] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [teamEmail, setTeamEmail] = useState('');
  const [teamFirst, setTeamFirst] = useState('');
  const [teamLast, setTeamLast] = useState('');
  const [teamRole, setTeamRole] = useState('fse');
  const [teamAdditional, setTeamAdditional] = useState<string[]>([]);

  // Clinic lasers (owner)
  const [lasers, setLasers] = useState<LaserDraft[]>([]);
  const [laserMfr, setLaserMfr] = useState('');
  const [laserModel, setLaserModel] = useState('');
  const [laserModelOther, setLaserModelOther] = useState('');
  const [laserSerial, setLaserSerial] = useState('');
  const [laserNotes, setLaserNotes] = useState('');
  const laserModelsForMfr = useMemo(() => listModelsForManufacturer(laserMfr), [laserMfr]);

  // Supplier categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  // Prefill from profile / auth on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*, organizations(*)')
        .eq('id', user.id)
        .maybeSingle();

      // Intended: already-onboarded users (org + flag) skip this wizard.
      // New service orgs keep onboarding_completed=false until Finish (see pending-signup).
      // Owners/suppliers with a linked org should not be trapped here if the flag did not persist.
      if (profile?.organization_id) {
        const orgTypeNow = profile.organizations?.type;
        const r = String(profile.role || '').toLowerCase();
        if (isOwnerish(profile.role, orgTypeNow)) {
          router.replace('/my-lasers');
          return;
        }
        if (isSupplier(profile.role, orgTypeNow)) {
          router.replace('/');
          return;
        }
        if (profile.onboarding_completed) {
          if (['fse', 'engineer', 'dispatcher', 'scheduler'].includes(r)) {
            router.replace('/hub');
          } else {
            router.replace('/company');
          }
          return;
        }
      }

      const meta = user.user_metadata || {};
      const pending = resolvePendingSignup(user);

      // Owner/rental first-run: finish facility here if signup verify did not persist the link.
      if (!profile?.organization_id && pending?.kind === 'owner') {
        try {
          await applyPendingSignup(supabase, user.id, pending);
          router.replace('/my-lasers?justSetup=1');
          return;
        } catch (e) {
          console.warn('onboarding owner apply', e);
        }
      }

      const resolvedRole = profile?.role || pending?.role || meta.role || '';
      setProfileRole(resolvedRole);
      setFormData((prev: any) => ({
        ...prev,
        firstName: profile?.first_name || meta.first_name || pending?.firstName || '',
        lastName: profile?.last_name || meta.last_name || pending?.lastName || '',
        phone: profile?.phone || meta.phone || pending?.phone || '',
        jobTitle: profile?.job_title || '',
        companyName: prev.companyName || pending?.name || meta.company || meta.facility || '',
        address: pending?.address || meta.address || '',
        city: pending?.city || meta.city || '',
        state: pending?.state || meta.state || '',
        website: pending?.website || meta.website || '',
      }));

      // Header chip: persist names immediately so we don't show the email prefix
      if ((meta.first_name || pending?.firstName) && !profile?.first_name) {
        await supabase
          .from('user_profiles')
          .update({
            first_name: meta.first_name || pending?.firstName || null,
            last_name: meta.last_name || pending?.lastName || null,
          })
          .eq('id', user.id);
      }

      let orgRow = profile?.organizations || null;
      if (!orgRow && profile?.organization_id) {
        const { data: fetchedOrg } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .maybeSingle();
        orgRow = fetchedOrg;
      }

      if (orgRow) {
        const o = orgRow;
        setExistingOrgId(o.id);
        setExistingOrgType(o.type || null);
        let t: OrgType = 'service';
        // Owner-side: clinic, legacy laser_clinic, rental, reseller
        if (
          o.type === 'customer' ||
          o.type === 'laser_clinic' ||
          o.type === 'laser_rental' ||
          o.type === 'laser_reseller'
        ) {
          t = 'clinic';
        } else if (o.type === 'parts_supplier' || o.type === 'vendor') {
          t = 'supplier';
        }
        setOrgType(t);
        setFormData((prev: any) => ({
          ...prev,
          companyName: o.name || prev.companyName || '',
          address: o.address || prev.address || '',
          city: o.city || prev.city || '',
          state: o.state || prev.state || '',
          phone: o.phone || profile.phone || prev.phone || '',
          website: o.website || prev.website || ''
        }));
        if (o.supported_brands?.length) setSelectedBrands(o.supported_brands);
        if (o.logo_url) setLogoPreview(o.logo_url);
      } else {
        // Prefer signup metadata / pending payload over a trigger-defaulted fse role
        const metaRole = String(meta.role || pending?.role || '').toLowerCase();
        const profileRoleNow = String(profile?.role || '').toLowerCase();
        const triggerDefaultedFse = profileRoleNow === 'fse' && metaRole && metaRole !== 'fse';
        const initialRole = triggerDefaultedFse ? metaRole : (profileRoleNow || metaRole);
        const orgKind = String(meta.organization_type || pending?.orgType || '').toLowerCase();
        if (initialRole === 'owner' || initialRole === 'customer' || orgKind === 'customer' || orgKind === 'laser_rental' || orgKind === 'laser_reseller' || orgKind === 'laser_clinic' || pending?.kind === 'owner') {
          setOrgType('clinic');
        } else if (initialRole === 'parts_supplier' || initialRole === 'supplier' || orgKind === 'parts_supplier' || pending?.kind === 'supplier') {
          setOrgType('supplier');
        } else if (
          initialRole === 'company_admin' ||
          initialRole === 'admin' ||
          String(initialRole).includes('admin') ||
          orgKind === 'service_company' ||
          pending?.kind === 'company'
        ) {
          setOrgType('service');
        }
      }

      initTeamFromProfile(profile, user);
      setLoading(false);
    })();
  }, [supabase, router]);

  // Auto-skip org type choice when signup already chose RSP / clinic / supplier
  useEffect(() => {
    if (orgType && step === 1) {
      setStep(2);
    }
  }, [orgType, step]);

  function initTeamFromProfile(profile: any, user: any) {
    const first = profile?.first_name || user?.user_metadata?.first_name || 'You';
    const last = profile?.last_name || user?.user_metadata?.last_name || '';
    const email = user?.email || '';
    const currentRole = profile?.role || '';

    // Preserve owner / supplier roles — only force admin for service creators
    let role = currentRole;
    if (isOwnerish(currentRole)) role = currentRole === 'customer' ? 'owner' : currentRole;
    else if (isSupplier(currentRole)) role = currentRole === 'supplier' ? 'parts_supplier' : currentRole;
    else if (!currentRole || currentRole === 'fse' || currentRole === 'pending') {
      // Email-confirm / trigger defaulted to fse with no org — founder must be admin
      if (!profile?.organization_id) role = 'company_admin';
    } else if (!ADMIN_ROLES.includes(currentRole) && !['service_manager', 'dispatcher', 'billing_manager'].includes(currentRole)) {
      role = 'company_admin';
    }
    if (!role) role = 'company_admin';

    const creator: TeamMember = {
      id: 'creator',
      email,
      firstName: first,
      lastName: last,
      role,
      additionalRoles: [],
      isCreator: true
    };
    setTeamMembers([creator]);
  }

  const handleTypeSelect = (type: OrgType) => {
    setOrgType(type);
    setStep(2);
  };

  const updateForm = (key: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [key]: value }));
  };

  function toggleSoleProp() {
    const newVal = !isSoleProp;
    setIsSoleProp(newVal);

    setTeamMembers(prev => {
      const updated = [...prev];
      const creatorIdx = updated.findIndex(m => m.isCreator);
      if (creatorIdx >= 0) {
        const c = { ...updated[creatorIdx] };
        if (!ADMIN_ROLES.includes(c.role)) c.role = 'company_admin';
        if (newVal && c.additionalRoles.length === 0) {
          c.additionalRoles = ['fse'];
        }
        updated[creatorIdx] = c;
      }
      return updated;
    });
  }

  function addTeamMember() {
    const email = teamEmail.trim();
    const first = teamFirst.trim();
    if (!email || !first) {
      alert('Email and first name required for team member');
      return;
    }
    if (teamMembers.some(m => m.email.toLowerCase() === email.toLowerCase())) {
      alert('Person already in team list');
      return;
    }
    const newM: TeamMember = {
      id: 'team-' + Date.now(),
      email,
      firstName: first,
      lastName: teamLast.trim(),
      role: teamRole,
      additionalRoles: [...teamAdditional],
      isCreator: false
    };
    setTeamMembers(prev => [...prev, newM]);
    setTeamEmail(''); setTeamFirst(''); setTeamLast('');
    setTeamAdditional([]);
  }

  function toggleTeamAdditional(role: string) {
    setTeamAdditional(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  }

  function removeTeamMember(idx: number) {
    setTeamMembers(prev => prev.filter((_, i) => i !== idx));
  }

  function validateTeam(): boolean {
    if (teamMembers.length === 0) return false;
    const hasAdmin = teamMembers.some(m =>
      ADMIN_ROLES.includes(m.role) ||
      m.additionalRoles.some(r => ADMIN_ROLES.includes(r))
    );
    return hasAdmin;
  }

  function renderTeamList() {
    return (
      <div className="space-y-2 mb-4 text-sm">
        {teamMembers.map((m, idx) => {
          const rolesText = [m.role, ...m.additionalRoles].filter(Boolean).map(roleLabel).join(' + ');
          return (
            <div key={m.id} className="p-3 border border-[var(--border)] rounded bg-[var(--surface3)]">
              <strong>{m.firstName} {m.lastName}</strong> {m.email && '• ' + m.email}<br/>
              <span className="text-[var(--text3)]">Roles: {rolesText}</span>
              <div className="mt-1 flex gap-2 flex-wrap items-center">
                <select value={m.role} onChange={e => changeMemberRole(idx, e.target.value)} className="input !py-0.5 !text-xs">
                  {TEAM_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </select>
                {ADDITIONAL_ROLES.map(ar => (
                  <button key={ar} type="button" onClick={() => toggleMemberAdditional(idx, ar)}
                    className={`text-[10px] px-1.5 py-px border rounded ${m.additionalRoles.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{roleLabel(ar)}</button>
                ))}
                {m.isCreator ? (
                  <span className="text-[10px] text-[var(--gold)]">(creator - must keep &gt;=1 admin)</span>
                ) : (
                  <button onClick={() => removeTeamMember(idx)} className="text-red-400 text-xs ml-2">Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function changeMemberRole(idx: number, newRole: string) {
    setTeamMembers(prev => prev.map((m, i) => i === idx ? { ...m, role: newRole } : m));
  }

  function toggleMemberAdditional(idx: number, role: string) {
    setTeamMembers(prev => prev.map((m, i) => {
      if (i !== idx) return m;
      const addl = m.additionalRoles.includes(role)
        ? m.additionalRoles.filter(r => r !== role)
        : [...m.additionalRoles, role];
      return { ...m, additionalRoles: addl };
    }));
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5*1024*1024) { alert('Max 5MB'); return; }
    setLogoFile(f);
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  function toggleBrand(b: string) {
    setSelectedBrands(prev => prev.includes(b) ? prev.filter(x=>x!==b) : [...prev, b]);
  }

  function toggleCategory(c: string) {
    setSelectedCategories(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function addLaserDraft() {
    const modelVal =
      laserModel === OTHER_MODEL ? laserModelOther.trim() : laserModel.trim();
    if (!laserMfr.trim() || !modelVal) {
      alert('Manufacturer and model are required');
      return;
    }
    setLasers(prev => [...prev, {
      id: 'l-' + Date.now(),
      manufacturer: laserMfr.trim(),
      model: modelVal,
      serial_number: laserSerial.trim(),
      notes: laserNotes.trim(),
    }]);
    setLaserMfr('');
    setLaserModel('');
    setLaserModelOther('');
    setLaserSerial('');
    setLaserNotes('');
  }

  function removeLaserDraft(id: string) {
    setLasers(prev => prev.filter(l => l.id !== id));
  }

  /** Resolve profile role without overwriting owner / parts_supplier to admin */
  function resolveCreatorRole(): string {
    if (orgType === 'clinic') {
      if (isOwnerish(profileRole)) return profileRole === 'customer' ? 'owner' : (profileRole || 'owner');
      return 'owner';
    }
    if (orgType === 'supplier') {
      if (isSupplier(profileRole)) return profileRole === 'supplier' ? 'parts_supplier' : (profileRole || 'parts_supplier');
      return 'parts_supplier';
    }
    // service company
    const creator = teamMembers.find(m => m.isCreator) || teamMembers[0];
    if (isOwnerish(creator?.role) || isSupplier(creator?.role)) {
      // Safety: never keep owner role on service org path if user switched type
      return creator?.role && ADMIN_ROLES.includes(creator.role) ? creator.role : 'company_admin';
    }
    return creator?.role || 'company_admin';
  }

  async function saveOnboarding() {
    if (!currentUser) return;
    if (!formData.companyName?.trim() || !formData.firstName?.trim()) {
      alert('Company / facility name and first name are required.');
      return;
    }
    if (orgType === 'service' && !validateTeam()) {
      alert('At least one admin (company_admin) is required for the organization.');
      return;
    }
    setLoading(true);
    try {
      let orgId = existingOrgId;
      const companyName = formData.companyName.trim();

      const metaType = String(currentUser.user_metadata?.organization_type || '');
      let oType = 'service_company';
      if (orgType === 'clinic') {
        if (existingOrgType && ['customer', 'laser_clinic', 'laser_rental', 'laser_reseller'].includes(existingOrgType)) {
          oType = existingOrgType;
        } else if (['laser_rental', 'laser_reseller', 'customer', 'laser_clinic'].includes(metaType)) {
          oType = metaType;
        } else {
          oType = 'customer';
        }
      } else if (orgType === 'supplier') oType = 'parts_supplier';

      let logoUrl = logoPreview;
      if (logoFile) {
        const ext = logoFile.name.split('.').pop() || 'png';
        const path = `${currentUser.id}/onboard-logo-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('logos').upload(path, logoFile, { upsert: true });
        if (!upErr) {
          const { data } = supabase.storage.from('logos').getPublicUrl(path);
          logoUrl = data.publicUrl;
        }
      }

      const orgPayload: any = {
        name: companyName,
        type: oType,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        phone: formData.phone || null,
        website: formData.website || null,
        supported_brands: selectedBrands.length ? selectedBrands : null,
        logo_url: logoUrl || null,
        // Free TSP Directory opt-in (product: free for all; no paywall)
        list_in_directory: !!formData.listInDirectory,
      };

      // Supplier categories stored in specialties if column exists (best-effort)
      if (orgType === 'supplier' && selectedCategories.length) {
        orgPayload.specialties = selectedCategories;
      }

      if (orgId) {
        let { error: uErr } = await supabase.from('organizations').update(orgPayload).eq('id', orgId);
        if (uErr && /list_in_directory|column/i.test(uErr.message || '')) {
          delete orgPayload.list_in_directory;
          await supabase.from('organizations').update(orgPayload).eq('id', orgId);
        }
      } else {
        orgPayload.created_by = currentUser.id;
        let { data: newOrg, error: iErr } = await supabase
          .from('organizations')
          .insert(orgPayload)
          .select('id')
          .single();
        if (iErr && /list_in_directory|column/i.test(iErr.message || '')) {
          delete orgPayload.list_in_directory;
          ({ data: newOrg, error: iErr } = await supabase
            .from('organizations')
            .insert(orgPayload)
            .select('id')
            .single());
        }
        if ((iErr || !newOrg) && orgType === 'clinic' && oType !== 'customer') {
          // Live CHECK/enum may only allow customer for owner-side orgs.
          orgPayload.type = 'customer';
          orgPayload.facility_type =
            orgPayload.facility_type ||
            (metaType === 'laser_rental'
              ? 'Rental fleet'
              : metaType === 'laser_reseller'
                ? 'Reseller inventory'
                : 'Clinic');
          ({ data: newOrg, error: iErr } = await supabase
            .from('organizations')
            .insert(orgPayload)
            .select('id')
            .single());
        }
        if (iErr || !newOrg) {
          throw new Error(iErr?.message || 'Could not create organization.');
        }
        orgId = newOrg.id;
      }

      const creatorRole = resolveCreatorRole();
      const creator = teamMembers.find(m => m.isCreator) || teamMembers[0];
      const creatorAddl = orgType === 'service' ? (creator?.additionalRoles || []) : [];
      let finalJob = formData.jobTitle || (
        orgType === 'clinic' ? 'Facility Manager' : orgType === 'supplier' ? 'Parts Supplier' : 'Company Admin'
      );
      if (creatorAddl.length > 0) {
        finalJob = `${finalJob} + ${creatorAddl.map(r => r).join(' + ')}`;
      }

      // Profile upsert — additional_roles / onboarding_completed_at may not exist on older DBs
      const profilePayload: any = {
        id: currentUser.id,
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: currentUser.email,
        phone: formData.phone || null,
        job_title: finalJob,
        role: creatorRole,
        organization_id: orgId,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      };
      if (creatorAddl.length) profilePayload.additional_roles = creatorAddl;

      let { error: profErr } = await supabase
        .from('user_profiles')
        .upsert(profilePayload, { onConflict: 'id' });

      // Retry without optional columns if schema lags
      if (profErr && /additional_roles|onboarding_completed_at|column/i.test(profErr.message || '')) {
        console.warn('profile upsert retry without optional cols', profErr.message);
        const slim = { ...profilePayload };
        delete slim.additional_roles;
        delete slim.onboarding_completed_at;
        ({ error: profErr } = await supabase
          .from('user_profiles')
          .upsert(slim, { onConflict: 'id' }));
      }
      if (profErr) {
        console.error('profile upsert', profErr);
        // Force-link org even if full upsert fails — still mark onboarding done
        const forcePayload: any = {
          organization_id: orgId,
          role: creatorRole,
          first_name: formData.firstName || null,
          last_name: formData.lastName || null,
          job_title: finalJob || null,
          onboarding_completed: true,
        };
        let { error: forceErr } = await supabase
          .from('user_profiles')
          .update(forcePayload)
          .eq('id', currentUser.id);
        if (forceErr && /column|additional_roles|onboarding_completed/i.test(forceErr.message || '')) {
          ({ error: forceErr } = await supabase
            .from('user_profiles')
            .update({
              organization_id: orgId,
              role: creatorRole,
              onboarding_completed: true,
            })
            .eq('id', currentUser.id));
        }
        if (forceErr) {
          console.error('profile force-link failed', forceErr);
          await supabase
            .from('user_profiles')
            .update({ onboarding_completed: true })
            .eq('id', currentUser.id);
        }
      }

      // Re-read linked org id so equipment RLS sees membership
      const { data: linked } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (linked?.organization_id != null) {
        orgId = linked.organization_id;
      }

      // Team invites only for service company — send real Auth invite emails
      if (orgType === 'service') {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        for (const m of teamMembers) {
          if (m.isCreator) continue;
          try {
            if (!token) throw new Error('Not signed in');
            const res = await fetch('/api/team/invite', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                email: m.email,
                role: m.role,
                firstName: m.firstName,
                lastName: m.lastName,
                jobTitle: [m.role, ...m.additionalRoles].filter(Boolean).join(' + '),
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              console.warn('invite failed', m.email, json);
              alert(`Could not email invite to ${m.email}: ${json.error || res.statusText}`);
            }
          } catch (te) { console.warn('Team member save skipped', te); }
        }
      }

      // Clinic lasers → equipment (must use customer_organization_id — not organization_id)
      let laserSaveErrors: string[] = [];
      let lasersSaved = 0;
      if (orgType === 'clinic' && orgId && lasers.length > 0) {
        // Ensure org.created_by is this user (helps RLS for just-created facilities)
        try {
          await supabase
            .from('organizations')
            .update({ created_by: currentUser.id })
            .eq('id', orgId)
            .is('created_by', null);
        } catch { /* ignore */ }

        for (const l of lasers) {
          const payload: any = {
            customer_organization_id: orgId,
            manufacturer: l.manufacturer,
            model: l.model,
            serial_number: (l.serial_number || '').trim() || 'TBD',
            notes: l.notes || null,
          };
          let { error: eqErr } = await supabase.from('equipment').insert(payload);
          if (eqErr) {
            // Retry minimal columns if optional fields missing
            const slim = {
              customer_organization_id: orgId,
              manufacturer: payload.manufacturer,
              model: payload.model,
              serial_number: payload.serial_number,
            };
            const r2 = await supabase.from('equipment').insert(slim);
            if (r2.error) {
              laserSaveErrors.push(`${l.manufacturer} ${l.model}: ${r2.error.message}`);
              console.error('equipment insert failed', r2.error);
            } else {
              lasersSaved++;
            }
          } else {
            lasersSaved++;
          }
        }
      }

      // Do not claim FSE invites onto a founder who just created this org
      await supabase.auth.updateUser({ data: { first_name: formData.firstName, last_name: formData.lastName } });

      if (laserSaveErrors.length) {
        alert(
          `Setup saved, but ${laserSaveErrors.length} laser(s) failed to save:\n` +
            laserSaveErrors.slice(0, 4).join('\n') +
            '\n\nAdd them under My Lasers.'
        );
      } else if (orgType === 'clinic' && lasers.length > 0) {
        // Soft confirm
        console.log(`Saved ${lasersSaved}/${lasers.length} facility lasers`);
      }

      // Clinic / supplier → Dashboard; service company → company profile to review team
      if (orgType === 'clinic') {
        router.push(lasersSaved > 0 ? '/my-lasers?justSetup=1' : '/?justSetup=1');
      } else if (orgType === 'supplier') {
        router.push('/?justSetup=1');
      } else {
        router.push('/company?justSetup=true');
      }
    } catch (e: any) {
      console.error('saveOnboarding error', e);
      alert('Save had issues: ' + (e.message || e) + '. Stay here and try Finish again.');
    } finally {
      setLoading(false);
    }
  }

  function nextStep() {
    if (step === 3 && orgType === 'service' && !validateTeam()) {
      alert('At least one admin (company_admin) is required for the organization.');
      return;
    }
    if (step < 6) {
      setStep(step + 1);
      if (step + 1 === 3 && orgType === 'service') {
        if (teamMembers.length === 0 && currentUser) initTeamFromProfile(null, currentUser);
      }
    } else {
      saveOnboarding();
    }
  }

  function prevStep() {
    if (step > 1) setStep(step - 1);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Header /><div>Loading setup…</div></div>;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Header />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Complete Your Setup</h1>
          <p className="text-[var(--text2)]">
            {orgType === 'clinic'
              ? 'Register your facility and lasers.'
              : orgType === 'supplier'
                ? 'Set up supplier categories and brands.'
                : 'RSPs: add your team and roles now (sole props supported).'}
          </p>
          <div className="flex justify-center gap-2 mt-4">
            {[1,2,3,4,5,6].map(s => <div key={s} className={`w-2.5 h-2.5 rounded-full ${step >= s ? 'bg-[var(--gold)]' : 'bg-[var(--surface3)]'}`} />)}
          </div>
          <div className="text-xs text-[var(--text3)] mt-1">Step {step} of 6</div>
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-semibold text-center mb-6">Confirm your organization type</h2>
            <div className="grid md:grid-cols-3 gap-4">
              {(['service','clinic','supplier'] as OrgType[]).map(t => (
                <button key={t} onClick={() => handleTypeSelect(t)} className={`card p-6 text-left hover:border-[var(--gold)] ${orgType===t ? 'border-[var(--gold)]' : ''}`}>
                  <div className="text-2xl mb-2">{t==='service'?'👷':t==='clinic'?'🏥':'📦'}</div>
                  <div className="font-bold">{t==='service' ? 'Repair Service Provider (RSP)' : t==='clinic' ? 'Laser Owner (Clinic / Rental / Reseller)' : 'Parts Supplier'}</div>
                  <div className="text-sm text-[var(--text3)]">Click to select</div>
                </button>
              ))}
            </div>
            <div className="mt-6 text-xs text-[var(--text3)]">FSEs are added as roles inside an RSP org (you can add during this flow or later in Company &gt; Team).</div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold">Review &amp; Complete Your Details</h2>
            <p className="text-sm text-[var(--text3)] -mt-3">Prefilled from your signup. Edit only if needed — these save to your profile and company record.</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">First Name *</label><input className="input" value={formData.firstName||''} onChange={e=>updateForm('firstName',e.target.value)} /></div>
              <div><label className="label">Last Name *</label><input className="input" value={formData.lastName||''} onChange={e=>updateForm('lastName',e.target.value)} /></div>
            </div>
            <div><label className="label">Job Title</label><input className="input" value={formData.jobTitle||''} onChange={e=>updateForm('jobTitle',e.target.value)} /></div>
            <div><label className="label">{orgType==='clinic' ? 'Facility Name *' : 'Company Name *'}</label><input className="input" value={formData.companyName||''} onChange={e=>updateForm('companyName',e.target.value)} /></div>
            <div><label className="label">Address</label><input className="input" value={formData.address||''} onChange={e=>updateForm('address',e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">City</label><input className="input" value={formData.city||''} onChange={e=>updateForm('city',e.target.value)} /></div>
              <div><label className="label">State</label><input className="input" value={formData.state||''} onChange={e=>updateForm('state',e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Phone</label><input className="input" value={formData.phone||''} onChange={e=>updateForm('phone',e.target.value)} /></div>
              <div><label className="label">Website</label><input className="input" value={formData.website||''} onChange={e=>updateForm('website',e.target.value)} /></div>
            </div>
            <label className="flex items-start gap-3 cursor-pointer card p-4">
              <input
                type="checkbox"
                className="mt-1 w-4 h-4 accent-[var(--gold)]"
                checked={!!formData.listInDirectory}
                onChange={(e) => updateForm('listInDirectory', e.target.checked)}
              />
              <span className="text-sm leading-snug">
                <strong>List my organization in the Total Service Pro directory for free</strong>
                <span className="block text-xs text-[var(--text3)] mt-1 font-normal">
                  Appears in the TSP Directory so other users can find you. Change anytime in Company Profile. Free for all org types.
                </span>
              </span>
            </label>
          </div>
        )}

        {/* Step 3: service team OR clinic lasers OR supplier skip note */}
        {step === 3 && orgType === 'service' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Team Members &amp; Roles</h2>
            <p className="text-sm text-[var(--text2)] mb-4">You (creator) start as admin. Change your role if needed. Add others (they get invited if not signed up yet). Must have ≥1 admin always. Sole props: check below for multi-role on one person.</p>

            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isSoleProp} onChange={toggleSoleProp} />
                <span>Sole proprietorship (I handle multiple roles: admin + FSE etc.)</span>
              </label>
            </div>

            {renderTeamList()}

            {!isSoleProp && (
              <div className="card p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="input" placeholder="Email" value={teamEmail} onChange={e=>setTeamEmail(e.target.value)} />
                  <input className="input" placeholder="First Name" value={teamFirst} onChange={e=>setTeamFirst(e.target.value)} />
                  <input className="input" placeholder="Last Name" value={teamLast} onChange={e=>setTeamLast(e.target.value)} />
                  <select className="select" value={teamRole} onChange={e=>setTeamRole(e.target.value)}>
                    {TEAM_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </div>
                <div className="mt-2">
                  <div className="text-xs text-[var(--text3)] mb-1">Additional roles (optional, for multi-role members)</div>
                  <div className="flex flex-wrap gap-1">
                    {ADDITIONAL_ROLES.map(ar => (
                      <button key={ar} type="button" onClick={() => toggleTeamAdditional(ar)}
                        className={`text-[10px] px-2 py-0.5 border rounded ${teamAdditional.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{roleLabel(ar)}</button>
                    ))}
                  </div>
                </div>
                <button onClick={addTeamMember} className="btn btn-secondary mt-3 w-full text-sm">+ Add Team Member</button>
                <div className="text-[10px] text-[var(--text3)] mt-1">If they don&apos;t have an account yet, an invitation is created. They sign up then get assigned (auto-claim on their login).</div>
              </div>
            )}

            <div className="text-xs text-[var(--text3)]">Validation: at least one admin required before continuing.</div>
          </div>
        )}

        {step === 3 && orgType === 'clinic' && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-bold mb-2">Lasers you own</h2>
            <p className="text-sm text-[var(--text3)] mb-4">Add systems registered to your facility (optional now — you can manage later in My Lasers).</p>

            <div className="card p-4 space-y-3 mb-4">
              <div>
                <label className="label">Manufacturer *</label>
                <select
                  className="input"
                  value={laserMfr}
                  onChange={(e) => {
                    setLaserMfr(e.target.value);
                    setLaserModel('');
                    setLaserModelOther('');
                  }}
                >
                  <option value="">Select brand…</option>
                  {BRANDS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Model *</label>
                <select
                  className="input"
                  value={laserModel}
                  onChange={(e) => setLaserModel(e.target.value)}
                  disabled={!laserMfr}
                >
                  <option value="">{laserMfr ? 'Select model…' : 'Select manufacturer first'}</option>
                  {laserModelsForMfr.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value={OTHER_MODEL}>Other / not listed…</option>
                </select>
                {laserModel === OTHER_MODEL && (
                  <input
                    className="input mt-2"
                    value={laserModelOther}
                    onChange={(e) => setLaserModelOther(e.target.value)}
                    placeholder="Enter model name"
                  />
                )}
              </div>
              <div>
                <label className="label">Serial #</label>
                <input className="input" value={laserSerial} onChange={e=>setLaserSerial(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="label">Room / notes</label>
                <input className="input" value={laserNotes} onChange={e=>setLaserNotes(e.target.value)} placeholder="Room, handpiece…" />
              </div>
              <button type="button" onClick={addLaserDraft} className="btn btn-secondary w-full text-sm">+ Add laser</button>
            </div>

            {lasers.length > 0 && (
              <ul className="space-y-2 mb-4">
                {lasers.map(l => (
                  <li key={l.id} className="card p-3 flex justify-between items-center text-sm">
                    <div>
                      <div className="font-bold text-[var(--gold)]">{l.manufacturer} {l.model}</div>
                      <div className="text-xs text-[var(--text3)]">{l.serial_number ? `SN ${l.serial_number}` : 'No serial'}{l.notes ? ` · ${l.notes}` : ''}</div>
                    </div>
                    <button type="button" className="text-red-400 text-xs" onClick={() => removeLaserDraft(l.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 3 && orgType === 'supplier' && (
          <div className="max-w-xl mx-auto">
            <h2 className="text-2xl font-bold mb-2">Parts categories</h2>
            <p className="text-sm text-[var(--text3)] mb-4">Select categories you supply (optional — refine later on Supplier Profile).</p>
            <div className="flex flex-wrap gap-2">
              {SUPPLIER_CATEGORIES.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`px-3 py-1.5 rounded-full border text-sm ${selectedCategories.includes(c) ? 'bg-[var(--gold)] text-black border-[var(--gold)]' : 'border-[var(--border)]'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-4">
              {orgType === 'clinic' ? 'Facility Logo (optional)' : 'Company Logo (optional)'}
            </h2>
            <div className="border-2 border-dashed p-8 text-center rounded-2xl cursor-pointer" onClick={() => document.getElementById('logoInput')?.click()}>
              {logoPreview ? <img src={logoPreview} alt="logo" className="max-h-20 mx-auto" /> : <Upload size={48} className="mx-auto mb-3" />}
              <div>Tap to choose logo (PNG/JPG)</div>
            </div>
            <input id="logoInput" type="file" accept="image/*" className="hidden" onChange={handleLogo} />
            {logoPreview && <button onClick={()=>{setLogoPreview(null);setLogoFile(null);}} className="text-xs mt-2 text-red-400">Remove</button>}
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="text-2xl font-bold mb-4">
              {orgType === 'supplier'
                ? 'Brands you stock'
                : orgType === 'clinic'
                  ? 'Brands at your facility (optional)'
                  : 'Specialties / Brands you service'}
            </h2>
            <div className="flex flex-wrap gap-2">
              {BRANDS.map(b => (
                <button key={b} type="button" onClick={() => toggleBrand(b)} className={`px-3 py-1 rounded-full border text-sm ${selectedBrands.includes(b) ? 'bg-[var(--gold)] text-black border-[var(--gold)]' : 'border-[var(--border)]'}`}>{b}</button>
              ))}
            </div>
            <p className="text-xs mt-3 text-[var(--text3)]">
              {orgType === 'supplier'
                ? 'Used for marketplace demand matching and catalog targeting.'
                : 'Used for manual library, AI, and Marketplace targeting.'}
            </p>
          </div>
        )}

        {step === 6 && (
          <div className="text-center">
            <Check className="mx-auto mb-4 text-[var(--gold)]" size={64} />
            <h2 className="text-3xl font-bold">Ready to go!</h2>
            <p className="my-4">
              {orgType === 'clinic'
                ? 'Your facility profile and lasers will be saved. Role stays owner.'
                : orgType === 'supplier'
                  ? 'Your supplier profile, categories, and brands will be saved. Role stays parts_supplier.'
                  : 'Your org, profile, and team (if RSP) will be saved. You can always edit from Company page or Settings.'}
            </p>
            <button onClick={saveOnboarding} disabled={loading} className="btn btn-primary px-10">Finish &amp; Continue →</button>
          </div>
        )}

        <div className="flex justify-between mt-10 max-w-xl mx-auto">
          <button onClick={prevStep} disabled={step===1} className="btn btn-secondary">Back</button>
          {step < 6 && <button onClick={nextStep} className="btn btn-primary flex items-center gap-2">Continue <ArrowRight size={18} /></button>}
        </div>
      </div>
    </div>
  );
}
