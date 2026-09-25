'use client';

import React from 'react';
import { formatLocationOption, type CustomerLocation } from '@/lib/customer-locations';

type Props = {
  locations: CustomerLocation[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
};

/** Location picker for New Service Call. Hidden when the customer has no locations. */
export function CustomerLocationSelect({ locations, value, onChange, disabled }: Props) {
  if (!locations.length) return null;
  return (
    <div>
      <label className="label" htmlFor="ticket-customer-location">
        Location
      </label>
      <select
        id="ticket-customer-location"
        className="select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {locations.map((loc) => (
          <option key={String(loc.id)} value={String(loc.id)}>
            {formatLocationOption(loc)}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-[var(--text3)] mt-1">
        Defaults to the primary location. The ticket keeps that address.
      </p>
    </div>
  );
}
