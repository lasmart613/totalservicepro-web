/**
 * Service Report location picker and equipment-by-site grouping.
 *
 * Customers use the locations table from the multi-location model
 * (supabase/migrations/20260924_000000_customer_locations.sql).
 * Equipment is tied to one of those rows only when equipment.location_id
 * exists (20260926_000001_equipment_location_id.sql). Until that column is
 * on the database, every laser is treated as unassigned.
 */

import type { CustomerLocation } from './customer-locations.ts';
import { pickPrimaryLocation } from './customer-locations.ts';
import { addressWithZip } from './ticket-service-report.ts';

export const UNASSIGNED_EQUIPMENT_LABEL = 'Other / unassigned';

export type ReportLocationMode = 'hidden' | 'single' | 'multiple';

export type ReportEquipmentRow = {
  id: string | number;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  /** Null when the laser has no site, or the column is not on this database yet. */
  location_id?: string | number | null;
};

export type EquipmentSiteGroups = {
  atSite: ReportEquipmentRow[];
  unassigned: ReportEquipmentRow[];
  siteLabel: string;
};

export type ReportSiteFields = {
  address: string;
  city: string;
  state: string;
  phone: string;
  contactName: string;
  siteName: string;
};

type LocationsReader = {
  from: (table: string) => any;
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function sameId(a: unknown, b: unknown): boolean {
  if (a == null || a === '' || b == null || b === '') return false;
  return String(a) === String(b);
}

export function reportLocationMode(count: number): ReportLocationMode {
  if (count <= 0) return 'hidden';
  if (count === 1) return 'single';
  return 'multiple';
}

/**
 * Which location the report form should select.
 * One location is always that row. Several locations prefer an explicit id
 * (the ticket's customer_location_id), then the primary. `fallback: 'none'`
 * leaves a multi-location customer unselected when nothing matched.
 */
export function initialLocationSelection(
  locations: CustomerLocation[],
  preferredId?: string | number | null,
  opts?: { fallback?: 'primary' | 'none' }
): string {
  if (!locations.length) return '';
  if (preferredId != null && preferredId !== '') {
    const match = locations.find((loc) => sameId(loc.id, preferredId));
    if (match) return String(match.id);
  }
  if (locations.length === 1) return String(locations[0].id);
  if (opts?.fallback === 'none') return '';
  const primary = pickPrimaryLocation(locations);
  return primary ? String(primary.id) : String(locations[0].id);
}

export function reportLocationControl(
  locations: CustomerLocation[],
  preferredId?: string | number | null,
  opts?: { fallback?: 'primary' | 'none' }
): {
  mode: ReportLocationMode;
  shown: boolean;
  disabled: boolean;
  selectedId: string;
} {
  const mode = reportLocationMode(locations.length);
  return {
    mode,
    shown: mode !== 'hidden',
    disabled: mode === 'single',
    selectedId: initialLocationSelection(locations, preferredId, opts),
  };
}

/** Address, city, state, phone, contact, and the site name for a chosen location. */
export function reportSiteFields(loc: CustomerLocation): ReportSiteFields {
  return {
    address: addressWithZip(loc.address, loc.zip),
    city: clean(loc.city),
    state: clean(loc.state),
    phone: clean(loc.phone),
    contactName: clean(loc.contact_name),
    siteName: clean(loc.name),
  };
}

export function matchLocationId(
  locations: CustomerLocation[],
  fields: { address?: string | null; city?: string | null; state?: string | null }
): string {
  const address = clean(fields.address).toLowerCase();
  const city = clean(fields.city).toLowerCase();
  const state = clean(fields.state).toLowerCase();
  if (!address && !city) return '';
  const found = locations.find((loc) => {
    const line = addressWithZip(loc.address, loc.zip).toLowerCase();
    if (address && line !== address) return false;
    if (city && clean(loc.city).toLowerCase() !== city) return false;
    if (state && clean(loc.state).toLowerCase() !== state) return false;
    return Boolean(line || city);
  });
  return found ? String(found.id) : '';
}

export function equipmentOptionLabel(row: ReportEquipmentRow): string {
  const makeModel = [clean(row.manufacturer), clean(row.model)].filter(Boolean).join(' ');
  const serial = clean(row.serial_number);
  if (makeModel && serial) return `${makeModel} · ${serial}`;
  return makeModel || serial || `Equipment ${row.id}`;
}

/**
 * Equipment whose location_id is the selected site, plus lasers with no site.
 * Equipment assigned to a different site is omitted unless its id is in keepIds
 * (the ticket's laser stays visible). Unassigned rows are never hidden.
 */
export function groupEquipmentForSite(
  rows: ReportEquipmentRow[],
  locationId: string | number | null | undefined,
  opts?: { keepIds?: Array<string | number | null | undefined>; siteLabel?: string }
): EquipmentSiteGroups {
  const keep = new Set(
    (opts?.keepIds || [])
      .filter((id) => id != null && String(id) !== '')
      .map((id) => String(id))
  );
  const selected = locationId == null || locationId === '' ? '' : String(locationId);
  const atSite: ReportEquipmentRow[] = [];
  const unassigned: ReportEquipmentRow[] = [];
  for (const row of rows) {
    if (!row || row.id == null || row.id === '') continue;
    const loc = row.location_id == null || row.location_id === '' ? '' : String(row.location_id);
    if (!selected) {
      unassigned.push(row);
      continue;
    }
    if (loc && loc === selected) {
      atSite.push(row);
      continue;
    }
    if (!loc || keep.has(String(row.id))) unassigned.push(row);
  }
  return {
    atSite,
    unassigned,
    siteLabel: clean(opts?.siteLabel) || 'At this location',
  };
}

/** True when this equipment row is in the list but filtered out of the current site. */
export function shouldClearEquipmentSelection(
  rows: ReportEquipmentRow[],
  groups: EquipmentSiteGroups,
  equipmentId: string | number | null | undefined
): boolean {
  if (equipmentId == null || equipmentId === '') return false;
  const id = String(equipmentId);
  const known = rows.some((row) => String(row.id) === id);
  if (!known) return false;
  return ![...groups.atSite, ...groups.unassigned].some((row) => String(row.id) === id);
}

/** Remember a missing equipment.location_id so later customer picks skip that select. */
let equipmentLocationIdMissing = false;

export function resetEquipmentLocationProbe(): void {
  equipmentLocationIdMissing = false;
}

function missingLocationColumn(error?: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const text = `${code} ${error.message || ''}`;
  if (code === '42703' || code === 'PGRST204' || /PGRST204/i.test(text)) return true;
  return /location_id/i.test(text) && /column|schema cache|does not exist|42703/i.test(text);
}

function normalizeEquipment(row: Record<string, unknown> | null | undefined): ReportEquipmentRow | null {
  if (!row || row.id == null || row.id === '') return null;
  const locationId = row.location_id;
  return {
    id: row.id as string | number,
    manufacturer: clean(row.manufacturer) || null,
    model: clean(row.model) || null,
    serial_number: clean(row.serial_number) || null,
    location_id:
      locationId == null || locationId === '' ? null : (locationId as string | number),
  };
}

/** Customer lasers. A missing location_id column yields rows with location_id null. */
export async function loadCustomerEquipment(
  supabase: LocationsReader,
  customerId: string | number | null | undefined
): Promise<ReportEquipmentRow[]> {
  if (customerId == null || customerId === '') return [];
  const full = 'id, manufacturer, model, serial_number, location_id, customer_organization_id';
  const safe = 'id, manufacturer, model, serial_number, customer_organization_id';
  try {
    let res = await supabase
      .from('equipment')
      .select(equipmentLocationIdMissing ? safe : full)
      .eq('customer_organization_id', customerId)
      .limit(200);
    if (res?.error && missingLocationColumn(res.error)) {
      equipmentLocationIdMissing = true;
      res = await supabase
        .from('equipment')
        .select(safe)
        .eq('customer_organization_id', customerId)
        .limit(200);
    }
    if (res?.error || !Array.isArray(res?.data)) return [];
    return res.data
      .map((row: Record<string, unknown>) => normalizeEquipment(row))
      .filter((row: ReportEquipmentRow | null): row is ReportEquipmentRow => Boolean(row));
  } catch {
    return [];
  }
}
