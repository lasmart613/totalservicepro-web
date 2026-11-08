/**
 * One search across the shared catalog MPN, any vendor's own number,
 * and the signed-in org's inventory numbers. Prices stay on the org row.
 * Vendor names are data (Candela, Parts for Laser, Laser Scientific, …).
 */

import { normalizeMpn } from './mpn.ts';

export type CrossRefMatch = 'mpn' | 'vendor_pn' | 'org_internal' | 'org_vendor_pn' | 'description';

export type CrossRefCatalog = {
  id: number | string;
  part_number?: string | null;
  mpn_normalized?: string | null;
  name?: string | null;
  description?: string | null;
  brand?: string | null;
};

export type CrossRefVendor = {
  part_id: number | string;
  vendor_name: string;
  vendor_part_number?: string | null;
};

export type CrossRefOrg = {
  id: number | string;
  catalog_part_id?: number | string | null;
  mpn_normalized?: string | null;
  internal_part_number?: string | null;
  vendor_part_number?: string | null;
  preferred_vendor_name?: string | null;
  unit_cost?: number | string | null;
  sell_price?: number | string | null;
  quantity_on_hand?: number | string | null;
  description_override?: string | null;
};

export type CrossRefHit = {
  key: string;
  catalogPartId: number | string | null;
  mpn: string;
  description: string;
  brand: string | null;
  matchedOn: CrossRefMatch;
  matchedValue: string;
  vendors: { vendor_name: string; vendor_part_number: string | null }[];
  orgPartId: number | string | null;
  sellPrice: number | null;
  unitCost: number | null;
  quantityOnHand: number | null;
};

const RANK: Record<CrossRefMatch, number> = {
  mpn: 0,
  vendor_pn: 1,
  org_internal: 2,
  org_vendor_pn: 3,
  description: 4,
};

export function searchNeedle(raw: string | null | undefined): string {
  return String(raw || '').trim();
}

function includesLoose(hay: string | null | undefined, needle: string): boolean {
  const h = String(hay || '').trim().toLowerCase();
  const n = needle.trim().toLowerCase();
  return n.length >= 2 && h.includes(n);
}

function exactNorm(hay: string | null | undefined, normalized: string): boolean {
  return Boolean(normalized) && normalizeMpn(hay) === normalized;
}

function better(next: CrossRefMatch, prev: CrossRefMatch): boolean {
  return RANK[next] < RANK[prev];
}

function moneyOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fold catalog rows, global vendor numbers, and this org's identifiers into
 * one hit per catalog part (or per unmatched org row).
 */
export function searchCrossReference(
  rawQuery: string,
  input: { catalog: CrossRefCatalog[]; vendors: CrossRefVendor[]; orgParts: CrossRefOrg[] },
): CrossRefHit[] {
  const needle = searchNeedle(rawQuery);
  const normalized = normalizeMpn(needle);
  if (needle.length < 2) return [];

  const vendorsByPart = new Map<string, CrossRefVendor[]>();
  for (const vendor of input.vendors) {
    const key = String(vendor.part_id);
    const list = vendorsByPart.get(key) || [];
    list.push(vendor);
    vendorsByPart.set(key, list);
  }
  const catalogById = new Map(input.catalog.map((part) => [String(part.id), part]));

  const hits = new Map<string, CrossRefHit>();

  const touch = (
    key: string,
    base: Omit<CrossRefHit, 'matchedOn' | 'matchedValue' | 'vendors'> & { vendors?: CrossRefHit['vendors'] },
    matchedOn: CrossRefMatch,
    matchedValue: string,
  ) => {
    const prev = hits.get(key);
    const vendors = base.vendors || prev?.vendors || [];
    if (!prev) {
      hits.set(key, { ...base, vendors, matchedOn, matchedValue });
      return;
    }
    hits.set(key, {
      ...prev,
      ...base,
      vendors: vendors.length ? vendors : prev.vendors,
      orgPartId: base.orgPartId ?? prev.orgPartId,
      sellPrice: base.sellPrice ?? prev.sellPrice,
      unitCost: base.unitCost ?? prev.unitCost,
      quantityOnHand: base.quantityOnHand ?? prev.quantityOnHand,
      matchedOn: better(matchedOn, prev.matchedOn) ? matchedOn : prev.matchedOn,
      matchedValue: better(matchedOn, prev.matchedOn) ? matchedValue : prev.matchedValue,
    });
  };

  for (const part of input.catalog) {
    const vendors = vendorsByPart.get(String(part.id)) || [];
    const mpn = String(part.part_number || part.mpn_normalized || '');
    let matchedOn: CrossRefMatch | null = null;
    let matchedValue = '';
    if (exactNorm(part.mpn_normalized || part.part_number, normalized)) {
      matchedOn = 'mpn';
      matchedValue = mpn;
    } else if (includesLoose(part.part_number, needle)) {
      matchedOn = 'mpn';
      matchedValue = mpn;
    }
    const vendorHit = vendors.find(
      (vendor) => exactNorm(vendor.vendor_part_number, normalized) || includesLoose(vendor.vendor_part_number, needle),
    );
    if (!matchedOn && vendorHit) {
      matchedOn = 'vendor_pn';
      matchedValue = String(vendorHit.vendor_part_number || '');
    }
    if (!matchedOn && (includesLoose(part.name, needle) || includesLoose(part.description, needle))) {
      matchedOn = 'description';
      matchedValue = String(part.name || part.description || '');
    }
    if (!matchedOn) continue;
    touch(
      `cat-${part.id}`,
      {
        key: `cat-${part.id}`,
        catalogPartId: part.id,
        mpn,
        description: String(part.name || part.description || mpn),
        brand: part.brand ? String(part.brand) : null,
        vendors: vendors.map((vendor) => ({
          vendor_name: vendor.vendor_name,
          vendor_part_number: vendor.vendor_part_number ? String(vendor.vendor_part_number) : null,
        })),
        orgPartId: null,
        sellPrice: null,
        unitCost: null,
        quantityOnHand: null,
      },
      matchedOn,
      matchedValue,
    );
  }

  for (const org of input.orgParts) {
    const catalogKey = org.catalog_part_id != null ? `cat-${org.catalog_part_id}` : '';
    let matchedOn: CrossRefMatch | null = null;
    let matchedValue = '';
    if (exactNorm(org.mpn_normalized, normalized)) {
      matchedOn = 'mpn';
      matchedValue = String(org.mpn_normalized);
    } else if (exactNorm(org.internal_part_number, normalized) || includesLoose(org.internal_part_number, needle)) {
      matchedOn = 'org_internal';
      matchedValue = String(org.internal_part_number || '');
    } else if (exactNorm(org.vendor_part_number, normalized) || includesLoose(org.vendor_part_number, needle)) {
      matchedOn = 'org_vendor_pn';
      matchedValue = String(org.vendor_part_number || '');
    }
    if (!matchedOn && !hits.has(catalogKey)) continue;
    const key = catalogKey || `org-${org.id}`;
    const existing = hits.get(key);
    const linked = org.catalog_part_id != null ? catalogById.get(String(org.catalog_part_id)) : undefined;
    const linkedVendors = linked ? vendorsByPart.get(String(linked.id)) || [] : [];
    touch(
      key,
      {
        key,
        catalogPartId: org.catalog_part_id ?? existing?.catalogPartId ?? null,
        mpn: existing?.mpn || String(linked?.part_number || org.mpn_normalized || org.internal_part_number || ''),
        description: existing?.description || String(linked?.name || linked?.description || org.description_override || ''),
        brand: existing?.brand ?? (linked?.brand ? String(linked.brand) : null),
        vendors:
          existing?.vendors ||
          linkedVendors.map((vendor) => ({
            vendor_name: vendor.vendor_name,
            vendor_part_number: vendor.vendor_part_number ? String(vendor.vendor_part_number) : null,
          })),
        orgPartId: org.id,
        sellPrice: moneyOrNull(org.sell_price),
        unitCost: moneyOrNull(org.unit_cost),
        quantityOnHand: moneyOrNull(org.quantity_on_hand),
      },
      matchedOn || existing?.matchedOn || 'mpn',
      matchedValue || existing?.matchedValue || '',
    );
  }

  return [...hits.values()].sort((a, b) => RANK[a.matchedOn] - RANK[b.matchedOn] || a.mpn.localeCompare(b.mpn));
}

export function matchLabel(matchedOn: CrossRefMatch): string {
  if (matchedOn === 'mpn') return 'Manufacturer number';
  if (matchedOn === 'vendor_pn') return 'Vendor number';
  if (matchedOn === 'org_internal') return 'Your inventory number';
  if (matchedOn === 'org_vendor_pn') return 'Your vendor number';
  return 'Description';
}
