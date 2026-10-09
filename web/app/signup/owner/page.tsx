'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-constants';
import { applyPendingSignup, savePendingSignup, type PendingSignup } from '@/lib/pending-signup';
import { prepareFreshSignup } from '@/lib/auth-session';
import {
  CLAIM_INVITE_UNUSED,
  claimCustomerInvite,
  clearStaleClaimToken,
  ownerSignupAfterClaim,
  previewCustomerInvite,
} from '@/lib/customer-invite-client';
import { MODELS } from '@/lib/models';
import {
  OWNER_ORG_TYPE_SIGNUP_OPTIONS,
  defaultJobTitleForOwnerOrgType,
  type OwnerOrgType,
} from '@/lib/org-types';
import AuthOtpBox from '@/components/AuthOtpBox';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { clientAuthOrigin } from '@/lib/site-origin';
import { PublicLink, useT } from '@/lib/fa/locale';
import { useRouter, useSearchParams } from 'next/navigation';

const FACILITY_TYPES = [
  'Hospital',
  'Med Spa',
  'Clinic',
  'Private Practice',
  'Surgery Center',
  'Research / University',
  'Rental company',
  'Reseller inventory',
  'Other',
];

/** Clinic / practice / reseller — unchanged owner signup pills. */
const CLINIC_PREFERRED_SERVICE_OPTIONS = [
  'Preventive Maintenance (PM)',
  'Emergency / On-Call Repair',
  'Install / Deinstall',
  'Calibration',
  'Training',
  'Full Service Contract',
  'Parts Supply',
];

/** Rental fleet pills. Reuses existing signup names where they exist. */
const RENTAL_PREFERRED_SERVICE_OPTIONS = [
  'Preventive Maintenance (PM)',
  'On-site Repair',
  'Depot Repair',
  'Emergency / On-Call Repair',
  'Install / Deinstall',
  'Pickup / Delivery',
  'Calibration',
];

function isRentalOwnerSignup(orgKind: OwnerOrgType, facilityType: string): boolean {
  return orgKind === 'laser_rental' || /rental/i.test(facilityType);
}

const modelKeys = Object.keys(MODELS);

interface EquipmentItem {
  modelKey: string;
  serialNumber: string;
}

function OwnerSignupInner() {
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
  const [claimFailed, setClaimFailed] = useState(false);
  const claimFailedRef = useRef(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [claimLocked, setClaimLocked] = useState(false);
  const router = useRouter();
  const t = useT();
  const searchParams = useSearchParams();
  const supabase = getSupabaseClient();

  useEffect(() => {
    const qCompany = (searchParams.get('company') || '').trim();
    const qEmail = (searchParams.get('email') || '').trim();
    const qClaim = (searchParams.get('claim') || '').trim();
    if (qCompany) setFacilityName(qCompany);
    if (qEmail) setEmail(qEmail);
    if (!qClaim) return;
    setClaimToken(qClaim);
    let cancelled = false;
    previewCustomerInvite(qClaim).then((preview) => {
      if (cancelled || !preview.valid) return;
      if (preview.companyName) setFacilityName(preview.companyName);
      if (preview.email) setEmail(preview.email);
      setClaimLocked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const rentalSignup = isRentalOwnerSignup(orgKind, facilityType);
  const preferredServiceOptions = rentalSignup
    ? RENTAL_PREFERRED_SERVICE_OPTIONS
    : CLINIC_PREFERRED_SERVICE_OPTIONS;

  useEffect(() => {
    const allowed = new Set(preferredServiceOptions);
    setSelectedServices((prev) => {
      const next = prev.filter((s) => allowed.has(s));
      return next.length === prev.length ? prev : next;
    });
  }, [preferredServiceOptions]);

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

  function pendingPayload(): PendingSignup {
    return {
      kind: 'owner',
      name: facilityName,
      firstName,
      lastName,
      email,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      role: 'owner',
      orgType: orgKind,
      extra: {
        job_title: defaultJobTitleForOwnerOrgType(orgKind),
        facility_type: facilityType,
        preferred_services: selectedServices.length ? selectedServices.join(' | ') : null,
        bio: bio || null,
        num_laser_systems: numLasers ? parseInt(numLasers, 10) : null,
        claimToken: claimToken || null,
        equipment: equipmentList.map((item) => ({
          manufacturer:
            (MODELS as any)[item.modelKey]?.mfg ||
            (MODELS as any)[item.modelKey]?.manufacturer ||
            'Unknown',
          model: (MODELS as any)[item.modelKey]?.label || item.modelKey,
          serial_number: (item.serialNumber || '').trim() || 'TBD',
        })),
      },
    };
  }

  async function completeOwnerSetup(userId: string) {
    const pending = pendingPayload();
    savePendingSignup(pending);

    if (claimToken) {
      const { data: sessionData } = await supabase.auth.getSession();
      const access = sessionData.session?.access_token;
      const claimed = access
        ? await claimCustomerInvite(access, claimToken)
        : { claimed: false, error: 'Sign in required to claim this clinic profile.' };
      const next = ownerSignupAfterClaim({
        fromClaimLink: true,
        claimed: !!claimed.claimed,
        error: claimed.error,
      });
      if (next.action === 'claimed') {
        router.push('/company?justSetup=1');
        return;
      }
      await clearStaleClaimToken(supabase);
      claimFailedRef.current = true;
      setClaimFailed(true);
      setMessage('');
      setMessageOk(false);
      throw new Error(CLAIM_INVITE_UNUSED);
    }

    const applied = await applyPendingSignup(supabase, userId, pending);
    if (!applied.orgId) {
      throw new Error('Account verified, but a facility was not linked. Try Onboarding or sign in again.');
    }
    router.push(applied.dest || '/my-lasers?justSetup=1');
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setMessageOk(false);

    if (!facilityName || !firstName || !lastName || !email || !password) {
      setMessage(`${nameLabel}, contact name, email and password are required.`);
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
      const origin = clientAuthOrigin();
      await prepareFreshSignup(supabase);
      savePendingSignup(pendingPayload());
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            facility: facilityName,
            company: facilityName,
            role: 'owner',
            organization_type: orgKind,
            signup_kind: 'owner',
            address: address || '',
            city: city || '',
            state: state || '',
            phone: phone || '',
            facility_type: facilityType,
            preferred_services: selectedServices.length ? selectedServices.join(' | ') : '',
            claim_token: claimToken || '',
            ...(claimToken ? { signup_type: 'claim' } : {}),
          },
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
            safeRedirectPath(claimToken ? '/company?justSetup=1' : '/my-lasers', origin)
          )}`,
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
      if (!claimFailedRef.current) {
        const msg = err.message || 'Owner sign up failed.';
        setMessage(msg);
        setMessageOk(false);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <div className="max-w-lg mx-auto w-full px-4 py-8">
        <div className="text-center mb-6">
          <PublicLink href="/signup" className="text-sm text-[var(--gold)] hover:underline">{t('← All sign up options')}</PublicLink>
          <div className="mt-2">
            <span className="font-extrabold text-2xl" style={{ color: 'var(--gold)' }}>Total Service Pro</span>
          </div>
          <h1 className="text-2xl font-bold mt-1">
            {claimLocked ? t('Claim your clinic profile') : t('Sign up as a clinic or equipment owner')}
          </h1>
          <p className="text-sm text-[var(--text3)]">
            {claimLocked
              ? `Create a free account for ${facilityName || 'this clinic'} to view service history, upcoming service, and your equipment list.`
              : t('Hospitals, clinics, rental companies, and resellers — equipment list, service needs, and marketplace awards')}
          </p>
        </div>

        <div className="card p-6">
          {claimFailed ? (
            <div className="mb-4 p-3 rounded text-sm bg-red-900/30 text-red-400 space-y-2">
              <p>{t(CLAIM_INVITE_UNUSED)}</p>
              <PublicLink href="/login" className="inline-block font-semibold text-[var(--gold)] hover:underline">
                {t('Sign in')}
              </PublicLink>
            </div>
          ) : message ? (
            <div className={`mb-4 p-3 rounded text-sm ${messageOk || message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          ) : null}

          {awaitingConfirm && !claimFailed ? (
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
                  await completeOwnerSetup(uid);
                } catch (err: any) {
                  if (!claimFailedRef.current) {
                    setMessage(err?.message || 'Verified, but setup failed. Sign in to finish.');
                    setMessageOk(false);
                  }
                  throw err;
                } finally {
                  setLoading(false);
                }
              }}
            />
          ) : null}

          <form onSubmit={handleSubmit} className={`space-y-4 ${claimFailed ? 'hidden' : awaitingConfirm ? 'opacity-60 pointer-events-none' : ''}`}>
            <div>
              <label className="label">{t('Organization type *')}</label>
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
                        if (opt.value === 'laser_rental') setFacilityType('Rental company');
                        else if (opt.value === 'laser_reseller') setFacilityType('Reseller inventory');
                        else if (
                          facilityType === 'Rental company' ||
                          facilityType === 'Rental fleet' ||
                          facilityType === 'Reseller inventory'
                        ) {
                          setFacilityType('Clinic');
                        }
                      }}
                    />
                    <span>
                      <span className="font-semibold text-sm block">{t(opt.label)}</span>
                      <span className="text-xs text-[var(--text3)]">{t(opt.description)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">{t(nameLabel)} *</label>
              <input
                className="input"
                value={facilityName}
                onChange={e => setFacilityName(e.target.value)}
                required
                readOnly={claimLocked}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Contact First Name *')}</label>
                <input className="input" value={firstName} onChange={e => setFirstName(e.target.value)} required />
              </div>
              <div>
                <label className="label">{t('Contact Last Name *')}</label>
                <input className="input" value={lastName} onChange={e => setLastName(e.target.value)} required />
              </div>
            </div>

            <div>
              <label className="label">{t('Contact Email *')}</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                readOnly={claimLocked}
              />
              {claimLocked && (
                <p className="text-[11px] text-[var(--text3)] mt-1">
                  This invite is for the email on the clinic record.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('Password * (min 6)')}</label>
                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div>
                <label className="label">{t('Confirm Password *')}</label>
                <input type="password" className="input" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
              </div>
            </div>

            <div>
              <label className="label">{t('Phone')}</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div>
              <label className="label">{t('Address')}</label>
              <input className="input" value={address} onChange={e => setAddress(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('City')}</label>
                <input className="input" value={city} onChange={e => setCity(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('State')}</label>
                <input className="input" value={state} onChange={e => setState(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">{t('Facility Type')}</label>
              <select className="select" value={facilityType} onChange={e => setFacilityType(e.target.value)}>
                {FACILITY_TYPES.map((kind) => <option key={kind} value={kind}>{t(kind)}</option>)}
              </select>
            </div>

            {/* NEW: Equipment Entry with Dropdowns + Serial Number */}
            <div>
              <label className="label">{t('Equipment You Own')}</label>
              <div className="border border-[var(--border)] rounded p-4 bg-[var(--surface3)] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-[var(--text3)]">{t('Model')}</label>
                    <select 
                      className="select" 
                      value={currentModel} 
                      onChange={e => setCurrentModel(e.target.value)}
                    >
                      <option value="">{t('Select model...')}</option>
                      {modelKeys.map(key => (
                        <option key={key} value={key}>{MODELS[key]?.label || key}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text3)]">{t('Serial Number')}</label>
                    <input 
                      className="input" 
                      placeholder={t('Serial #')} 
                      value={currentSerial} 
                      onChange={e => setCurrentSerial(e.target.value)} 
                    />
                  </div>
                  <div className="flex items-end">
                    <button 
                      type="button" 
                      onClick={addEquipment} 
                      className="btn btn-secondary w-full"
                    >{t('Add Equipment')}</button>
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
                        >{t('Remove')}</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-[var(--text3)] mt-1">{t('Add each medical device you own with its serial number.')}</p>
            </div>

            <div>
              <label className="label">{t('Preferred Service Types')}</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {preferredServiceOptions.map(svc => (
                  <button
                    key={svc}
                    type="button"
                    onClick={() => toggleService(svc)}
                    className={`filter-chip text-xs py-1 px-3 ${selectedServices.includes(svc) ? 'active' : ''}`}
                  >
                    {t(svc)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">{t('Notes / Bio (optional)')}</label>
              <textarea className="input" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="Current service provider, contract details..." />
            </div>

            {!awaitingConfirm && (
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
              >
                {loading ? t('Creating account...') : claimLocked ? t('Create free account & claim profile') : t('Create Owner Account')}
              </button>
            )}
          </form>

          <div className="mt-5 text-center text-sm">
            <PublicLink
              href={claimToken && !claimFailed ? `/login?claim=${encodeURIComponent(claimToken)}&next=${encodeURIComponent('/company?justSetup=1')}` : '/login'}
              className="text-[var(--gold)] hover:underline"
            >
              {t('Already have an account? Sign in')}
            </PublicLink>
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnerSignupStatic() {
  const t = useT();
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-6">
      <div className="w-full max-w-md">
        <p className="text-sm font-semibold" style={{ color: 'var(--gold)' }}>Total Service Pro</p>
        <h1 className="text-2xl font-bold mt-1">{t('Sign up as a clinic or equipment owner')}</h1>
        <p className="text-sm text-[var(--text3)] mt-2">
          {t('Hospitals, clinics, rental companies, and resellers. Track medical devices and find biomedical service — lasers, lithotriptors, C-arms, and more.')}
        </p>
        <p className="text-[var(--text3)] mt-4">{t('Loading sign up…')}</p>
      </div>
    </div>
  );
}

export default function OwnerSignup() {
  return (
    <Suspense fallback={<OwnerSignupStatic />}>
      <OwnerSignupInner />
    </Suspense>
  );
}