'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase/client';
import { MODELS } from '../../../lib/models';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const FACILITY_TYPES = ['Hospital', 'Med Spa', 'Clinic', 'Private Practice', 'Surgery Center', 'Research / University', 'Other'];

const PREFERRED_SERVICE_OPTIONS = [
  'Preventive Maintenance (PM)', 'Emergency / On-Call Repair', 'Install / Deinstall',
  'Calibration', 'Training', 'Full Service Contract', 'Parts Supply'
];

const modelKeys = Object.keys(MODELS);

export default function OwnerSignup() {
  const [facilityName, setFacilityName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [facilityType, setFacilityType] = useState('Clinic');
  const [numLasers, setNumLasers] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const toggleModel = (key: string) => {
    setSelectedModels(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleService = (svc: string) => {
    setSelectedServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!facilityName || !firstName || !lastName || !email || !password) {
      setMessage('Facility name, contact name, email and password are required.');
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
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName, facility: facilityName } }
      });
      if (authError) throw authError;

      const userId = authData.user?.id;
      if (!userId) {
        setMessage('Account created! Check your email to confirm, then sign in to post service needs.');
        setLoading(false);
        return;
      }

      // Create customer organization
      // IMPORTANT: omit 'bio' from org insert to avoid schema cache errors if 'bio' column not yet added to organizations table.
      // (Bio collected here is saved to user_profiles.bio instead. Org-level bio for customers requires the migration.)
      const orgInsert: any = {
        name: facilityName,
        type: 'customer',
        address: address || null,
        city: city || null,
        state: state || null,
        phone: phone || null,
        facility_type: facilityType,
        num_lasers: numLasers ? parseInt(numLasers, 10) : null,
        laser_models: selectedModels.length ? selectedModels.join(', ') : null,
        preferred_services: selectedServices.length ? selectedServices.join(' | ') : null,
      };

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .insert(orgInsert)
        .select('id')
        .single();

      if (orgError) {
        console.error('Customer org create error (verify RLS):', orgError);
      }

      const newOrgId = orgData?.id ?? null;

      // Profile as owner
      const profileData: any = {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        role: 'owner',
        job_title: 'Facility / Equipment Manager',
        organization_id: newOrgId,
        onboarding_completed: false,
        bio: bio || null,
      };

      const { error: profErr } = await supabase.from('user_profiles').upsert(profileData, { onConflict: 'id' });
      if (profErr) console.warn('Profile upsert:', profErr);

      if (authData.session) {
        router.push('/marketplace'); // Nice: send owners straight to post a need
      } else {
        setMessage('Account created! Check your email to confirm, then sign in. Visit Marketplace to post service needs.');
      }
    } catch (err: any) {
      const msg = err.message || 'Owner sign up failed.';
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as Laser Owner / Facility</h1>
          <p className="text-sm text-[var(--text3)]">Hospitals, Med Spas, Clinics &amp; Practices • Post service needs in the marketplace</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('created') || message.includes('Check') || message.includes('Marketplace') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Facility / Company Name *</label>
              <input className="input" value={facilityName} onChange={e => setFacilityName(e.target.value)} required placeholder="Acme Dermatology &amp; Laser" />
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
              <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="456 Wellness Blvd" />
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
              <label className="label">Facility Type</label>
              <select className="select" value={facilityType} onChange={e => setFacilityType(e.target.value)}>
                {FACILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Number of Laser Systems</label>
              <input className="input" type="number" min="0" value={numLasers} onChange={e => setNumLasers(e.target.value)} placeholder="3" />
            </div>

            <div>
              <label className="label">Laser Models Owned (select all that apply)</label>
              <div className="max-h-36 overflow-auto border border-[var(--border2)] rounded p-2 bg-[var(--surface3)] grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                {modelKeys.map(key => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedModels.includes(key)}
                      onChange={() => toggleModel(key)}
                      className="accent-[var(--gold)]"
                    />
                    <span>{MODELS[key]?.label || key}</span>
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text3)] mt-1">Used to match you with qualified Service Companies and their FSE team members.</p>
            </div>

            <div>
              <label className="label">Preferred Service Types</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PREFERRED_SERVICE_OPTIONS.map(svc => (
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
              <label className="label">Notes / Bio (optional)</label>
              <textarea className="input" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="Current service provider, contract renewal dates, special requirements..." />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating owner account...' : 'Create Owner Account & Post Needs'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Organization of type <code>customer</code> created. After signup, visit <Link href="/marketplace" className="text-[var(--gold)] underline">Marketplace</Link> to post your first service need (then review bids from Service Companies and their FSEs and accept to create contracts).
        </p>
      </div>
    </div>
  );
}
