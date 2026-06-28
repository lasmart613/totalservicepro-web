'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { Upload, Users, Zap, Package, ArrowRight, Check, X } from 'lucide-react';
import { getSupabaseClient, claimPendingInvitations } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

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

const BRANDS = ['Candela','Lumenis','Cynosure','Cutera','Sciton','Syneron','Fotona','Alma','Quanta','HOYA ConBio','Iridex','Coherent','InMode','Lutronic'];
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
  const [existingOrgId, setExistingOrgId] = useState<number | null>(null);

  // Team state (ported + enhanced from Android onboarding + vision for RSP)
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

      const meta = user.user_metadata || {};
      setFormData((prev: any) => ({
        ...prev,
        firstName: profile?.first_name || meta.first_name || '',
        lastName: profile?.last_name || meta.last_name || '',
        phone: profile?.phone || '',
        jobTitle: profile?.job_title || ''
      }));

      if (profile?.organizations) {
        const o = profile.organizations;
        setExistingOrgId(o.id);
        let t: OrgType = 'service';
        if (o.type === 'customer') t = 'clinic';
        else if (o.type === 'parts_supplier' || o.type === 'vendor') t = 'supplier';
        setOrgType(t);
        setFormData((prev: any) => ({
          ...prev,
          companyName: o.name || '',
          address: o.address || '',
          city: o.city || '',
          state: o.state || '',
          phone: o.phone || profile.phone || '',
          website: o.website || ''
        }));
        if (o.supported_brands?.length) setSelectedBrands(o.supported_brands);
        if (o.logo_url) setLogoPreview(o.logo_url);
      } else {
        const initialRole = profile?.role || '';
        if (initialRole === 'company_admin' || initialRole.includes('admin')) {
          setOrgType('service');
        }
      }

      initTeamFromProfile(profile, user);
      setLoading(false);
    })();
  }, [supabase, router]);

  function initTeamFromProfile(profile: any, user: any) {
    const first = profile?.first_name || user?.user_metadata?.first_name || 'You';
    const last = profile?.last_name || user?.user_metadata?.last_name || '';
    const email = user?.email || '';
    const currentRole = profile?.role || 'company_admin';

    const creator: TeamMember = {
      id: 'creator',
      email,
      firstName: first,
      lastName: last,
      role: ADMIN_ROLES.includes(currentRole) ? currentRole : 'company_admin',
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

  // ===== Team & Roles (core for RSP onboarding) =====
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

  // Legacy kept for compat in old code paths
  function changeCreatorRole(newRole: string) {
    changeMemberRole( teamMembers.findIndex(m => m.isCreator) , newRole);
  }

  function toggleCreatorAdditional(role: string) {
    const idx = teamMembers.findIndex(m => m.isCreator);
    if (idx >= 0) toggleMemberAdditional(idx, role);
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
          const rolesText = [m.role, ...m.additionalRoles].filter(Boolean).join(' + ');
          return (
            <div key={m.id} className="p-3 border border-[var(--border)] rounded bg-[var(--surface3)]">
              <strong>{m.firstName} {m.lastName}</strong> {m.email && '• ' + m.email}<br/>
              <span className="text-[var(--text3)]">Roles: {rolesText}</span>
              <div className="mt-1 flex gap-2 flex-wrap items-center">
                <select value={m.role} onChange={e => changeMemberRole(idx, e.target.value)} className="input !py-0.5 !text-xs">
                  {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {ADDITIONAL_ROLES.map(ar => (
                  <button key={ar} type="button" onClick={() => toggleMemberAdditional(idx, ar)}
                    className={`text-[10px] px-1.5 py-px border rounded ${m.additionalRoles.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{ar}</button>
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

  async function saveOnboarding() {
    if (!currentUser) return;
    setLoading(true);
    try {
      let orgId = existingOrgId;
      const companyName = formData.companyName || 'My Service Company';

      let oType = 'service_company';
      if (orgType === 'clinic') oType = 'customer';
      else if (orgType === 'supplier') oType = 'parts_supplier';

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
      };

      if (orgId) {
        await supabase.from('organizations').update(orgPayload).eq('id', orgId);
      } else {
        orgPayload.created_by = currentUser.id;
        const { data: newOrg } = await supabase.from('organizations').insert(orgPayload).select('id').single();
        if (newOrg) orgId = newOrg.id;
      }

      // Team save (matches Android + best practices). Use invitations for non-existing (security). Support additional_roles (jsonb).
      const creator = teamMembers.find(m => m.isCreator) || teamMembers[0];
      const creatorRole = creator?.role || 'company_admin';
      const creatorAddl = creator?.additionalRoles || [];
      let finalJob = formData.jobTitle || 'Company Admin';
      if (creatorAddl.length > 0) {
        finalJob = `${finalJob} + ${creatorAddl.map(r => r).join(' + ')}`;
      }

      await supabase.from('user_profiles').upsert({
        id: currentUser.id,
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: currentUser.email,
        phone: formData.phone || null,
        job_title: finalJob,
        role: creatorRole,
        additional_roles: creatorAddl.length ? creatorAddl : null,
        organization_id: orgId,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      for (const m of teamMembers) {
        if (m.isCreator) continue;
        try {
          const { data: existing } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('email', m.email.toLowerCase())
            .maybeSingle();

          if (existing?.id) {
            await supabase.from('user_profiles').update({
              organization_id: orgId,
              role: m.role,
              additional_roles: m.additionalRoles.length ? m.additionalRoles : null,
              first_name: m.firstName || null,
              last_name: m.lastName || null,
              job_title: [m.role, ...m.additionalRoles].filter(Boolean).join(' + ')
            }).eq('id', existing.id);
          } else {
            await supabase.from('engineer_invitations').insert({
              organization_id: orgId,
              email: m.email,
              role: m.role,
              first_name: m.firstName || null,
              last_name: m.lastName || null,
              invited_by: currentUser.id,
              accepted: false
              // Note: additional roles can be extended in invitation table if needed, or set after claim
            });
          }
        } catch (te) { console.warn('Team member save skipped', te); }
      }

      await claimPendingInvitations(supabase, currentUser.id, currentUser.email);
      await supabase.auth.updateUser({ data: { first_name: formData.firstName, last_name: formData.lastName } });

      router.push('/company');
    } catch (e: any) {
      console.error('saveOnboarding error', e);
      alert('Save had issues: ' + (e.message || e) + ' — edit in Company page.');
      router.push('/company');
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
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Complete Your Setup</h1>
          <p className="text-[var(--text2)]">RSPs: add your team and roles now (sole props supported).</p>
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
                  <div className="font-bold">{t==='service' ? 'Repair Service Provider (RSP)' : t==='clinic' ? 'Laser Owner / Clinic' : 'Parts Supplier'}</div>
                  <div className="text-sm text-[var(--text3)]">Click to select</div>
                </button>
              ))}
            </div>
            <div className="mt-6 text-xs text-[var(--text3)]">FSEs are added as roles inside an RSP org (you can add during this flow or later in Company &gt; Team).</div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold">Your Details &amp; Company</h2>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">First Name *</label><input className="input" value={formData.firstName||''} onChange={e=>updateForm('firstName',e.target.value)} /></div>
              <div><label className="label">Last Name *</label><input className="input" value={formData.lastName||''} onChange={e=>updateForm('lastName',e.target.value)} /></div>
            </div>
            <div><label className="label">Company Name *</label><input className="input" value={formData.companyName||''} onChange={e=>updateForm('companyName',e.target.value)} /></div>
            <div><label className="label">Address</label><input className="input" value={formData.address||''} onChange={e=>updateForm('address',e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">City</label><input className="input" value={formData.city||''} onChange={e=>updateForm('city',e.target.value)} /></div>
              <div><label className="label">State</label><input className="input" value={formData.state||''} onChange={e=>updateForm('state',e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Phone</label><input className="input" value={formData.phone||''} onChange={e=>updateForm('phone',e.target.value)} /></div>
              <div><label className="label">Website</label><input className="input" value={formData.website||''} onChange={e=>updateForm('website',e.target.value)} /></div>
            </div>
          </div>
        )}

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
                    {TEAM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="mt-2">
                  <div className="text-xs text-[var(--text3)] mb-1">Additional roles (optional, for multi-role members)</div>
                  <div className="flex flex-wrap gap-1">
                    {ADDITIONAL_ROLES.map(ar => (
                      <button key={ar} type="button" onClick={() => toggleTeamAdditional(ar)}
                        className={`text-[10px] px-2 py-0.5 border rounded ${teamAdditional.includes(ar) ? 'bg-[var(--gold)] text-black' : ''}`}>{ar}</button>
                    ))}
                  </div>
                </div>
                <button onClick={addTeamMember} className="btn btn-secondary mt-3 w-full text-sm">+ Add Team Member</button>
                <div className="text-[10px] text-[var(--text3)] mt-1">If they don't have an account yet, an invitation is created. They sign up then get assigned (auto-claim on their login). Use invitations (not pre-create accounts) for security.</div>
              </div>
            )}

            <div className="text-xs text-[var(--text3)]">Validation: at least one admin required before continuing.</div>
          </div>
        )}

        {step === 3 && orgType !== 'service' && (
          <div>Team setup is primarily for Service Providers (RSP). You can manage later in Company page if applicable.</div>
        )}

        {step === 4 && (
          <div className="max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-4">Company Logo (optional)</h2>
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
            <h2 className="text-2xl font-bold mb-4">Specialties / Brands you service</h2>
            <div className="flex flex-wrap gap-2">
              {BRANDS.map(b => (
                <button key={b} type="button" onClick={() => toggleBrand(b)} className={`px-3 py-1 rounded-full border text-sm ${selectedBrands.includes(b) ? 'bg-[var(--gold)] text-black border-[var(--gold)]' : 'border-[var(--border)]'}`}>{b}</button>
              ))}
            </div>
            <p className="text-xs mt-3 text-[var(--text3)]">Used for manual library, AI, and Marketplace targeting.</p>
          </div>
        )}

        {step === 6 && (
          <div className="text-center">
            <Check className="mx-auto mb-4 text-[var(--gold)]" size={64} />
            <h2 className="text-3xl font-bold">Ready to go!</h2>
            <p className="my-4">Your org, profile, and team (if RSP) will be saved. You can always edit from Company page or Settings.</p>
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
