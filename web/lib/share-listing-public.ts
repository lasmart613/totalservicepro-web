/** Public share preview helpers for /api/share/listing/[id]. */

/**
 * Columns a public share preview may return. No serial_number (equipment
 * serials identify the owner's unit) and no Stripe product/price ids: the
 * share pages never read them. part_number stays (shown as the part number).
 */
export const SHARE_LISTING_SELECTS = [
  'id, title, description, status, condition, price, price_type, manufacturer, model, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at, year_manufactured, wavelength, organization_id',
  'id, title, description, status, condition, price, price_type, manufacturer, model, part_number, quantity, listing_type, category, city, state, images, photos, details, created_at, year_manufactured, wavelength',
];

const DETAIL_CONTACT_KEYS = new Set(['seller_email', 'seller_phone', 'contact_email', 'contact_phone']);

/**
 * listing.details for a public preview: drops seller contact keys and EVERY
 * stripe* key (stripe_price_id, stripe_product_id, stripe_price_cents, ...).
 */
export function sanitizeShareListingDetails(details: unknown): unknown {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return details;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (DETAIL_CONTACT_KEYS.has(key) || /^stripe/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}
