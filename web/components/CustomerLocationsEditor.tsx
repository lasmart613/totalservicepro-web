'use client';

import React from 'react';
import {
  canRemoveLocation,
  formatLocationLine,
  type CustomerLocation,
  type LocationDraft,
} from '@/lib/customer-locations';

type Props = {
  locations: CustomerLocation[];
  unavailable?: boolean;
  canEdit?: boolean;
  saving?: boolean;
  mode: 'add' | 'edit' | null;
  draft: LocationDraft;
  error?: string | null;
  onStartAdd: () => void;
  onStartEdit: (loc: CustomerLocation) => void;
  onCancel: () => void;
  onDraftChange: (next: LocationDraft) => void;
  onSubmit: () => void;
  onRemove: (loc: CustomerLocation) => void;
  onSetPrimary: (loc: CustomerLocation) => void;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

export function CustomerLocationsEditor({
  locations,
  unavailable,
  canEdit = true,
  saving,
  mode,
  draft,
  error,
  onStartAdd,
  onStartEdit,
  onCancel,
  onDraftChange,
  onSubmit,
  onRemove,
  onSetPrimary,
}: Props) {
  const set = (key: keyof LocationDraft, value: string | boolean) => {
    onDraftChange({ ...draft, [key]: value });
  };
  const storedCount = locations.filter((loc) => !loc.localOnly).length;
  const forcePrimary = mode === 'add' ? storedCount === 0 : storedCount <= 1;

  return (
    <div className="mt-4 pt-4 border-t border-[var(--border)]">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden>📍</span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)] flex-1">
          Locations
        </h3>
        {canEdit && mode == null && (
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={onStartAdd}
            disabled={Boolean(unavailable) || saving}
          >
            Add location
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--text3)] mb-3">
        {unavailable
          ? 'Additional locations need a database update before they can be saved. The primary address above still saves with this customer.'
          : 'Add another office or clinic for this business. The primary location is the address saved on the customer.'}
      </p>

      {error && (
        <p className="text-xs text-red-400 mb-3" role="alert">
          {error}
        </p>
      )}

      {locations.length === 0 ? (
        <p className="text-sm text-[var(--text3)]">No address on file yet. Add a location to set one.</p>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => {
            const line = formatLocationLine(loc);
            const meta = [loc.contact_name, loc.phone].filter(Boolean).join(' · ');
            return (
              <div
                key={String(loc.id)}
                className={`rounded-xl border p-3 ${
                  loc.is_primary
                    ? 'border-[var(--gold-border)] bg-[var(--gold-glow)]/20'
                    : 'border-[var(--border)] bg-[var(--surface2)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm">{loc.name}</span>
                      {loc.is_primary && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--gold)]">
                          Primary
                        </span>
                      )}
                    </div>
                    {line && <div className="text-xs text-[var(--text3)] mt-0.5">{line}</div>}
                    {meta && <div className="text-xs text-[var(--text3)] mt-0.5">{meta}</div>}
                  </div>
                  {canEdit && mode == null && (
                    <div className="flex flex-wrap justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        className="text-xs text-[var(--gold)] hover:underline"
                        onClick={() => onStartEdit(loc)}
                        disabled={saving}
                      >
                        Edit
                      </button>
                      {!loc.is_primary && !loc.localOnly && (
                        <button
                          type="button"
                          className="text-xs text-[var(--gold)] hover:underline"
                          onClick={() => onSetPrimary(loc)}
                          disabled={saving || unavailable}
                        >
                          Set primary
                        </button>
                      )}
                      {canRemoveLocation(locations, loc.id) && (
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:underline"
                          onClick={() => onRemove(loc)}
                          disabled={saving || unavailable}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canEdit && mode != null && (
        <form
          className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--gold)]">
            {mode === 'add' ? 'New location' : 'Edit location'}
          </div>
          <Field label="Name *">
            <input
              className="input w-full"
              value={draft.name}
              placeholder="Main office, Beverly Hills…"
              autoComplete="off"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Address">
            <input
              className="input w-full"
              value={draft.address}
              autoComplete="street-address"
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input
                className="input w-full"
                value={draft.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </Field>
            <Field label="State">
              <input
                className="input w-full"
                value={draft.state}
                placeholder="CA or California"
                autoComplete="address-level1"
                onChange={(e) => set('state', e.target.value)}
              />
            </Field>
            <Field label="ZIP">
              <input
                className="input w-full"
                value={draft.zip}
                maxLength={10}
                onChange={(e) => set('zip', e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                className="input w-full"
                type="tel"
                value={draft.phone}
                placeholder="Optional"
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
            <Field label="Contact">
              <input
                className="input w-full"
                value={draft.contact_name}
                placeholder="Optional"
                onChange={(e) => set('contact_name', e.target.value)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-[var(--gold)]"
              checked={forcePrimary || draft.is_primary}
              disabled={forcePrimary}
              onChange={(e) => set('is_primary', e.target.checked)}
            />
            Primary location
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary text-xs" disabled={saving}>
              {saving ? 'Saving…' : mode === 'add' ? 'Save location' : 'Update location'}
            </button>
            <button type="button" className="btn btn-secondary text-xs" disabled={saving} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
