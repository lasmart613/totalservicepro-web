/**
 * Parts-for-sale helpers. Consumables, used systems, and RFQs stay out of this lane.
 */

import { toPlainListingText } from './listing-copy';

export type MarketplaceListingLike = {
  id?: string;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  part_number?: string | null;
  serial_number?: string | null;
  condition?: string | null;
  listing_type?: string | null;
  category?: string | null;
  status?: string | null;
  price?: number | string | null;
  price_type?: string | null;
  qty?: number | string | null;
  quantity?: number | string | null;
  stripe_product_id?: string | null;
  stripe_price_id?: string | null;
  details?: Record<string, unknown> | null;
};

const PART_TYPES = new Set(['part', 'parts']);
const PART_CATEGORIES = new Set(['part', 'parts']);
const CONSUMABLE_VALUES = new Set(['consumable', 'consumables']);
const NON_PART_TYPES = new Set([
  'consumable',
  'consumables',
  'used',
  'equipment',
  'request',
  'service',
  'rfq',
  'need',
]);

function norm(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function detailsKind(row: MarketplaceListingLike): string {
  const details = row.details;
  if (!details || typeof details !== 'object') return '';
  return norm((details as { kind?: unknown }).kind);
}

/** True only for marketplace parts-for-sale (not consumables, used systems, or RFQs). */
export function isPartListing(row: MarketplaceListingLike | null | undefined): boolean {
  if (!row) return false;
  const type = norm(row.listing_type);
  const category = norm(row.category);
  const kind = detailsKind(row);
  if (NON_PART_TYPES.has(type) || CONSUMABLE_VALUES.has(category) || CONSUMABLE_VALUES.has(kind)) {
    return false;
  }
  return PART_TYPES.has(type) || PART_CATEGORIES.has(category) || PART_TYPES.has(kind);
}

export function listingImages(row: {
  images?: unknown;
  photos?: unknown;
  details?: Record<string, unknown> | null;
}): string[] {
  const from = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((v) => {
          if (typeof v === 'string') return v.trim();
          if (v && typeof v === 'object' && 'url' in v) return String((v as { url?: unknown }).url || '').trim();
          return '';
        })
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      const t = value.trim();
      if (!t) return [];
      if (t.startsWith('[')) {
        try {
          return from(JSON.parse(t));
        } catch {
          return [t];
        }
      }
      return [t];
    }
    return [];
  };
  const details = row.details && typeof row.details === 'object' ? row.details : null;
  const out = [
    ...from(row.images),
    ...from(row.photos),
    ...from(details?.images),
    ...from(details?.photos),
  ];
  return [...new Set(out)];
}

export function listingQuantity(row: MarketplaceListingLike | null | undefined): number | null {
  if (!row) return null;
  const details = row.details && typeof row.details === 'object' ? row.details : null;
  const raw =
    row.quantity ??
    row.qty ??
    details?.quantity_available ??
    details?.quantity ??
    details?.qty;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/** Dollars stored on the listing (same as the marketplace cards). */
export function listingPriceDollars(row: MarketplaceListingLike | null | undefined): number | null {
  if (!row) return null;
  if (norm(row.price_type) === 'contact') return null;
  if (row.price == null || row.price === '') return null;
  const n = Number(row.price);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function listingPriceCents(row: MarketplaceListingLike | null | undefined): number | null {
  const dollars = listingPriceDollars(row);
  if (dollars == null) return null;
  return Math.round(dollars * 100);
}

export function formatListingPrice(row: MarketplaceListingLike | null | undefined): string {
  const dollars = listingPriceDollars(row);
  if (dollars == null) return 'Contact for price';
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: dollars % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const UNAVAILABLE_STATUS = new Set(['sold', 'expired', 'removed', 'inactive', 'closed', 'draft']);

export function listingAvailability(row: MarketplaceListingLike | null | undefined): {
  purchasable: boolean;
  soldOut: boolean;
  reason: string | null;
} {
  if (!row) return { purchasable: false, soldOut: false, reason: 'Listing not found' };
  if (!isPartListing(row)) {
    return { purchasable: false, soldOut: false, reason: 'Only parts listings can be purchased here' };
  }
  const status = norm(row.status) || 'active';
  if (UNAVAILABLE_STATUS.has(status)) {
    const soldOut = status === 'sold';
    return {
      purchasable: false,
      soldOut,
      reason: soldOut ? 'This part has sold' : 'This listing is no longer available',
    };
  }
  const qty = listingQuantity(row);
  if (qty === 0) {
    return { purchasable: false, soldOut: true, reason: 'Sold out' };
  }
  const cents = listingPriceCents(row);
  if (cents == null) {
    return { purchasable: false, soldOut: false, reason: 'Price on request — make an offer or contact the seller' };
  }
  if (cents < 50) {
    return { purchasable: false, soldOut: false, reason: 'Price is below the Stripe $0.50 minimum' };
  }
  return { purchasable: true, soldOut: false, reason: null };
}

export function listingSellerName(row: {
  details?: Record<string, unknown> | null;
  seller_name?: string | null;
  organizations?: { name?: string | null } | { name?: string | null }[] | null;
}): string | null {
  if (row.seller_name && String(row.seller_name).trim()) return String(row.seller_name).trim();
  const details = row.details && typeof row.details === 'object' ? row.details : null;
  const fromDetails = details?.seller_org_name || details?.seller_name || details?.organization_name;
  if (fromDetails && String(fromDetails).trim()) return String(fromDetails).trim();
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  if (org?.name && String(org.name).trim()) return String(org.name).trim();
  return null;
}

export function storedStripeIds(row: MarketplaceListingLike | null | undefined): {
  productId: string | null;
  priceId: string | null;
} {
  const details = row?.details && typeof row.details === 'object' ? row.details : null;
  const productId =
    (typeof row?.stripe_product_id === 'string' && row.stripe_product_id) ||
    (typeof details?.stripe_product_id === 'string' && details.stripe_product_id) ||
    null;
  const priceId =
    (typeof row?.stripe_price_id === 'string' && row.stripe_price_id) ||
    (typeof details?.stripe_price_id === 'string' && details.stripe_price_id) ||
    null;
  return { productId, priceId };
}

export function partsDetailPath(id: string): string {
  return `/marketplace/parts/${encodeURIComponent(id)}`;
}

export function listingBrand(row: MarketplaceListingLike | null | undefined): string {
  const brand = String(row?.manufacturer || '').trim();
  return brand;
}

export function listingPartCategory(row: MarketplaceListingLike | null | undefined): string {
  const details = row?.details && typeof row.details === 'object' ? row.details : null;
  const fromDetails = String(details?.part_category || details?.category || '').trim();
  if (fromDetails && !PART_CATEGORIES.has(fromDetails.toLowerCase()) && !CONSUMABLE_VALUES.has(fromDetails.toLowerCase())) {
    return fromDetails;
  }
  const category = String(row?.category || '').trim();
  if (category && !PART_CATEGORIES.has(category.toLowerCase())) return category;
  return '';
}

export function listingCondition(row: MarketplaceListingLike | null | undefined): string {
  return String(row?.condition || '').trim();
}

export function listingSearchText(row: MarketplaceListingLike | null | undefined): string {
  const details = row?.details && typeof row.details === 'object' ? row.details : null;
  const bits = [
    row?.title,
    row?.description,
    row?.notes,
    row?.manufacturer,
    row?.model,
    row?.part_number,
    row?.serial_number,
    details?.sku,
    details?.part_category,
    details?.compatible_models,
    listingPartCategory(row),
  ];
  return toPlainListingText(bits.filter((v) => v != null && String(v).trim()).join('\n')).toLowerCase();
}

export type PartsPriceBucket = 'all' | 'lt250' | '250to1000' | '1000to5000' | 'gt5000';
export type PartsAvailabilityFilter = 'all' | 'in_stock' | 'sold_out';

export type PartsCatalogFilters = {
  query: string;
  brand: string;
  category: string;
  condition: string;
  availability: PartsAvailabilityFilter;
  price: PartsPriceBucket;
};

export const EMPTY_PARTS_FILTERS: PartsCatalogFilters = {
  query: '',
  brand: '',
  category: '',
  condition: '',
  availability: 'all',
  price: 'all',
};

function priceBucketMatch(dollars: number | null, bucket: PartsPriceBucket): boolean {
  if (bucket === 'all') return true;
  if (dollars == null) return false;
  if (bucket === 'lt250') return dollars < 250;
  if (bucket === '250to1000') return dollars >= 250 && dollars < 1000;
  if (bucket === '1000to5000') return dollars >= 1000 && dollars < 5000;
  return dollars >= 5000;
}

export function uniqueSortedLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function filterPartsListings<T extends MarketplaceListingLike>(
  rows: T[],
  filters: PartsCatalogFilters
): T[] {
  const tokens = filters.query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const brand = filters.brand.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const condition = filters.condition.trim().toLowerCase();

  return rows.filter((row) => {
    if (tokens.length) {
      const hay = listingSearchText(row);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    if (brand && listingBrand(row).toLowerCase() !== brand) return false;
    if (category && listingPartCategory(row).toLowerCase() !== category) return false;
    if (condition && listingCondition(row).toLowerCase() !== condition) return false;
    const avail = listingAvailability(row);
    if (filters.availability === 'in_stock' && avail.soldOut) return false;
    if (filters.availability === 'sold_out' && !avail.soldOut) return false;
    if (!priceBucketMatch(listingPriceDollars(row), filters.price)) return false;
    return true;
  });
}

export function partsFiltersActive(filters: PartsCatalogFilters): boolean {
  return (
    !!filters.query.trim() ||
    !!filters.brand ||
    !!filters.category ||
    !!filters.condition ||
    filters.availability !== 'all' ||
    filters.price !== 'all'
  );
}
