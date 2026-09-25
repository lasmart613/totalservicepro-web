'use client';

import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  CUSTOMER_BIZ_TYPES,
  CUSTOMER_SPECIALTIES,
  type CustomerInfoFormValues,
} from '@/lib/customer-form';
import {
  DIRECTORY_CONTACT_ROLES,
  DIRECTORY_ROLE_LABELS,
  ensurePrimaryDirectoryRole,
  filledDirectoryRoles,
  isRoleFilled,
  patchDirectoryRoleField,
  setDirectoryPrimaryRole,
  type DirectoryRoleFields,
  type DirectoryRoleKey,
} from '@/lib/customer-contacts';
import { LOGO_ACCEPT, validateLogoFile } from '@/lib/customer-logo';
import { normalizeSocialUrl, visibleSocialNetworks } from '@/lib/social-links';

type Props = {
  value: CustomerInfoFormValues;
  onChange: (next: CustomerInfoFormValues) => void;
  disabled?: boolean;
  onLogoFileChange?: (file: File | null) => void;
  /** Show the post-create invite hint under Email (Directory add only). */
  inviteHint?: boolean;
  /** Customer org.type — LinkedIn / Yelp show for laser-clinic customers. */
  orgType?: string | null;
  /** Extra locations, rendered under the primary address. */
  afterAddress?: React.ReactNode;
};

export function CustomerInfoForm({
  value,
  onChange,
  disabled,
  onLogoFileChange,
  inviteHint,
  orgType,
  afterAddress,
}: Props) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const setField = (key: keyof CustomerInfoFormValues, next: string | string[]) => {
    onChange({ ...value, [key]: next });
  };

  const directory = ensurePrimaryDirectoryRole(value.directory);
  const filledRoles = filledDirectoryRoles(directory);

  const setRoleField = (
    role: DirectoryRoleKey,
    field: keyof DirectoryRoleFields,
    next: string
  ) => {
    onChange({
      ...value,
      directory: patchDirectoryRoleField(directory, role, field, next),
    });
  };

  const setPrimaryRole = (role: DirectoryRoleKey) => {
    onChange({
      ...value,
      directory: setDirectoryPrimaryRole(directory, role),
    });
  };

  function handleLogoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    if (!file) return;
    const invalid = validateLogoFile(file);
    if (invalid) {
      setLogoError(invalid);
      return;
    }
    setLogoError(null);
    const preview = URL.createObjectURL(file);
    onChange({ ...value, logo_url: preview });
    onLogoFileChange?.(file);
  }

  function removeLogo() {
    setLogoError(null);
    onChange({ ...value, logo_url: '' });
    onLogoFileChange?.(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  }

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
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Company Logo
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                disabled={disabled}
                onClick={() => logoInputRef.current?.click()}
                className="w-16 h-16 rounded-xl border-2 border-dashed border-[var(--border2)] bg-[var(--surface2)] overflow-hidden flex items-center justify-center shrink-0"
                aria-label="Choose company logo"
              >
                {value.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={value.logo_url} alt="" className="w-full h-full object-contain bg-[var(--surface)]" />
                ) : (
                  <Upload size={22} className="text-[var(--text3)]" />
                )}
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    disabled={disabled}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {value.logo_url ? 'Replace logo' : 'Choose logo'}
                  </button>
                  {value.logo_url && (
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      disabled={disabled}
                      onClick={removeLogo}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-xs text-[var(--text3)] mt-1">
                  Optional. PNG, JPG, WebP, or SVG. Max 2 MB.
                </p>
                {logoError && <p className="text-xs text-red-400 mt-1">{logoError}</p>}
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept={LOGO_ACCEPT}
              className="hidden"
              disabled={disabled}
              onChange={handleLogoPick}
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
                Main office phone
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
                Main office email
              </label>
            <input
              className="input w-full"
              type="email"
              value={value.email}
              disabled={disabled}
              onChange={(e) => setField('email', e.target.value)}
            />
            {inviteHint && (
              <p className="text-[11px] text-[var(--text3)] mt-1">
                Invite goes to the primary person email when set, otherwise this main office email
                (skipped if both are blank).
              </p>
            )}
            </div>
          </div>
          <p className="text-xs text-[var(--text3)]">
            Main office is the clinic switchboard. Add people below and mark exactly one as the
            primary contact for estimates, invoices, and invites.
          </p>
          {value.contact_name.trim() && filledRoles.length === 0 && (
            <p className="text-xs rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-[var(--text)]">
              On file: <strong>{value.contact_name.trim()}</strong> (legacy single contact). Assign
              a role below to replace this as the primary person.
            </p>
          )}
          <div className="space-y-3">
            {DIRECTORY_CONTACT_ROLES.map((role) => {
              const fields = directory.roles[role];
              const filled = isRoleFilled(fields);
              const selected = directory.primaryRole === role;
              return (
                <div
                  key={role}
                  className={`rounded-xl border p-3 ${
                    selected
                      ? 'border-[var(--gold-border)] bg-[var(--gold-glow)]/20'
                      : 'border-[var(--border)] bg-[var(--surface2)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <label className="flex items-center gap-2 min-w-0">
                      <input
                        type="radio"
                        name="directory-primary-contact"
                        className="accent-[var(--gold)]"
                        checked={selected}
                        disabled={disabled || !filled}
                        onChange={() => setPrimaryRole(role)}
                      />
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--gold)]">
                        {DIRECTORY_ROLE_LABELS[role]}
                      </span>
                    </label>
                    {selected && filled && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--gold)]">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      className="input w-full"
                      placeholder="First name"
                      autoComplete="given-name"
                      aria-label={`${DIRECTORY_ROLE_LABELS[role]} first name`}
                      value={fields.first_name}
                      disabled={disabled}
                      onChange={(e) => setRoleField(role, 'first_name', e.target.value)}
                    />
                    <input
                      className="input w-full"
                      placeholder="Last name"
                      autoComplete="family-name"
                      aria-label={`${DIRECTORY_ROLE_LABELS[role]} last name`}
                      value={fields.last_name}
                      disabled={disabled}
                      onChange={(e) => setRoleField(role, 'last_name', e.target.value)}
                    />
                    <input
                      className="input w-full"
                      type="email"
                      placeholder="Email"
                      autoComplete="email"
                      aria-label={`${DIRECTORY_ROLE_LABELS[role]} email`}
                      value={fields.email}
                      disabled={disabled}
                      onChange={(e) => setRoleField(role, 'email', e.target.value)}
                    />
                    <input
                      className="input w-full"
                      type="tel"
                      placeholder="Phone"
                      autoComplete="tel"
                      aria-label={`${DIRECTORY_ROLE_LABELS[role]} phone`}
                      value={fields.phone}
                      disabled={disabled}
                      onChange={(e) => setRoleField(role, 'phone', e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {filledRoles.length === 0 ? (
            <p className="text-[11px] text-[var(--text3)]">
              No person contacts yet. Radios stay off until a role has a name, email, or phone.
              Estimates and invites will use the main office email/phone
              {value.contact_name.trim() ? `, or “${value.contact_name.trim()}”` : ''}.
            </p>
          ) : (
            <p className="text-[11px] text-[var(--text3)]">
              Primary contact: {DIRECTORY_ROLE_LABELS[directory.primaryRole || filledRoles[0]]}.
              Empty roles are fine.
            </p>
          )}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
              Primary address
            </label>
            <input
              className="input w-full"
              value={value.address}
              disabled={disabled}
              onChange={(e) => setField('address', e.target.value)}
            />
            <p className="text-[11px] text-[var(--text3)] mt-1">
              This is the main location. Use Add location for another office or clinic.
            </p>
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
                value={value.state}
                disabled={disabled}
                placeholder="TX or Texas"
                autoComplete="address-level1"
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
          {afterAddress}
        </div>
      </div>

      <div className="section">
        <div className="flex items-center gap-2 mb-3">
          <span>🔗</span>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)]">
            Social Media
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleSocialNetworks(orgType, value).map((network) => {
            const raw = value[network.column] || '';
            const href = disabled ? normalizeSocialUrl(network.key, raw) : null;
            return (
              <div key={network.column}>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
                  {network.label}
                </label>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="input w-full flex items-center text-[var(--gold)] hover:underline truncate"
                  >
                    {raw}
                  </a>
                ) : (
                  <input
                    className="input w-full"
                    type="text"
                    inputMode="url"
                    placeholder={network.placeholder}
                    value={raw}
                    disabled={disabled}
                    autoComplete="off"
                    onChange={(e) => setField(network.column, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text3)] mt-2">
          Paste a full URL or an @handle. The company site field is separate, under Business Info.
        </p>
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
