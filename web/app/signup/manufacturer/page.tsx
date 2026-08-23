'use client';

import React, { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';
import { applyPendingSignup, savePendingSignup, type PendingSignup } from '@/lib/pending-signup';
import { prepareFreshSignup } from '@/lib/auth-session';
import { useRedirectSignedInOrgToPlans } from '@/lib/use-redirect-signed-in-org';
import { listManufacturers } from '@/lib/laser-catalog';
import AuthOtpBox from '@/components/AuthOtpBox';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const BRANDS = listManufacturers();

export default function ManufacturerSignup() {
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
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = getSupabaseClient();
  useRedirectSignedInOrgToPlans();

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
  };

  function pendingPayload(): PendingSignup {
    return {
      kind: 'manufacturer',
      name: companyName,
      firstName,
      lastName,
      email,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      website: website || null,
      role: 'manufacturer',
      orgType: 'manufacturer',
      extra: {
        job_title: 'Manufacturer / OEM Contact',
        supported_brands: selectedBrands.length ? selectedBrands : null,
        bio: bio || null,
      },
    };
  }

  async function completeManufacturerSetup(userId: string) {
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
            role: 'manufacturer',
            organization_type: 'manufacturer',
            signup_kind: 'manufacturer',
            address: address || '',
            city: city || '',
            state: state || '',
            phone: phone || '',
            website: website || '',
          },
          emailRedirectTo: `${origin}/auth/callback?next=/`,
        },
      });
      if (authError) throw authError;

      const userId = authData.user?.id;

      if (authData.user && Array.isArray((authData.user as any).identities) && (authData.user as any).identities.length === 0) {
        throw new Error(
          'An account with this email already exists. Sign in at Login, or use Forgot password / Email me a sign-in code.'
        );
      }

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

      await completeManufacturerSetup(userId);
    } catch (err: any) {
      const msg = err.message || 'Manufacturer sign up failed.';
      if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists') || msg.toLowerCase().includes('duplicate')) {
        setMessage('An account with this email already exists. Please check your email (including spam) for a confirmation link from a previous signup attempt. You can also try signing in.');
      } else {
        setMessage(msg);
      }
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as Manufacturer</h1>
          <p className="text-sm text-[var(--text3)]">
            Laser OEMs and factories that make the machines. Factory and authorized
            service come later. Creates a manufacturer organization — not a repair company.
          </p>
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
                  await completeManufacturerSetup(uid);
                } catch (err: any) {
                  setMessage(err?.message || 'Verified, but setup failed. Sign in to finish.');
                  setMessageOk(false);
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : null}

          <form onSubmit={handleSubmit} className={`space-y-4 ${awaitingConfirm ? 'opacity-60 pointer-events-none' : ''}`}>
            <div>
              <label className="label">Manufacturer / OEM Name *</label>
              <input className="input" value={companyName} onChange={e => setCompanyName(e.target.value)} required placeholder="e.g. Candela, Sciton, Cynosure" />
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
              <label className="label">Email *</label>
              <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password * (min 6)</label>
                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input type="password" className="input" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
              </div>
            </div>

            <div>
              <label className="label">Phone</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className="label">Address</label>
                <input className="input" value={address} onChange={e => setAddress(e.target.value)} />
              </div>
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
              <input className="input" type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourbrand.com" />
            </div>

            <div>
              <label className="label">Brands / product lines</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {BRANDS.map((brand) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => toggleBrand(brand)}
                    className={`filter-chip text-xs py-1 px-3 ${selectedBrands.includes(brand) ? 'active' : ''}`}
                  >
                    {brand}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text3)]">Optional. Shown on the manufacturer profile.</p>
            </div>

            <div>
              <label className="label">About the factory / OEM</label>
              <textarea className="input" rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="What you make, regions, factory vs authorized service later…" />
            </div>

            {!awaitingConfirm && (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
              >
                {loading ? 'Creating manufacturer account...' : 'Create Manufacturer Account & Organization'}
              </button>
            )}
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>

        <p className="text-center text-xs text-[var(--text3)] mt-6">
          This creates a manufacturer organization (type manufacturer). Imported OEM
          service contacts stay repair companies. Factory and authorized service are later.
        </p>
      </div>
    </div>
  );
}
