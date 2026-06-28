'use client';

import React, { useState } from 'react';
import { getSupabaseClient, claimPendingInvitations } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const SERVICES_OFFERED = [
  'Preventive Maintenance (PM)', 'Emergency / On-Call Repair', 'Install / Deinstall',
  'Calibration', 'Training', 'Full Service Contract', 'Parts Supply'
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
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName, company: companyName } }
      });
      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) {
        setMessage('Account created! Check your email to confirm, then sign in to complete company setup and team onboarding.');
        setLoading(false);
        return;
      }

      // 2. Create organization (Repair Service Provider / service_company)
      const orgInsert: any = {
        name: companyName,
        type: 'service_company',
        address: address || null,
        city: city || null,
        state: state || null,
        phone: phone || null,
        website: website || null,
        services_offered: selectedServices.length ? selectedServices.join(' | ') : null,
        num_techs: numTechs ? parseInt(numTechs, 10) : null,
      };

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert(orgInsert)
        .select('id')
        .single();

      if (orgError) {
        console.warn('Org creation warning (may be RLS or duplicate):', orgError);
      }
      const newOrgId = orgData?.id ?? null;

      // 3. Create/update user profile as company_admin (creator). Onboarding + team roles handled in /onboarding
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
      };

      await supabase.from('user_profiles').upsert(profileData, { onConflict: 'id' });

      // 4. Claim any pending invites (in case email was pre-invited as FSE etc.)
      await claimPendingInvitations(supabase, userId, email);

      if (authData.session) {
        router.push('/onboarding');
      } else {
        setMessage('Account created! Check your email to confirm, then sign in. You will complete full onboarding + team setup next.');
      }
    } catch (err: any) {
      const msg = err.message || 'Service Organization sign up failed.';
      setMessage(msg);
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as Repair Service Provider (RSP)</h1>
          <p className="text-sm text-[var(--text3)]">Company/org that employs FSEs/techs. You become the admin; add team + roles (incl. sole prop) in next onboarding step.</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Company / Organization Name *</label>
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
              <label className="label">Phone</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div>
              <label className="label">Address</label>
              <input className="input" value={address} onChange={e => setAddress(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={state} onChange={e => setState(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Website</label>
              <input className="input" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
            </div>

            <div>
              <label className="label">Services Offered</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {SERVICES_OFFERED.map(svc => (
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
            </div>

            <div>
              <label className="label"># of Techs / FSEs (approx)</label>
              <input type="number" className="input" value={numTechs} onChange={e => setNumTechs(e.target.value)} />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating account &amp; organization...' : 'Create Service Organization Account'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
          <div className="mt-3 text-xs text-[var(--text3)] text-center">
            After signup you will complete company details + add team/roles (incl. sole proprietorship support) in Onboarding.
          </div>
        </div>
      </div>
    </div>
  );
}
