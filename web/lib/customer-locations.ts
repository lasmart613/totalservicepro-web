/**
 * Extra addresses for a CRM customer.
 *
 * The organization row keeps one address (the primary snapshot) so existing
 * tickets, estimates, and invoices do not change. Additional sites are rows
 * in `locations`. If that table or its RLS/columns are not on the database
 * yet, callers get `unavailable` and the single address still works.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertOmittingCharOverflow, updateOmittingCharOverflow } from './char-overflow.ts';
import { normalizeRegionInput } from './geo.ts';

export const PRIMARY_LOCATION_NAME = 'Main office';
export const LOCAL_PRIMARY_ID = 'local-primary';

export type CustomerLocation = {
  id: number | string;
  organization_id?: number | string | null;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  is_primary: boolean;
  /** ISO timestamp from the row. Used only to choose which primary to show. */
  updated_at?: string | null;
  /** Shown from the organization address before a locations row exists. */
  localOnly?: boolean;
};

export type LocationDraft = {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  contact_name: string;
  is_primary: boolean;
};

export type LocationAddressFields = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
};

export type LoadLocationsResult = {
  locations: CustomerLocation[];
  unavailable: boolean;
  schemaLag: boolean;
};

export type LocationWriteResult = {
  location: CustomerLocation | null;
  locations: CustomerLocation[];
  unavailable: boolean;
  /** contact_name was sent but the column is not on this database yet. */
  contactDropped: boolean;
  error?: string | null;
};

const SELECT_FULL =
  'id, organization_id, name, address, city, state, zip, phone, contact_name, is_primary, updated_at';
const SELECT_SAFE = 'id, organization_id, name, address, city, state, zip, phone, is_primary';

type LocationsClient = {
  from: (table: string) => any;
};

export function isLocationsUnavailable(message?: string | null): boolean {
  const m = String(message || '');
  if (/permission denied|42501/i.test(m)) return true;
  if (/could not find the table|Could not find the table|PGRST205/i.test(m)) return true;
  return /relation ["']?(?:public\.)?locations["']? does not exist/i.test(m);
}

export function emptyLocationDraft(partial?: Partial<LocationDraft>): LocationDraft {
  return {
    name: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    contact_name: '',
    is_primary: false,
    ...partial,
  };
}

export function draftFromLocation(loc: CustomerLocation): LocationDraft {
  return {
    name: loc.name || '',
    address: loc.address || '',
    city: loc.city || '',
    state: loc.state || '',
    zip: loc.zip || '',
    phone: loc.phone || '',
    contact_name: loc.contact_name || '',
    is_primary: loc.is_primary === true,
  };
}

export function validateLocationDraft(draft: LocationDraft): string | null {
  if (!draft.name.trim()) return 'Location name is required';
  return null;
}

export function hasLocationAddress(fields: LocationAddressFields | null | undefined): boolean {
  if (!fields) return false;
  return Boolean(
    String(fields.address || '').trim() ||
      String(fields.city || '').trim() ||
      String(fields.state || '').trim() ||
      String(fields.zip || '').trim()
  );
}

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

export function locationWritePayload(
  draft: LocationDraft,
  extras?: Record<string, unknown>
): Record<string, unknown> {
  const region = normalizeRegionInput(draft.state);
  return {
    name: draft.name.trim(),
    address: clean(draft.address),
    city: clean(draft.city),
    state: region.state,
    zip: clean(draft.zip),
    phone: clean(draft.phone),
    contact_name: clean(draft.contact_name),
    is_primary: draft.is_primary === true,
    updated_at: new Date().toISOString(),
    ...extras,
  };
}

export function normalizeLocation(row: Record<string, unknown> | null | undefined): CustomerLocation | null {
  if (!row || row.id == null) return null;
  const name = String(row.name || '').trim() || PRIMARY_LOCATION_NAME;
  return {
    id: row.id as number | string,
    organization_id: (row.organization_id as number | string | null | undefined) ?? null,
    name,
    address: clean(row.address),
    city: clean(row.city),
    state: clean(row.state),
    zip: clean(row.zip),
    phone: clean(row.phone),
    contact_name: clean(row.contact_name),
    is_primary: row.is_primary === true,
    updated_at: row.updated_at == null || row.updated_at === '' ? null : String(row.updated_at),
    localOnly: false,
  };
}

export function sortLocations(locations: CustomerLocation[]): CustomerLocation[] {
  return [...locations].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/** Newest updated_at first. Same timestamp, or a missing one, breaks the tie by higher id. */
function comparePrimaryRecency(a: CustomerLocation, b: CustomerLocation): number {
  const at = String(a.updated_at || '');
  const bt = String(b.updated_at || '');
  if (at !== bt) return bt.localeCompare(at);
  return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
}

export function pickPrimaryLocation(locations: CustomerLocation[]): CustomerLocation | null {
  if (!locations.length) return null;
  const flagged = locations.filter((loc) => loc.is_primary);
  if (flagged.length > 1) return [...flagged].sort(comparePrimaryRecency)[0] || null;
  if (flagged.length === 1) return flagged[0];
  return sortLocations(locations)[0] || null;
}

/** Display and ticket pickers show one primary. Stored flags are not written back. */
export function collapseExtraPrimaries(locations: CustomerLocation[]): CustomerLocation[] {
  const flagged = locations.filter((loc) => loc.is_primary);
  if (flagged.length <= 1) return locations;
  const chosen = pickPrimaryLocation(locations);
  if (!chosen) return locations;
  return locations.map((loc) =>
    String(loc.id) === String(chosen.id) ? loc : { ...loc, is_primary: false }
  );
}

/** Address already stored on the customer, shown until a locations row exists. */
export function localPrimaryFromOrg(
  org: LocationAddressFields & { id?: number | string | null; contact_name?: string | null }
): CustomerLocation | null {
  if (!hasLocationAddress(org) && !clean(org.phone)) return null;
  return {
    id: LOCAL_PRIMARY_ID,
    organization_id: org.id ?? null,
    name: PRIMARY_LOCATION_NAME,
    address: clean(org.address),
    city: clean(org.city),
    state: clean(org.state),
    zip: clean(org.zip),
    phone: clean(org.phone),
    contact_name: clean(org.contact_name),
    is_primary: true,
    localOnly: true,
  };
}

/** Primary card tracks the address fields on the customer form while they are edited. */
export function overlayPrimaryFromForm(
  locations: CustomerLocation[],
  form: LocationAddressFields
): CustomerLocation[] {
  return locations.map((loc) => {
    if (!loc.is_primary) return loc;
    return {
      ...loc,
      address: form.address != null ? clean(form.address) : loc.address,
      city: form.city != null ? clean(form.city) : loc.city,
      state: form.state != null ? clean(form.state) : loc.state,
      zip: form.zip != null ? clean(form.zip) : loc.zip,
      phone: form.phone != null ? clean(form.phone) : loc.phone,
    };
  });
}

/**
 * Rows to render. Real rows win, with at most one primary badge.
 * An empty list (missing table, or RLS returning no rows) keeps the organization address.
 */
export function locationsForDisplay(
  rows: CustomerLocation[],
  org: LocationAddressFields & { id?: number | string | null }
): CustomerLocation[] {
  const present = rows.filter((row) => row && row.id != null);
  if (present.length) {
    const sorted = sortLocations(collapseExtraPrimaries(present));
    if (sorted.some((row) => row.is_primary)) return sorted;
    const [first, ...rest] = sorted;
    return [{ ...first, is_primary: true }, ...rest];
  }
  // No visible rows: table missing, or RLS returned an empty list. Keep the org address.
  const local = localPrimaryFromOrg(org);
  return local ? [local] : [];
}

/**
 * New Service Call after a locations load.
 * `fields` is null when there is nothing to apply, so the caller keeps the
 * organization address already on the ticket form.
 */
export function serviceCallFromLocations(
  rows: CustomerLocation[],
  org: LocationAddressFields,
  officePhone?: string | null
): {
  locations: CustomerLocation[];
  selectedId: string;
  fields: {
    customer_address: string;
    customer_city: string;
    customer_state: string;
    customer_zip: string;
    customer_phone: string;
    customer_contact: string;
  } | null;
} {
  const locations = sortLocations(collapseExtraPrimaries(rows.filter((row) => row && row.id != null)));
  const primary = pickPrimaryLocation(locations);
  if (!primary) return { locations, selectedId: '', fields: null };
  const applied = applyLocationToTicketFields(
    {
      customer_address: org.address || '',
      customer_city: org.city || '',
      customer_state: org.state || '',
      customer_zip: org.zip || '',
      customer_phone: org.phone || '',
    },
    primary,
    { officePhone }
  );
  return {
    locations,
    selectedId: applied.customer_location_id != null ? String(applied.customer_location_id) : String(primary.id),
    fields: {
      customer_address: applied.customer_address,
      customer_city: applied.customer_city,
      customer_state: applied.customer_state,
      customer_zip: applied.customer_zip,
      customer_phone: applied.customer_phone,
      customer_contact: applied.customer_contact,
    },
  };
}

export function formatLocationLine(loc: LocationAddressFields): string {
  const cityState = [clean(loc.city), clean(loc.state)].filter(Boolean).join(', ');
  const cityLine = [cityState, clean(loc.zip)].filter(Boolean).join(' ');
  return [clean(loc.address), cityLine].filter(Boolean).join(', ');
}

export function formatLocationOption(loc: CustomerLocation): string {
  const line = formatLocationLine(loc);
  const base = line ? `${loc.name} - ${line}` : loc.name;
  return loc.is_primary ? `${base} (Primary)` : base;
}

export function persistedLocationId(id: unknown): string | number | null {
  if (id == null) return null;
  const text = String(id).trim();
  if (!text || text.startsWith('local-')) return null;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  return text;
}

export function canRemoveLocation(locations: CustomerLocation[], id: number | string): boolean {
  const target = locations.find((loc) => String(loc.id) === String(id));
  if (!target || target.localOnly) return false;
  const stored = locations.filter((loc) => !loc.localOnly && persistedLocationId(loc.id) != null);
  return stored.length > 1;
}

export function nextPrimaryAfterRemove(
  locations: CustomerLocation[],
  removedId: number | string
): CustomerLocation | null {
  const rest = locations.filter((loc) => String(loc.id) !== String(removedId) && !loc.localOnly);
  if (!rest.length) return null;
  return pickPrimaryLocation(rest.map((loc) => ({ ...loc, is_primary: loc.is_primary && String(loc.id) !== String(removedId) })));
}

export function withPrimaryFlag(locations: CustomerLocation[], primaryId: number | string): CustomerLocation[] {
  return sortLocations(
    locations.map((loc) => ({
      ...loc,
      is_primary: String(loc.id) === String(primaryId),
      localOnly: false,
    }))
  );
}

/** In-memory add/edit used by tests and the seeded preview. Primary stays singular. */
export function applyDraftToLocations(
  locations: CustomerLocation[],
  draft: LocationDraft,
  existingId?: string | number | null
): CustomerLocation[] {
  const invalid = validateLocationDraft(draft);
  if (invalid) throw new Error(invalid);
  const region = normalizeRegionInput(draft.state);
  const without = locations.filter(
    (loc) => String(loc.id) !== String(existingId ?? '') && String(loc.id) !== LOCAL_PRIMARY_ID
  );
  const id =
    existingId != null && String(existingId) !== LOCAL_PRIMARY_ID
      ? existingId
      : `local-${without.length + 1}`;
  const row: CustomerLocation = {
    id,
    name: draft.name.trim(),
    address: clean(draft.address),
    city: clean(draft.city),
    state: region.state,
    zip: clean(draft.zip),
    phone: clean(draft.phone),
    contact_name: clean(draft.contact_name),
    is_primary: draft.is_primary === true,
    localOnly: false,
  };
  const next = [...without, row];
  if (row.is_primary || !next.some((loc) => loc.is_primary)) return withPrimaryFlag(next, row.id);
  return sortLocations(next);
}

export function removeLocationFromList(
  locations: CustomerLocation[],
  id: number | string
): CustomerLocation[] {
  if (!canRemoveLocation(locations, id)) return locations;
  const removed = locations.find((loc) => String(loc.id) === String(id));
  const rest = sortLocations(
    locations.filter((loc) => String(loc.id) !== String(id) && !loc.localOnly)
  );
  if (!rest.length) return [];
  if (removed?.is_primary) return withPrimaryFlag(rest, rest[0].id);
  return sortLocations(rest);
}

/**
 * Switching locations replaces the ticket phone with that location's phone.
 * An empty location phone clears the field. Directory numbers are not kept.
 */
export function ticketPhoneForLocation(opts: {
  locationPhone?: string | null;
  isPrimary?: boolean;
  officePhone?: string | null;
  currentPhone?: string | null;
}): string {
  return String(opts.locationPhone || '').trim();
}

/** Same overwrite rule for the location contact name. */
export function ticketContactForLocation(opts: { locationContact?: string | null }): string {
  return String(opts.locationContact || '').trim();
}

export type TicketLocationFields = {
  customer_address: string;
  customer_city: string;
  customer_state: string;
  customer_zip: string;
  customer_phone: string;
  customer_contact: string;
  customer_location_id: string | number | null;
};

export function applyLocationToTicketFields(
  current: {
    customer_address?: string | null;
    customer_city?: string | null;
    customer_state?: string | null;
    customer_zip?: string | null;
    customer_phone?: string | null;
    customer_contact?: string | null;
  },
  loc: CustomerLocation,
  opts?: { officePhone?: string | null }
): TicketLocationFields {
  const address = clean(loc.address);
  const city = clean(loc.city);
  const state = clean(loc.state);
  const zip = clean(loc.zip);
  return {
    customer_address: address || String(current.customer_address || ''),
    customer_city: city || String(current.customer_city || ''),
    customer_state: state || String(current.customer_state || ''),
    customer_zip: zip || String(current.customer_zip || ''),
    customer_phone: ticketPhoneForLocation({
      locationPhone: loc.phone,
      isPrimary: loc.is_primary,
      officePhone: opts?.officePhone,
      currentPhone: current.customer_phone,
    }),
    customer_contact: ticketContactForLocation({ locationContact: loc.contact_name }),
    customer_location_id: persistedLocationId(loc.id),
  };
}

export function locationUnavailableMessage(): string {
  return 'Additional locations need a database update before they can be saved. The primary address on this customer is unchanged.';
}

function warnLocation(error: { message?: string } | null | undefined) {
  if (error) console.warn('customer locations', error.message || error);
}

async function selectLocations(
  supabase: LocationsClient,
  organizationId: string | number,
  columns: string
): Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }> {
  const res = await supabase
    .from('locations')
    .select(columns)
    .eq('organization_id', organizationId)
    .order('id', { ascending: true });
  return { data: (res.data as Record<string, unknown>[] | null) ?? null, error: res.error ?? null };
}

export async function loadCustomerLocations(
  supabase: LocationsClient,
  organizationId: string | number | null | undefined
): Promise<LoadLocationsResult> {
  if (organizationId == null || organizationId === '') {
    return { locations: [], unavailable: false, schemaLag: false };
  }
  try {
    let schemaLag = false;
    let { data, error } = await selectLocations(supabase, organizationId, SELECT_FULL);
    if (
      error &&
      /contact_name|column|schema cache/i.test(error.message || '') &&
      !isLocationsUnavailable(error.message)
    ) {
      schemaLag = true;
      ({ data, error } = await selectLocations(supabase, organizationId, SELECT_SAFE));
    }
    if (error) {
      warnLocation(error);
      return {
        locations: [],
        unavailable: true,
        schemaLag: schemaLag || /column|schema cache/i.test(error.message || ''),
      };
    }
    const locations = sortLocations(
      collapseExtraPrimaries(
        (data || []).map((row) => normalizeLocation(row)).filter((row): row is CustomerLocation => Boolean(row))
      )
    );
    return { locations, unavailable: false, schemaLag };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnLocation({ message });
    return { locations: [], unavailable: true, schemaLag: false };
  }
}

async function clearPrimaryFlags(
  supabase: LocationsClient,
  organizationId: string | number,
  exceptId?: string | number | null
): Promise<{ error: { message?: string } | null }> {
  let query = supabase
    .from('locations')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .eq('is_primary', true);
  if (exceptId != null && persistedLocationId(exceptId) != null) {
    query = query.neq('id', exceptId);
  }
  const { error } = await query;
  return { error: error ?? null };
}

function contactWasDropped(draft: LocationDraft, payload: Record<string, unknown>): boolean {
  return Boolean(clean(draft.contact_name) && !('contact_name' in payload));
}

export async function saveCustomerLocation(
  supabase: LocationsClient,
  organizationId: string | number,
  draft: LocationDraft,
  existingId?: string | number | null
): Promise<LocationWriteResult> {
  const invalid = validateLocationDraft(draft);
  if (invalid) {
    return { location: null, locations: [], unavailable: false, contactDropped: false, error: invalid };
  }

  const persistedId = persistedLocationId(existingId);
  const payload = locationWritePayload(draft, { organization_id: organizationId });

  try {
    if (draft.is_primary) {
      const cleared = await clearPrimaryFlags(supabase, organizationId, persistedId);
      if (cleared.error && isLocationsUnavailable(cleared.error.message)) {
        return {
          location: null,
          locations: [],
          unavailable: true,
          contactDropped: false,
          error: locationUnavailableMessage(),
        };
      }
    }

    const client = supabase as SupabaseClient;
    let error: { message?: string } | null = null;
    let id: string | number | null = persistedId;
    if (persistedId == null) {
      const inserted = await insertOmittingCharOverflow(client, 'locations', payload, {
        select: 'id',
        maxAttempts: 12,
      });
      error = inserted.error;
      id = (inserted.data?.id as string | number | undefined) ?? null;
    } else {
      delete payload.organization_id;
      const updated = await updateOmittingCharOverflow(
        client,
        'locations',
        payload,
        { column: 'id', value: persistedId },
        { maxAttempts: 12 }
      );
      error = updated.error;
    }

    if (error) {
      warnLocation(error);
      if (isLocationsUnavailable(error.message)) {
        return {
          location: null,
          locations: [],
          unavailable: true,
          contactDropped: false,
          error: locationUnavailableMessage(),
        };
      }
      return {
        location: null,
        locations: [],
        unavailable: false,
        contactDropped: false,
        error: error.message || 'Could not save that location.',
      };
    }

    const loaded = await loadCustomerLocations(supabase, organizationId);
    const location =
      loaded.locations.find((loc) => String(loc.id) === String(id)) ||
      loaded.locations.find((loc) => loc.name === draft.name.trim()) ||
      null;
    return {
      location,
      locations: loaded.locations,
      unavailable: loaded.unavailable,
      contactDropped: contactWasDropped(draft, payload),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isLocationsUnavailable(message)) {
      return {
        location: null,
        locations: [],
        unavailable: true,
        contactDropped: false,
        error: locationUnavailableMessage(),
      };
    }
    return {
      location: null,
      locations: [],
      unavailable: false,
      contactDropped: false,
      error: message || 'Could not save that location.',
    };
  }
}

export async function setCustomerLocationPrimary(
  supabase: LocationsClient,
  organizationId: string | number,
  locationId: string | number
): Promise<LocationWriteResult> {
  const persistedId = persistedLocationId(locationId);
  if (persistedId == null) {
    return { location: null, locations: [], unavailable: false, contactDropped: false, error: null };
  }
  try {
    const cleared = await clearPrimaryFlags(supabase, organizationId, persistedId);
    if (cleared.error && isLocationsUnavailable(cleared.error.message)) {
      return {
        location: null,
        locations: [],
        unavailable: true,
        contactDropped: false,
        error: locationUnavailableMessage(),
      };
    }
    const client = supabase as SupabaseClient;
    const updated = await updateOmittingCharOverflow(
      client,
      'locations',
      { is_primary: true, updated_at: new Date().toISOString() },
      { column: 'id', value: persistedId },
      { maxAttempts: 8 }
    );
    if (updated.error) {
      warnLocation(updated.error);
      if (isLocationsUnavailable(updated.error.message)) {
        return {
          location: null,
          locations: [],
          unavailable: true,
          contactDropped: false,
          error: locationUnavailableMessage(),
        };
      }
      return {
        location: null,
        locations: [],
        unavailable: false,
        contactDropped: false,
        error: updated.error.message || 'Could not set the primary location.',
      };
    }
    const loaded = await loadCustomerLocations(supabase, organizationId);
    return {
      location: loaded.locations.find((loc) => String(loc.id) === String(persistedId)) || pickPrimaryLocation(loaded.locations),
      locations: loaded.locations,
      unavailable: loaded.unavailable,
      contactDropped: false,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      location: null,
      locations: [],
      unavailable: isLocationsUnavailable(message),
      contactDropped: false,
      error: isLocationsUnavailable(message) ? locationUnavailableMessage() : message,
    };
  }
}

export async function removeCustomerLocation(
  supabase: LocationsClient,
  organizationId: string | number,
  locationId: string | number,
  locations: CustomerLocation[]
): Promise<LocationWriteResult> {
  if (!canRemoveLocation(locations, locationId)) {
    return {
      location: null,
      locations,
      unavailable: false,
      contactDropped: false,
      error: 'Keep at least one location. Edit the primary address instead of removing it.',
    };
  }
  const removed = locations.find((loc) => String(loc.id) === String(locationId));
  try {
    const { error } = await supabase.from('locations').delete().eq('id', locationId).eq('organization_id', organizationId);
    if (error) {
      warnLocation(error);
      if (isLocationsUnavailable(error.message)) {
        return {
          location: null,
          locations,
          unavailable: true,
          contactDropped: false,
          error: locationUnavailableMessage(),
        };
      }
      return {
        location: null,
        locations,
        unavailable: false,
        contactDropped: false,
        error: error.message || 'Could not remove that location.',
      };
    }
    let promoted: CustomerLocation | null = null;
    if (removed?.is_primary) {
      const next = nextPrimaryAfterRemove(locations, locationId);
      if (next && persistedLocationId(next.id) != null) {
        const result = await setCustomerLocationPrimary(supabase, organizationId, next.id);
        if (result.error && !result.unavailable) {
          return { ...result, locations: result.locations.length ? result.locations : locations };
        }
        promoted = result.location;
        return { ...result, location: promoted };
      }
    }
    const loaded = await loadCustomerLocations(supabase, organizationId);
    return {
      location: pickPrimaryLocation(loaded.locations),
      locations: loaded.locations,
      unavailable: loaded.unavailable,
      contactDropped: false,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      location: null,
      locations,
      unavailable: isLocationsUnavailable(message),
      contactDropped: false,
      error: isLocationsUnavailable(message) ? locationUnavailableMessage() : message,
    };
  }
}

/** Keep the primary locations row aligned with the address saved on the customer. */
export async function syncPrimaryLocationFromForm(
  supabase: LocationsClient,
  organizationId: string | number,
  form: LocationAddressFields
): Promise<{ unavailable: boolean }> {
  const loaded = await loadCustomerLocations(supabase, organizationId);
  if (loaded.unavailable) return { unavailable: true };
  const region = normalizeRegionInput(form.state);
  const draft = emptyLocationDraft({
    name: PRIMARY_LOCATION_NAME,
    address: String(form.address || ''),
    city: String(form.city || ''),
    state: region.state || String(form.state || ''),
    zip: String(form.zip || ''),
    phone: String(form.phone || ''),
    is_primary: true,
  });
  const primary = loaded.locations.find((loc) => loc.is_primary) || null;
  if (!primary) {
    if (!hasLocationAddress(form) && !clean(form.phone)) return { unavailable: false };
    const saved = await saveCustomerLocation(supabase, organizationId, draft, null);
    return { unavailable: saved.unavailable };
  }
  const next = emptyLocationDraft({
    ...draftFromLocation(primary),
    address: draft.address,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
    phone: draft.phone,
    is_primary: true,
  });
  const saved = await saveCustomerLocation(supabase, organizationId, next, primary.id);
  return { unavailable: saved.unavailable };
}

export function orgAddressPatch(loc: CustomerLocation): {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
} {
  const region = normalizeRegionInput(loc.state);
  return {
    address: clean(loc.address),
    city: clean(loc.city),
    state: region.state,
    zip: clean(loc.zip),
    phone: clean(loc.phone),
  };
}
