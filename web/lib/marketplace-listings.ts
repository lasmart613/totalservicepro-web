import { loginHref } from '@/lib/login-next';

const CONSUMABLE_VALUES = new Set(['consumable', 'consumables']);
const PART_LIKE_TYPES = new Set(['part', 'parts', 'used', 'equipment']);

export type MarketplaceListingRow = {
  listing_type?: string | null;
  category?: string | null;
  details?: { kind?: string | null } | null;
};

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * True only for consumable listings. Explicit part/used/equipment types
 * never match, so /marketplace/consumables cannot show a part listing.
 */
export function isConsumableListing(row: MarketplaceListingRow): boolean {
  const type = norm(row.listing_type);
  if (PART_LIKE_TYPES.has(type)) return false;
  return (
    CONSUMABLE_VALUES.has(type) ||
    CONSUMABLE_VALUES.has(norm(row.category)) ||
    CONSUMABLE_VALUES.has(norm(row.details?.kind))
  );
}

/** PostgREST `or` filter for consumable listing_type / category values. */
export function consumablesOrFilter(): string {
  return [
    'listing_type.eq.consumable',
    'listing_type.eq.consumables',
    'category.eq.consumable',
    'category.eq.consumables',
  ].join(',');
}

export function listingOfferLoginHref(listingId: string): string {
  return loginHref(`/marketplace/listing/${listingId}`);
}
