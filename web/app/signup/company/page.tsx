'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import AuthOtpBox from '@/components/AuthOtpBox';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';
import { applyPendingSignup, savePendingSignup, type PendingSignup } from '@/lib/pending-signup';
import { prepareFreshSignup } from '@/lib/auth-session';
import { useRedirectSignedInOrgToPlans } from '@/lib/use-redirect-signed-in-org';

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
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = getSupabaseClient();
  useRedirectSignedInOrgToPlans();

  const toggleService = (svc: string) => {
    setSelectedServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  function pendingPayload(): PendingSignup {
    return {
      kind: 'company',
      name: companyName,
      firstName,
      lastName,
      email,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      website: website || null,
      role: 'company_admin',
      orgType: 'service_company',
      extra: {
        job_title: 'Company Admin',
        services_offered: selectedServices.length ? selectedServices.join(' | ') : null,
        num_techs: numTechs ? parseInt(numTechs, 10) : null,
      },
    };
  }

  async function completeCompanySetup(userId: string) {
    const applied = await applyPendingSignup(supabase, userId, pendingPayload());
    router.push(applied.dest);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setMessageOk(false);
    if (!companyName || !firstName || !lastName || !email || !password) {
      setMessage('Company name, contact name, email and password are required.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setMessage('Passwords do not match.');
      return;
    }
    setLoading(true);

    try {
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      await prepareFreshSignup(supabase);
      savePendingSignup(pendingPayload());
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            company: companyName,
            role: 'company_admin',
            organization_type: 'service_company',
            signup_kind: 'company',
            address: address || '',
            city: city || '',
            state: state || '',
            phone: phone || '',
            website: website || '',
            services_offered: selectedServices.length ? selectedServices.join(' | ') : '',
          },
          emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
        },
      });
      if (authError) throw authError;

      const userId = authData.user?.id;

      if (authData.user && Array.isArray((authData.user as any).identities) && (authData.user as any).identities.length === 0) {
        throw new Error(
          'An account with this email already exists. Sign in at Login, or use Forgot password / Email me a sign-in code.'
        );
      }

      // Confirm email ON: signUp already sent the email — show OTP, do not resend immediately
      if (!authData.session || !userId) {
        setPendingUserId(userId || null);
        setAwaitingConfirm(true);
        setMessageOk(true);
        setMessage(
          'Account created! Check your email (and spam) for a confirmation code or link. Enter the code below.'
        );
        setLoading(false);
        return;
      }

      await completeCompanySetup(userId);
    } catch (err: any) {
      const msg = err.message || 'Repair company sign up failed.';
      setMessage(msg);
      setMessageOk(false);
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
          <h1 className="text-2xl font-bold mt-1">Register as a repair company</h1>
          <p className="text-sm text-[var(--text3)]">Repair companies and independent techs that service aesthetic and medical lasers. First user is admin. Invite field engineers from Team.</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${messageOk || message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          {awaitingConfirm ? (
            <AuthOtpBox
              email={email}
              password={password}
              mode="signup"
              onVerified={async () => {
                const { data: { user } } = await supabase.auth.getUser();
                const uid = user?.id;
                if (!uid || (pendingUserId && uid !== pendingUserId)) {
                  setMessage('Verified, but session is missing. Please sign in at Login.');
                  setMessageOk(false);
                  return;
                }
                setLoading(true);
                try {
                  await completeCompanySetup(uid);
                } catch (err: any) {
                  setMessage(err?.message || 'Verified, but company setup failed. Sign in and finish onboarding.');
                  setMessageOk(false);
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : null}

          <form onSubmit={handleSubmit} className={`space-y-4 ${awaitingConfirm ? 'opacity-60 pointer-events-none' : ''}`}>
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
                <label className="label">Password * (min {MIN_PASSWORD_LENGTH})</label>
                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input type="password" className="input" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
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
              <label className="label"># of technicians (approx)</label>
              <input type="number" className="input" value={numTechs} onChange={e => setNumTechs(e.target.value)} />
            </div>

            {!awaitingConfirm && (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
              >
                {loading ? 'Creating account…' : 'Create Repair company account'}
              </button>
            )}
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
          <div className="mt-3 text-xs text-[var(--text3)] text-center">
            Signup creates your account and repair company. Next you can review details, add your team, logo, and brands. Use Company for ongoing management.
          </div>
        </div>
      </div>
    </div>
  );
}
