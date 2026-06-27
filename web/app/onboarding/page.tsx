'use client';

import React, { useState } from 'react';
import { Header } from '@/components/Header';
import { Upload, Users, Zap, Package, ArrowRight, Check } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

type OrgType = 'service' | 'clinic' | 'supplier';

export default function Onboarding() {
  const supabase = getSupabaseClient();
  const [step, setStep] = useState(1);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [formData, setFormData] = useState<any>({});

  const handleTypeSelect = (type: OrgType) => {
    setOrgType(type);
    setStep(2);
  };

  const updateForm = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const saveOnboarding = async () => {
    // TODO: Save to organizations + related tables
    alert("Onboarding data saved! (Implementation in progress)");
    // Redirect to dashboard after save
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Header />
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-3">Welcome to Total Service Pro</h1>
          <p className="text-xl text-[var(--text2)]">Let's set up your account</p>
          <div className="flex justify-center gap-2 mt-6">
            {[1,2,3,4].map(s => (
              <div key={s} className={`w-3 h-3 rounded-full ${step >= s ? 'bg-[var(--gold)]' : 'bg-[var(--surface3)]'}`} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-semibold text-center mb-8">What best describes your organization?</h2>
            <div className="grid md:grid-cols-3 gap-6">
              <button onClick={() => handleTypeSelect('service')} className="card p-8 hover:border-[var(--gold)] transition-all group text-left">
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  <Users size={40} className="text-blue-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Service Organization</h3>
                <p className="text-[var(--text2)]">Employs service engineers / field techs</p>
              </button>

              <button onClick={() => handleTypeSelect('clinic')} className="card p-8 hover:border-[var(--gold)] transition-all group text-left">
                <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  <Zap size={40} className="text-purple-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Laser Clinic / Medical Practice</h3>
                <p className="text-[var(--text2)]">Owns and operates laser equipment</p>
              </button>

              <button onClick={() => handleTypeSelect('supplier')} className="card p-8 hover:border-[var(--gold)] transition-all group text-left">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  <Package size={40} className="text-amber-400" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Parts Supplier</h3>
                <p className="text-[var(--text2)]">OEM or 3rd party parts supplier</p>
              </button>
            </div>
          </div>
        )}

        {step === 2 && orgType && (
          <div className="max-w-2xl mx-auto">
            {/* Service Organization Form */}
            {orgType === 'service' && (
              <div>
                <h2 className="text-3xl font-bold mb-8">Service Organization Setup</h2>
                <div className="space-y-8">
                  {/* Logo + Basic Info */}
                  <div>
                    <label className="label">Company Logo</label>
                    <div className="border-2 border-dashed border-[var(--border)] rounded-3xl p-8 text-center">
                      <Upload className="mx-auto mb-4" size={48} />
                      <p>Click to upload logo</p>
                    </div>
                  </div>

                  {/* Number of Engineers + Details */}
                  <div>
                    <label className="label">How many Service Engineers?</label>
                    <input type="number" className="input" onChange={(e) => updateForm('numEngineers', e.target.value)} />
                  </div>

                  {/* You can expand this with dynamic fields for each engineer */}
                </div>
              </div>
            )}

            {/* Similar blocks for 'clinic' and 'supplier' types */}

            <div className="flex justify-between mt-12">
              <button onClick={() => setStep(1)} className="btn btn-secondary">Back</button>
              <button onClick={saveOnboarding} className="btn btn-primary flex items-center gap-2">
                Complete Setup <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}