'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const SERVICE_OPTIONS = [
  'Preventive Maintenance (PM)', 'Emergency Repair', 'Install / Commissioning',
  'Calibration & Alignment', 'Training / Operator Ed', 'Parts & Consumables',
  'Full Service Contracts', 'Laser Relocation', 'Safety Certification'
];

export default function CompanySignup() {
  const [companyName, setCompanyName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [website, setWebsite] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [numTechs, setNumTechs] = useState('');
  const [taxId, setTaxId] = useState('');
  const [bio, setBio] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [engineers, setEngineers] = useState<Array<{fullName: string, title: string, contact: string, timeZone: string, yearsExp: string, territories: string, competencies: string}>>([{fullName:'', title:'', contact:'', timeZone:'', yearsExp:'', territories:'', competencies:''}]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const toggleService = (svc: string) => {
    setSelectedServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!companyName || !firstName || !lastName || !email || !password) {
      setMessage('Company name, contact name, email and password are required.');
      return;
    }
    if (password.length < 6) {
      setMessage('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    setLoading(true);

    try {
      // 1. Sign up the user (contact person becomes manager)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName, company: companyName } }
      });
      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) {
        setMessage('Account created! Check email to confirm. Then sign in to complete company profile.');
        setLoading(false);
        return;
      }

      // 2. Create organization (type service_company)
      // IMPORTANT: only guaranteed columns for insert (name, type, address, city, state, phone, website + extra like num_techs etc that exist).
      // 'bio' on organizations requires running the ADD COLUMN migration + schema reload (see company/page.tsx and SQL below).
      // Bio from signup form is saved to user_profiles.bio (which has the column); org bio can be added later.
      const orgInsert = {
        name: companyName,
        type: 'service_company',
        address: address || null,
        city: city || null,
        state: state || null,
        phone: phone || null,
        // website not in base type but flexible column or add later; Supabase accepts extra
        website: website || null,
        num_techs: numTechs ? parseInt(numTechs, 10) : null,
        tax_id: taxId || null,
        services_offered: selectedServices.length ? selectedServices.join(' | ') : null,
      };

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert(orgInsert)
        .select('id')
        .single();

      let newOrgId = orgData?.id ?? null;
      if (orgError) {
        console.error('Org create error (check RLS for authenticated inserts):', orgError);
        // No longer silent: /company will auto-create + link org on save using user-entered fields (robust fallback)
        newOrgId = null;
      }

      // Thorough onboarding: after company creation, guide to /company for CRM setup, team, logo etc.
      // (profile upsert below will link it)

      // 3. Upsert user profile linked to org with management role
      const profileData: any = {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        role: 'company_admin',
        job_title: 'Company Admin',
        organization_id: newOrgId,
        onboarding_completed: false,
        bio: bio || null,
        // store services etc on org primarily
      };

      const { error: profileErr } = await supabase.from('user_profiles').upsert(profileData, { onConflict: 'id' });
      if (profileErr) {
        console.warn('Profile upsert warning:', profileErr);
      }

      if (authData.session) {
        // Redirect to /company which now robustly loads (or falls back to create on save) the org for new signups
        router.push('/company');
      } else {
        setMessage('Account created! Check your email to confirm, then sign in. Organization setup will be completed at /company (auto-creates if needed).');
      }
    } catch (err: any) {
      const msg = err.message || 'Company sign up failed.';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists') || msg.toLowerCase().includes('duplicate')) {
        setMessage('An account with this email already exists. Please check your email (including spam) for a confirmation link from a previous signup attempt. If a prior signup failed after auth but before organization/profile creation, a partial auth user may remain – try a different email or ask an admin to clean up the auth.users table in Supabase. You can also try signing in.');
      } else {
        setMessage(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <div className="max-w-lg mx-auto w-full px-4 py-8">
        <div className="text-center mb-6">
          <Link href="/signup" className="text-sm text-[var(--gold)] hover:underline">← All sign up options</Link>
          <div className="mt-2">
            <span className="font-extrabold text-2xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </div>
          <h1 className="text-2xl font-bold mt-1">Sign Up as Service Company</h1>
          <p className="text-sm text-[var(--text3)]">Create your company organization + manager account</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Company / Business Name *</label>
              <input className="input" value={companyName} onChange={e => setCompanyName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Contact First Name *</label>
                <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Contact Last Name *</label>
                <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required />
              </div>
            </div>

            <div>
              <label className="label">Contact Email *</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password * (min 6)</label>
                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input type="password" className="input" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
              </div>
            </div>

            <div>
              <label className="label">Company Phone</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div>
              <label className="label">Address</label>
              <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Tech Park Dr" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div>
                <label className="label">State / Province</label>
                <input className="input" value={state} onChange={e => setState(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Website</label>
              <input className="input" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourcompany.com" />
            </div>

            <div>
              <label className="label">Services Offered</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {SERVICE_OPTIONS.map(svc => (
                  <button
                    key={svc}
                    type="button"
                    onClick={() => toggleService(svc)}
                    className={`filter-chip text-xs py-1 px-3 ${selectedServices.includes(svc) ? 'active' : ''}`}
                  >
                    {svc}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text3)]">Multi-select. Shown on your company profile &amp; when bidding on marketplace needs.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label"># of FSEs / Techs</label>
                <input className="input" type="number" min="1" value={numTechs} onChange={e => setNumTechs(e.target.value)} placeholder="5" />
              </div>
              <div>
                <label className="label">Tax ID / EIN (optional)</label>
                <input className="input" value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="XX-XXXXXXX" />
              </div>
            </div>

            <div>
              <label className="label">Company Logo (upload later in Company if needed)</label>
              <input type="file" accept="image/*" onChange={e => setLogoFile(e.target.files?.[0] || null)} className="block w-full text-sm" />
            </div>

            <div>
              <label className="label">Service Engineers Details</label>
              <p className="text-xs text-[var(--text3)] mb-1">Add key info for each engineer (profile pics and more in /company)</p>
              {engineers.map((eng, i) => (
                <div key={i} className="mb-2 p-2 border border-[var(--border)] rounded text-xs space-y-1">
                  <input className="input text-xs py-1" placeholder="Full Name" value={eng.fullName} onChange={e=>{const c=[...engineers]; c[i].fullName=e.target.value; setEngineers(c);}} />
                  <div className="grid grid-cols-2 gap-1">
                    <input className="input text-xs py-1" placeholder="Title" value={eng.title} onChange={e=>{const c=[...engineers]; c[i].title=e.target.value; setEngineers(c);}} />
                    <input className="input text-xs py-1" placeholder="Contact" value={eng.contact} onChange={e=>{const c=[...engineers]; c[i].contact=e.target.value; setEngineers(c);}} />
                  </div>
                  <input className="input text-xs py-1" placeholder="Time Zone" value={eng.timeZone} onChange={e=>{const c=[...engineers]; c[i].timeZone=e.target.value; setEngineers(c);}} />
                  <div className="grid grid-cols-2 gap-1">
                    <input className="input text-xs py-1" placeholder="Years Exp" value={eng.yearsExp} onChange={e=>{const c=[...engineers]; c[i].yearsExp=e.target.value; setEngineers(c);}} />
                    <input className="input text-xs py-1" placeholder="Territories" value={eng.territories} onChange={e=>{const c=[...engineers]; c[i].territories=e.target.value; setEngineers(c);}} />
                  </div>
                  <input className="input text-xs py-1" placeholder="Competencies (makes/models)" value={eng.competencies} onChange={e=>{const c=[...engineers]; c[i].competencies=e.target.value; setEngineers(c);}} />
                </div>
              ))}
              <button type="button" onClick={() => setEngineers([...engineers, {fullName:'',title:'',contact:'',timeZone:'',yearsExp:'',territories:'',competencies:''}])} className="text-[10px] text-[var(--gold)]">+ Add Engineer</button>
            </div>

            <div>
              <label className="label">Company Bio / About</label>
              <textarea className="input" rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Years in laser service, specialties, coverage areas..." />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating company account...' : 'Create Company Account & Organization'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          First, org of type <code>service_company</code> is created + linked to your profile with role <code>company_admin</code> (creator is the admin by default). Redirects to /company for initial onboarding flow: use the Team section there to add people and their roles to the organization (multiple team members/roles supported: fse/dispatcher/service_manager/company_admin etc). The creator appears pre-populated as admin (can edit role in roster); each org must keep at least one admin. Sole proprietorships: one person holds admin (or other primary) + notes multiple roles via job_title. Roster + add form + CRM on /company. FSEs sign up individually then assigned here. (Parts supplier uses separate flow.)
        </p>
      </div>
    </div>
  );
}
