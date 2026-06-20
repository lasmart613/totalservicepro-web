'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const REGION_OPTIONS = [
  'Northeast US', 'Southeast US', 'Midwest US', 'Southwest US', 'West US / Pacific',
  'Nationwide', 'Canada', 'Mexico / LATAM', 'Europe', 'Other / International'
];

export default function FSESignup() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [experience, setExperience] = useState('');
  const [certifications, setCertifications] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const toggleRegion = (region: string) => {
    setSelectedRegions(prev =>
      prev.includes(region) ? prev.filter(r => r !== region) : [...prev, region]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    if (!firstName || !lastName || !email || !password) {
      setMessage('First name, last name, email and password are required.');
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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName } }
      });
      if (error) throw error;

      const userId = data.user?.id;
      if (!userId) {
        setMessage('Account created! Check your email to confirm, then sign in.');
        setLoading(false);
        return;
      }

      // Upsert profile with FSE role (individual; later added to a service_company org by its admin assigning organization_id + role 'fse')
      const profileData: any = {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        role: 'fse',
        job_title: 'Field Service Engineer',
        organization_id: null,
        onboarding_completed: false,
        // Extra marketplace fields (stored in profile json-ish or columns; flexible in Supabase)
        experience_years: experience ? parseInt(experience, 10) : null,
        certifications: certifications || null,
        preferred_regions: selectedRegions.length ? selectedRegions.join(', ') : null,
        bio: bio || null,
        linkedin_url: linkedin || null,
      };

      const { error: profileError } = await supabase.from('user_profiles').upsert(profileData, { onConflict: 'id' });
      if (profileError) {
        console.warn('Profile upsert warning (may need RLS):', profileError);
        // Continue anyway - user can edit in profile later
      }

      if (data.session) {
        router.push('/');
      } else {
        setMessage('Account created! Check your email to confirm, then sign in.');
        // Optionally auto-redirect after delay or stay
      }
    } catch (err: any) {
      const msg = err.message || 'Sign up failed. Please try again.';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists') || msg.toLowerCase().includes('duplicate')) {
        setMessage('An account with this email already exists. Please check your email (including spam) for a confirmation link from a previous signup attempt. If a prior signup failed after auth, a partial auth user may remain – try a different email or ask an admin to clean up the auth.users table in Supabase. You can also try signing in.');
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as FSE / Field Engineer</h1>
          <p className="text-sm text-[var(--text3)]">Individual laser service technicians and engineers. This creates a profile with role 'fse'. You will be added to a Service Company organization (by its company_admin or service_manager using the Team section at /company) to link your organization_id.</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">First Name *</label>
                <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="label">Last Name *</label>
                <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required />
              </div>
            </div>

            <div>
              <label className="label">Email *</label>
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
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>

            <div>
              <label className="label">Years of Experience</label>
              <input className="input" type="number" min="0" value={experience} onChange={e => setExperience(e.target.value)} placeholder="e.g. 8" />
            </div>

            <div>
              <label className="label">Certifications / Licenses</label>
              <textarea className="input" rows={2} value={certifications} onChange={e => setCertifications(e.target.value)} placeholder="Laser Safety Officer (LSO), Candela Certified, Coherent Factory Trained, etc." />
              <p className="text-[10px] text-[var(--text3)] mt-1">List key certs (comma or line separated ok)</p>
            </div>

            <div>
              <label className="label">Preferred Service Regions</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {REGION_OPTIONS.map(region => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => toggleRegion(region)}
                    className={`filter-chip text-xs py-1 px-3 ${selectedRegions.includes(region) ? 'active' : ''}`}
                  >
                    {region}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text3)]">Select all that apply. You can update later in profile.</p>
            </div>

            <div>
              <label className="label">Bio / Notes (optional)</label>
              <textarea className="input" rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Specialties, availability, notable clients or equipment expertise..." />
            </div>

            <div>
              <label className="label">LinkedIn or Resume Link (optional)</label>
              <input className="input" type="url" value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/yourname" />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating account...' : 'Create FSE Account'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          Your profile (role: 'fse') will be visible for marketplace matching and bidding. Sign up here first as individual. Then a Service Company admin adds you to their org (sets organization_id and confirms fse role) via /company Team section. After that, browse /marketplace to submit bids.
        </p>
      </div>
    </div>
  );
}
