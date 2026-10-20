/** marketplace_listings.id is a uuid; anything else can never match a row. */
const LISTING_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMarketplaceListingId(value: unknown): value is string {
  return typeof value === 'string' && LISTING_ID_RE.test(value.trim());
}
