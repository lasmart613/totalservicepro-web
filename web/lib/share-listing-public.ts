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

function isHiddenDetailKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('stripe') || DETAIL_CONTACT_KEYS.has(k);
}

/**
 * listing.details for a public preview, recursively (nested objects and arrays):
 * drops any key containing "stripe" (case-insensitive, e.g. price_stripe_id)
 * and seller contact keys (case-insensitive, e.g. Seller_Email).
 */
export function sanitizeShareListingDetails(details: unknown, depth = 0): unknown {
  if (depth > 20) return null;
  if (Array.isArray(details)) return details.map((v) => sanitizeShareListingDetails(v, depth + 1));
  if (!details || typeof details !== 'object') return details;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (isHiddenDetailKey(key)) continue;
    out[key] = sanitizeShareListingDetails(value, depth + 1);
  }
  return out;
}
