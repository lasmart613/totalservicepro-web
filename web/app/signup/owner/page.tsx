'use client';

import React, { useState } from 'react';
import { getSupabaseClient, claimPendingInvitations } from '@/lib/supabase/client';
import { MODELS } from '@/lib/models';
import {
  OWNER_ORG_TYPE_SIGNUP_OPTIONS,
  defaultJobTitleForOwnerOrgType,
  ownerOrgTypeLabel,
  type OwnerOrgType,
} from '@/lib/org-types';
import AuthOtpBox from '@/components/AuthOtpBox';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

const PREFERRED_SERVICE_OPTIONS = [
  'Preventive Maintenance (PM)', 'Emergency / On-Call Repair', 'Install / Deinstall',
  'Calibration', 'Training', 'Full Service Contract', 'Parts Supply'
];

const modelKeys = Object.keys(MODELS);

interface EquipmentItem {
  modelKey: string;
  serialNumber: string;
}

export default function OwnerSignup() {
  const [orgKind, setOrgKind] = useState<OwnerOrgType>('customer');
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
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [currentSerial, setCurrentSerial] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [message, setMessage] = useState('');
  const [messageOk, setMessageOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = getSupabaseClient();

  const nameLabel =
    orgKind === 'laser_rental'
      ? 'Rental company name'
      : orgKind === 'laser_reseller'
        ? 'Reseller company name'
        : 'Facility name';

  const toggleService = (svc: string) => {
    setSelectedServices(prev =>
      prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
    );
  };

  const addEquipment = () => {
    if (!currentModel || !currentSerial.trim()) {
      setMessage('Please select a model and enter a serial number.');
      return;
    }
    setEquipmentList(prev => [...prev, { modelKey: currentModel, serialNumber: currentSerial.trim() }]);
    setCurrentModel('');
    setCurrentSerial('');
    setMessage('');
  };

  const removeEquipment = (index: number) => {
    setEquipmentList(prev => prev.filter((_, i) => i !== index));
  };

  async function completeOwnerSetup(userId: string) {
    const orgInsert: any = {
      name: facilityName,
      type: orgKind,
      address: address || null,
      city: city || null,
      state: state || null,
      phone: phone || null,
      facility_type: facilityType,
      num_lasers: numLasers ? parseInt(numLasers, 10) : null,
      preferred_services: selectedServices.length ? selectedServices.join(' | ') : null,
    };

    const { data: orgData, error: orgError } = await supabase
      .from('organizations')
      .insert(orgInsert)
      .select('id')
      .single();

    if (orgError) {
      console.error('Organization creation error:', orgError);
    }

    const newOrgId = orgData?.id ?? null;

    await supabase.from('user_profiles').upsert(
      {
        id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || null,
        role: 'owner',
        job_title: defaultJobTitleForOwnerOrgType(orgKind),
        organization_id: newOrgId,
        onboarding_completed: false,
        bio: bio || null,
      },
      { onConflict: 'id' }
    );

    await claimPendingInvitations(supabase, userId, email);

    let lasersSaved = 0;
    const laserErrors: string[] = [];
    if (newOrgId && equipmentList.length > 0) {
      for (const item of equipmentList) {
        const payload = {
          customer_organization_id: newOrgId,
          manufacturer: (MODELS as any)[item.modelKey]?.mfg || (MODELS as any)[item.modelKey]?.manufacturer || 'Unknown',
          model: (MODELS as any)[item.modelKey]?.label || item.modelKey,
          serial_number: (item.serialNumber || '').trim() || 'TBD',
        };
        const { error: equipError } = await supabase.from('equipment').insert(payload);
        if (equipError) {
          console.error('Equipment insert failed', equipError);
          laserErrors.push(payload.model + ': ' + equipError.message);
        } else {
          lasersSaved++;
        }
      }
    }

    if (laserErrors.length) {
      setMessage(
        `Account created. ${lasersSaved} laser(s) saved; ${laserErrors.length} failed. Finish under My Lasers.`
      );
      setMessageOk(true);
    }
    router.push(lasersSaved > 0 ? '/my-lasers?justSetup=1' : '/?justSetup=1');
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setMessageOk(false);

    if (!facilityName || !firstName || !lastName || !email || !password) {
      setMessage(`${nameLabel}, contact name, email and password are required.`);
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
      const origin =
        typeof window !== 'undefined' ? window.location.origin : 'https://repairplanet.net';
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName, last_name: lastName, facility: facilityName },
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

      await completeOwnerSetup(userId);
    } catch (err: any) {
      const msg = err.message || 'Owner sign up failed.';
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as Laser Owner</h1>
          <p className="text-sm text-[var(--text3)]">
            Clinics, rental companies, and resellers — My Lasers, service needs, and marketplace awards
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
                const uid = user?.id || pendingUserId;
                if (!uid) {
                  setMessage('Verified, but session is missing. Please sign in at Login.');
                  setMessageOk(false);
                  return;
                }
                setLoading(true);
                try {
                  await completeOwnerSetup(uid);
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
              <label className="label">Organization type *</label>
              <div className="space-y-2">
                {OWNER_ORG_TYPE_SIGNUP_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={
                      'flex gap-3 p-3 rounded-lg border cursor-pointer ' +
                      (orgKind === opt.value
                        ? 'border-[var(--gold)] bg-[var(--gold)]/10'
                        : 'border-[var(--border)] hover:border-[var(--gold)]/50')
                    }
                  >
                    <input
                      type="radio"
                      name="orgKind"
                      className="mt-1"
                      checked={orgKind === opt.value}
                      onChange={() => {
                        setOrgKind(opt.value);
                        if (opt.value === 'laser_rental') setFacilityType('Rental fleet');
                        else if (opt.value === 'laser_reseller') setFacilityType('Reseller inventory');
                        else if (facilityType === 'Rental fleet' || facilityType === 'Reseller inventory') {
                          setFacilityType('Clinic');
                        }
                      }}
                    />
                    <span>
                      <span className="font-semibold text-sm block">{opt.label}</span>
                      <span className="text-xs text-[var(--text3)]">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">{nameLabel} *</label>
              <input className="input" value={facilityName} onChange={e => setFacilityName(e.target.value)} required />
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
              <label className="label">Facility Type</label>
              <select className="select" value={facilityType} onChange={e => setFacilityType(e.target.value)}>
                {FACILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* NEW: Equipment Entry with Dropdowns + Serial Number */}
            <div>
              <label className="label">Equipment You Own</label>
              <div className="border border-[var(--border)] rounded p-4 bg-[var(--surface3)] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-[var(--text3)]">Model</label>
                    <select 
                      className="select" 
                      value={currentModel} 
                      onChange={e => setCurrentModel(e.target.value)}
                    >
                      <option value="">Select model...</option>
                      {modelKeys.map(key => (
                        <option key={key} value={key}>{MODELS[key]?.label || key}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text3)]">Serial Number</label>
                    <input 
                      className="input" 
                      placeholder="Serial #" 
                      value={currentSerial} 
                      onChange={e => setCurrentSerial(e.target.value)} 
                    />
                  </div>
                  <div className="flex items-end">
                    <button 
                      type="button" 
                      onClick={addEquipment} 
                      className="btn btn-secondary w-full"
                    >
                      Add Equipment
                    </button>
                  </div>
                </div>

                {/* List of added equipment */}
                {equipmentList.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {equipmentList.map((item, index) => (
                      <div key={index} className="flex justify-between items-center bg-[var(--surface)] p-2 rounded text-sm">
                        <span>
                          {MODELS[item.modelKey]?.label || item.modelKey} — <span className="font-mono">{item.serialNumber}</span>
                        </span>
                        <button 
                          type="button" 
                          onClick={() => removeEquipment(index)} 
                          className="text-red-400 hover:text-red-500 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-[var(--text3)] mt-1">Add each laser system you own with its serial number.</p>
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
              <textarea className="input" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="Current service provider, contract details..." />
            </div>

            {!awaitingConfirm && (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
              >
                {loading ? 'Creating account...' : 'Create Owner Account'}
              </button>
            )}
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}