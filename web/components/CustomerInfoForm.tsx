'use client';

import React from 'react';
import {
  CUSTOMER_BIZ_TYPES,
  CUSTOMER_SPECIALTIES,
  type CustomerInfoFormValues,
} from '@/lib/customer-form';

type Props = {
  value: CustomerInfoFormValues;
  onChange: (next: CustomerInfoFormValues) => void;
  disabled?: boolean;
};

export function CustomerInfoForm({ value, onChange, disabled }: Props) {
  const setField = (key: keyof CustomerInfoFormValues, next: string | string[]) => {
    onChange({ ...value, [key]: next });
  };

  const toggleSpecialty = (spec: string) => {
    const has = value.specialties.includes(spec);
    setField(
      'specialties',
      has ? value.specialties.filter((s) => s !== spec) : [...value.specialties, spec]
    );
  };

  return (
    <div className="space-y-4">
      <div className="section">
        <div className="flex items-center gap-2 mb-3">
          <span>🏥</span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
            Business Info
          </h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Business Name *
            </label>
            <input
              className="input w-full"
              value={value.name}
              disabled={disabled}
              autoComplete="organization"
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                Business Type
              </label>
              <select
                className="input w-full"
                value={value.biz_type}
                disabled={disabled}
                onChange={(e) => setField('biz_type', e.target.value)}
              >
                <option value="">Select…</option>
                {CUSTOMER_BIZ_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                Website
              </label>
              <input
                className="input w-full"
                type="url"
                placeholder="https://"
                value={value.website}
                disabled={disabled}
                onChange={(e) => setField('website', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Notes
            </label>
            <textarea
              className="input w-full min-h-[80px]"
              placeholder="Account notes, preferences, access details…"
              value={value.notes}
              disabled={disabled}
              onChange={(e) => setField('notes', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="flex items-center gap-2 mb-3">
          <span>📞</span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
            Contact Info
          </h2>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                Phone
              </label>
              <input
                className="input w-full"
                type="tel"
                value={value.phone}
                disabled={disabled}
                onChange={(e) => setField('phone', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                Email
              </label>
              <input
                className="input w-full"
                type="email"
                value={value.email}
                disabled={disabled}
                onChange={(e) => setField('email', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Contact Name
            </label>
            <input
              className="input w-full"
              value={value.contact_name}
              disabled={disabled}
              placeholder="Primary contact person"
              onChange={(e) => setField('contact_name', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Address
            </label>
            <input
              className="input w-full"
              value={value.address}
              disabled={disabled}
              onChange={(e) => setField('address', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                City
              </label>
              <input
                className="input w-full"
                value={value.city}
                disabled={disabled}
                onChange={(e) => setField('city', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                State
              </label>
              <input
                className="input w-full"
                maxLength={2}
                value={value.state}
                disabled={disabled}
                onChange={(e) => setField('state', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                ZIP
              </label>
              <input
                className="input w-full"
                maxLength={10}
                value={value.zip}
                disabled={disabled}
                onChange={(e) => setField('zip', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="flex items-center gap-2 mb-3">
          <span>💉</span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
            Specialties
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {CUSTOMER_SPECIALTIES.map((spec) => {
            const active = value.specialties.includes(spec);
            return (
              <button
                key={spec}
                type="button"
                disabled={disabled}
                onClick={() => toggleSpecialty(spec)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  active
                    ? 'border-[var(--gold)] bg-[var(--gold-glow)] text-[var(--gold)] font-semibold'
                    : 'border-[var(--border)] text-[var(--text3)] bg-[var(--surface2)]'
                } ${disabled ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
              >
                {spec}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text3)] mt-2">Treatments this facility offers.</p>
      </div>
    </div>
  );
}
