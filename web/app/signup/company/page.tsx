'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase/client';
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
      const orgInsert = {
        name: companyName,
        type: 'service_company',
        address: address || null,
        city: city || null,
        state: state || null,
        phone: phone || null,
        // website not in base type but flexible column or add later; Supabase accepts extra
        website: website || null,
        bio: bio || null,
        num_techs: numTechs ? parseInt(numTechs, 10) : null,
        tax_id: taxId || null,
        services_offered: selectedServices.length ? selectedServices.join(' | ') : null,
      };

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert(orgInsert)
        .select('id')
        .single();

      if (orgError) {
        console.error('Org create error (check RLS for authenticated inserts):', orgError);
        // Still proceed with profile, user can link org manually later or admin fixes
      }

      const newOrgId = orgData?.id ?? null;

      // 3. Upsert user profile linked to org with management role
      const profileData: any = {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        role: 'service_manager',
        job_title: 'Service Manager / Company Admin',
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
        // Success, go to dashboard (or /company to edit)
        router.push('/');
      } else {
        setMessage('Account created! Check your email to confirm, then sign in. Your company organization was created.');
      }
    } catch (err: any) {
      setMessage(err.message || 'Company sign up failed.');
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
              <label className="label">Company Bio / About</label>
              <textarea className="input" rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Years in laser service, specialties, coverage areas..." />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating company account...' : 'Create Company Account &amp; Organization'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Organization of type <code>service_company</code> will be created and linked to your profile (role: service_manager). You can manage company profile after login.
        </p>
      </div>
    </div>
  );
}
