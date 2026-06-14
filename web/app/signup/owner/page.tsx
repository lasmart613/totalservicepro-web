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

interface EquipmentItem {
  modelKey: string;
  serialNumber: string;
}

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
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [currentSerial, setCurrentSerial] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
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
      // 1. Create auth user
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

      // 2. Create organization (Laser Clinic / Customer)
      const orgInsert: any = {
        name: facilityName,
        type: 'customer',
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

      // 3. Create user profile as owner
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

      await supabase.from('user_profiles').upsert(profileData, { onConflict: 'id' });

      // 4. Insert individual equipment records (if any were added)
      if (newOrgId && equipmentList.length > 0) {
        const equipmentRows = equipmentList.map(item => ({
          organization_id: newOrgId,
          manufacturer: MODELS[item.modelKey]?.manufacturer || 'Unknown',
          model: MODELS[item.modelKey]?.label || item.modelKey,
          serial_number: item.serialNumber,
          status: 'Active',
        }));

        const { error: equipError } = await supabase.from('equipment').insert(equipmentRows);
        if (equipError) {
          console.warn('Equipment insert warning:', equipError);
        }
      }

      if (authData.session) {
        router.push('/marketplace');
      } else {
        setMessage('Account created! Check your email to confirm, then sign in and visit Marketplace to post service needs.');
      }
    } catch (err: any) {
      const msg = err.message || 'Owner sign up failed.';
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
          <h1 className="text-2xl font-bold mt-1">Sign Up as Laser Owner / Facility</h1>
          <p className="text-sm text-[var(--text3)]">Hospitals, Med Spas, Clinics &amp; Practices • Post service needs in the marketplace</p>
        </div>

        <div className="card p-6">
          {message && (
            <div className={`mb-4 p-3 rounded text-sm ${message.includes('created') || message.includes('Check') ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Facility & Contact Info - kept same */}
            <div>
              <label className="label">Facility / Company Name *</label>
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

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3 text-base disabled:opacity-60 mt-2"
            >
              {loading ? 'Creating account...' : 'Create Owner Account'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <Link href="/login" className="text-[var(--gold)] hover:underline">Already have an account? Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}