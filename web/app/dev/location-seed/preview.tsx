'use client';

import React, { useMemo, useState } from 'react';
import { CustomerLocationSelect } from '@/components/CustomerLocationSelect';
import { CustomerLocationsEditor } from '@/components/CustomerLocationsEditor';
import {
  applyDraftToLocations,
  applyLocationToTicketFields,
  draftFromLocation,
  emptyLocationDraft,
  pickPrimaryLocation,
  removeLocationFromList,
  type CustomerLocation,
  type LocationDraft,
} from '@/lib/customer-locations';

const SEED: CustomerLocation[] = [
  {
    id: 1,
    name: 'Main office',
    address: '100 Harbor Ave',
    city: 'Evanston',
    state: 'IL',
    zip: '60201',
    phone: '847-555-0100',
    contact_name: 'Front desk',
    is_primary: true,
  },
];

/**
 * Seeded shop preview. Uses the same location editor and ticket picker as the
 * customer profile and New Service Call. Nothing here is a live customer.
 */
export function SeededLocationsPreview() {
  const [locations, setLocations] = useState<CustomerLocation[]>(SEED);
  const [mode, setMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(emptyLocationDraft());
  const [error, setError] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState('1');
  const [ticket, setTicket] = useState({
    customer_address: '100 Harbor Ave',
    customer_city: 'Evanston',
    customer_state: 'IL',
    customer_zip: '60201',
    customer_phone: '847-555-0142',
  });

  const primary = useMemo(() => pickPrimaryLocation(locations), [locations]);

  function chooseLocation(id: string) {
    const loc = locations.find((row) => String(row.id) === id);
    if (!loc) return;
    const fields = applyLocationToTicketFields(ticket, loc, { officePhone: '847-555-0100' });
    setSelectedLocationId(id);
    setTicket({
      customer_address: fields.customer_address,
      customer_city: fields.customer_city,
      customer_state: fields.customer_state,
      customer_zip: fields.customer_zip,
      customer_phone: fields.customer_phone,
    });
  }

  function submit() {
    try {
      const stored = locations.filter((loc) => !loc.localOnly);
      const forcePrimary = mode === 'add' ? stored.length === 0 : stored.length <= 1;
      const nextDraft = forcePrimary ? { ...draft, is_primary: true } : draft;
      const next = applyDraftToLocations(locations, nextDraft, mode === 'edit' ? editingId : null);
      setLocations(next);
      setMode(null);
      setEditingId(null);
      setError(null);
      const chosen = next.find((loc) => String(loc.id) === selectedLocationId) || pickPrimaryLocation(next);
      if (chosen) chooseFrom(next, chosen);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that location.');
    }
  }

  function chooseFrom(next: CustomerLocation[], loc: CustomerLocation) {
    const fields = applyLocationToTicketFields(ticket, loc, { officePhone: '847-555-0100' });
    setSelectedLocationId(String(loc.id));
    setTicket({
      customer_address: fields.customer_address,
      customer_city: fields.customer_city,
      customer_state: fields.customer_state,
      customer_zip: fields.customer_zip,
      customer_phone: fields.customer_phone,
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <p className="text-xs uppercase tracking-wide text-[var(--text3)]">
        Seeded preview — not a live customer
      </p>
      <div className="card p-5">
        <h1 className="text-2xl font-extrabold">Harbor Laser Clinic</h1>
        <p className="text-sm text-[var(--gold)] mt-0.5">Medical Spa</p>
        <p className="text-sm text-[var(--text3)] mt-2">
          {[primary?.address, [primary?.city, primary?.state].filter(Boolean).join(', '), primary?.zip]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className="section">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--gold)] mb-3">Contact info</h2>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text3)] mb-1">
          Primary address
        </label>
        <input className="input w-full" readOnly value={primary?.address || ''} />
        <p className="text-[11px] text-[var(--text3)] mt-1 mb-2">
          This is the main location. Use Add location for another office or clinic.
        </p>
        <CustomerLocationsEditor
          locations={locations}
          canEdit
          mode={mode}
          draft={draft}
          error={error}
          onStartAdd={() => {
            setError(null);
            setEditingId(null);
            setMode('add');
            setDraft(emptyLocationDraft());
          }}
          onStartEdit={(loc) => {
            setError(null);
            setEditingId(loc.id);
            setMode('edit');
            setDraft(draftFromLocation(loc));
          }}
          onCancel={() => {
            setMode(null);
            setError(null);
          }}
          onDraftChange={setDraft}
          onSubmit={submit}
          onRemove={(loc) => {
            const next = removeLocationFromList(locations, loc.id);
            if (next === locations) return;
            setLocations(next);
            const promoted = pickPrimaryLocation(next);
            if (promoted && (loc.is_primary || String(loc.id) === selectedLocationId)) chooseFrom(next, promoted);
          }}
          onSetPrimary={(loc) => {
            const next = applyDraftToLocations(
              locations,
              { ...draftFromLocation(loc), is_primary: true },
              loc.id
            );
            setLocations(next);
            if (String(loc.id) === selectedLocationId) chooseFrom(next, { ...loc, is_primary: true });
          }}
        />
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-lg font-extrabold">New Service Call</h2>
        <div>
          <label className="label">Customer *</label>
          <input className="input" readOnly value="Harbor Laser Clinic" />
        </div>
        <CustomerLocationSelect
          locations={locations}
          value={selectedLocationId}
          onChange={chooseLocation}
        />
        <div>
          <label className="label">Address</label>
          <input className="input" readOnly value={ticket.customer_address} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <label className="label">City</label>
            <input className="input" readOnly value={ticket.customer_city} />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" readOnly value={ticket.customer_state} />
          </div>
          <div>
            <label className="label">ZIP</label>
            <input className="input" readOnly value={ticket.customer_zip} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" readOnly value={ticket.customer_phone} />
          </div>
        </div>
      </div>
    </div>
  );
}
