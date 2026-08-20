/**
 * Parts-for-sale helpers. Consumables, used systems, and RFQs stay out of this lane.
 */

export type MarketplaceListingLike = {
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
