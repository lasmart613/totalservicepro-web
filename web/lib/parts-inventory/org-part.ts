/**
 * Org inventory is the private overlay on the shared catalog.
 * Prices never move from the catalog into this row, and a blank org field
 * can be filled later. A value the org already typed is left alone.
 */

import { normalizeMpn } from './mpn.ts';

export type CatalogPublic = {
  id?: number | string | null;
  part_number?: string | null;
  mpn_normalized?: string | null;
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  specs?: Record<string, unknown> | null;
  /** Present on the legacy catalog column. Never copied into org pricing. */
  sale_price?: number | string | null;
};

export type OrgPartInput = {
  mpn?: string | null;
  brand?: string | null;
  name?: string | null;
  description?: string | null;
  internal_part_number?: string | null;
  preferred_vendor_name?: string | null;
  vendor_part_number?: string | null;
  unit_cost?: number | string | null;
  sell_price?: number | string | null;
  avg_lead_time_days?: number | string | null;
  expected_lead_time_days?: number | string | null;
  quantity_on_hand?: number | string | null;
  reorder_point?: number | string | null;
  bin_location?: string | null;
  notes?: string | null;
};

export type OrgPartRow = {
  id?: number | string | null;
  organization_id?: number | string | null;
  catalog_part_id?: number | string | null;
  mpn_normalized?: string | null;
  internal_part_number?: string | null;
  preferred_vendor_name?: string | null;
  vendor_part_number?: string | null;
  unit_cost?: number | string | null;
  sell_price?: number | string | null;
  avg_lead_time_days?: number | string | null;
  expected_lead_time_days?: number | string | null;
  quantity_on_hand?: number | string | null;
  description_override?: string | null;
  field_sources?: Record<string, string> | null;
};

export type FieldSource = 'org' | 'catalog' | 'public' | 'manual';

const PRICE_FIELDS = new Set(['unit_cost', 'sell_price', 'sale_price', 'margin']);

export function blank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

export function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseNonNegativeInt(value: unknown): number | null {
  const n = parseOptionalNumber(value);
  if (n == null) return null;
  const whole = Math.trunc(n);
  return whole >= 0 ? whole : null;
}

/** Hide zero-quantity rows unless the tech asks to see them. */
export function filterInventoryRows<T extends { quantity_on_hand?: number | string | null }>(
  rows: T[],
  opts: { hideZero?: boolean } = {},
): T[] {
  const hideZero = opts.hideZero !== false;
  if (!hideZero) return rows;
  return rows.filter((row) => {
    const qty = Number(row.quantity_on_hand);
    return Number.isFinite(qty) && qty > 0;
  });
}

export function findExistingOrgPart<T extends OrgPartRow>(
  rows: T[],
  input: { mpn?: string | null; catalogPartId?: number | string | null; internalPartNumber?: string | null },
): T | null {
  const mpn = normalizeMpn(input.mpn);
  const catalog = input.catalogPartId == null || input.catalogPartId === '' ? '' : String(input.catalogPartId);
  const sku = String(input.internalPartNumber || '').trim().toLowerCase();
  return (
    rows.find((row) => catalog && String(row.catalog_part_id ?? '') === catalog) ||
    rows.find((row) => mpn && normalizeMpn(row.mpn_normalized) === mpn) ||
    rows.find((row) => sku && String(row.internal_part_number || '').trim().toLowerCase() === sku) ||
    null
  );
}

/**
 * Build the shared-catalog insert. Price fields on the input are ignored.
 */
export function catalogInsertFromOrg(input: OrgPartInput): {
  part_number: string;
  mpn_normalized: string;
  name: string;
  description: string | null;
  brand: string;
  category: string;
} | null {
  const mpn = normalizeMpn(input.mpn);
  if (!mpn) return null;
  const description = String(input.description || input.name || '').trim() || null;
  const name = String(input.name || description || input.mpn || mpn).trim().slice(0, 200);
  return {
    part_number: String(input.mpn || '').trim() || mpn,
    mpn_normalized: mpn,
    name,
    description,
    brand: String(input.brand || '').trim() || 'Unknown',
    category: 'Other',
  };
}

export function orgInsertPayload(
  organizationId: number | string,
  input: OrgPartInput,
  catalogPartId: number | string | null,
): Record<string, unknown> {
  const mpn = normalizeMpn(input.mpn);
  const sources: Record<string, FieldSource> = {};
  if (!blank(input.description) || !blank(input.name)) sources.description = 'org';
  if (!blank(input.preferred_vendor_name)) sources.preferred_vendor = 'org';
  if (!blank(input.unit_cost)) sources.unit_cost = 'org';
  if (!blank(input.sell_price)) sources.sell_price = 'org';
  return {
    organization_id: organizationId,
    catalog_part_id: catalogPartId,
    mpn_normalized: mpn,
    internal_part_number: blank(input.internal_part_number) ? null : String(input.internal_part_number).trim(),
    preferred_vendor_name: blank(input.preferred_vendor_name) ? null : String(input.preferred_vendor_name).trim(),
    vendor_part_number: blank(input.vendor_part_number) ? null : String(input.vendor_part_number).trim(),
    unit_cost: parseOptionalNumber(input.unit_cost),
    sell_price: parseOptionalNumber(input.sell_price),
    avg_lead_time_days: parseNonNegativeInt(input.avg_lead_time_days),
    expected_lead_time_days: parseNonNegativeInt(input.expected_lead_time_days),
    quantity_on_hand: parseNonNegativeInt(input.quantity_on_hand) ?? 0,
    reorder_point: parseNonNegativeInt(input.reorder_point),
    bin_location: blank(input.bin_location) ? null : String(input.bin_location).trim(),
    notes: blank(input.notes) ? null : String(input.notes).trim(),
    description_override: blank(input.description) ? null : String(input.description).trim(),
    field_sources: sources,
  };
}

export type EnrichmentPatch = {
  patch: Record<string, unknown>;
  sources: Record<string, FieldSource>;
  filled: string[];
};

/**
 * Fill only blank org fields. Catalog sale_price is never a source.
 * Public enrichment is a stub until a reviewed lookup is wired in.
 */
export function enrichBlankOrgFields(
  org: OrgPartRow,
  catalog: CatalogPublic | null,
  publicFields: Record<string, unknown> | null = null,
): EnrichmentPatch {
  const patch: Record<string, unknown> = {};
  const sources: Record<string, FieldSource> = {
    ...((org.field_sources || {}) as Record<string, FieldSource>),
  };
  const filled: string[] = [];

  const take = (field: string, value: unknown, source: FieldSource) => {
    if (PRICE_FIELDS.has(field)) return;
    if (!blank((org as Record<string, unknown>)[field])) return;
    if (blank(value)) return;
    patch[field] = typeof value === 'string' ? value.trim() : value;
    sources[field] = source;
    filled.push(field);
  };

  if (catalog) {
    take('description_override', catalog.description || catalog.name, 'catalog');
  }
  if (publicFields) {
    for (const [field, value] of Object.entries(publicFields)) {
      if (field === 'description' || field === 'description_override') {
        take('description_override', value, 'public');
      } else if (field === 'specs') {
        continue;
      } else {
        take(field, value, 'public');
      }
    }
  }
  if (filled.length) patch.field_sources = sources;
  return { patch, sources, filled };
}

/** No network lookup in this release. The sweep and a later job call this seam. */
export function publicEnrichmentStub(_mpn: string): {
  available: false;
  reason: string;
  fields: Record<string, unknown>;
} {
  return {
    available: false,
    reason: 'Public part lookup is not configured. Blank description can still be copied from the shared catalog.',
    fields: {},
  };
}
