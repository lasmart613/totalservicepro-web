/**
 * Build seller edit / soft-remove payloads for marketplace_listings.
 * Never lets a client change ownership or wipe Stripe catalog ids.
 */

export const LISTING_UPDATE_FIELDS = [
  'title',
  'description',
  'price',
  'price_type',
  'part_number',
  'manufacturer',
  'model',
  'condition',
  'quantity',
  'city',
  'state',
  'images',
  'photos',
  'notes',
  'serial_number',
] as const;

const DETAILS_KEYS = [
  'sku',
  'part_category',
  'compatible_models',
  'oem_type',
  'warranty',
  'quantity_available',
  'min_order_qty',
  'unit_of_measure',
  'quantity_breaks',
  'shipping',
  'images',
  'photos',
] as const;

const STRIPE_DETAIL_KEYS = ['stripe_product_id', 'stripe_price_id', 'stripe_price_cents'] as const;

export type ListingDetails = Record<string, unknown>;

function asRecord(value: unknown): ListingDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ListingDetails;
}

function asImageList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((v) => {
      if (typeof v === 'string') return v.trim();
      if (v && typeof v === 'object' && 'url' in v) return String((v as { url?: unknown }).url || '').trim();
      return '';
    })
    .filter(Boolean);
}

export function mergeListingDetails(existing: unknown, incoming: unknown): ListingDetails {
  const base = { ...(asRecord(existing) || {}) };
  const next = asRecord(incoming);
  if (!next) return base;
  for (const key of DETAILS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    if (key === 'shipping') {
      const prevShip = asRecord(base.shipping) || {};
      const nextShip = asRecord(next.shipping);
      base.shipping = nextShip ? { ...prevShip, ...nextShip } : next.shipping;
    } else {
      base[key] = next[key];
    }
  }
  const prev = asRecord(existing);
  for (const key of STRIPE_DETAIL_KEYS) {
    if (prev && prev[key] != null) base[key] = prev[key];
  }
  return base;
}

function normalizePrice(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeQty(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

export function buildListingUpdatePayload(
  body: Record<string, unknown>,
  existing?: { details?: unknown; images?: unknown; photos?: unknown }
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of LISTING_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(out, 'price')) {
    out.price = normalizePrice(out.price);
  }
  if (out.price_type === 'contact') {
    out.price = null;
  }
  if (typeof out.state === 'string') {
    out.state = out.state.trim() ? out.state.trim().toUpperCase() : null;
  }
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (typeof out.description === 'string') out.description = out.description.trim();
  if (typeof out.part_number === 'string') out.part_number = out.part_number.trim();
  if (typeof out.manufacturer === 'string') out.manufacturer = out.manufacturer.trim() || null;
  if (typeof out.model === 'string') out.model = out.model.trim() || null;

  const qty = Object.prototype.hasOwnProperty.call(out, 'quantity') ? normalizeQty(out.quantity) : null;
  if (qty != null) {
    out.quantity = qty;
    out.qty = qty;
  }

  const images = asImageList(out.images) || asImageList(out.photos);
  if (images) {
    out.images = images;
    out.photos = images;
  }

  const incomingDetails = asRecord(body.details);
  const details = mergeListingDetails(existing?.details, incomingDetails);
  if (qty != null) details.quantity_available = qty;
  if (images) {
    details.images = images;
    details.photos = images;
  }
  out.details = details;

  if (body.status === 'removed' || body.status === 'active') {
    out.status = body.status;
  }

  out.updated_at = new Date().toISOString();
  return out;
}

export function buildListingRemovePayload(): { status: 'removed'; updated_at: string } {
  return { status: 'removed', updated_at: new Date().toISOString() };
}

export function sanitizeListingDetails(details: unknown): unknown {
  const rec = asRecord(details);
  if (!rec) return details;
  const d = { ...rec };
  delete d.seller_email;
  delete d.seller_phone;
  delete d.contact_email;
  delete d.contact_phone;
  return d;
}
