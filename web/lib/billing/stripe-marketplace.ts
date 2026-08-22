/**
 * Sync marketplace parts listings to Stripe Products + Prices on the existing
 * RepairPlanet / TSP Stripe account (STRIPE_SECRET_KEY). Reuses IDs when present.
 */

import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  isPartListing,
  listingAvailability,
  listingImages,
  listingPriceCents,
  listingQuantity,
  storedStripeIds,
  type MarketplaceListingLike,
} from '@/lib/marketplace/parts';
import { getStripeSecret, stripeSiteOrigin } from '@/lib/billing/stripe-pay';

const LISTING_META = 'marketplace_listing_id';
const KIND_META = 'marketplace_kind';

export type StripeCatalogResult = {
  productId: string;
  priceId: string;
  amountCents: number;
  reused: boolean;
};

export type PartCheckoutResult = {
  url: string;
  sessionId: string;
  productId: string;
  priceId: string;
  amountCents: number;
};

type StripeObject = Record<string, unknown> & {
  id?: string;
  url?: string;
  deleted?: boolean;
  active?: boolean;
  unit_amount?: number;
  default_price?: string | StripeObject | null;
  data?: StripeObject[];
  error?: { message?: string };
  message?: string;
};

function stripeSecretOrThrow(): string {
  const secret = getStripeSecret();
  if (!secret) {
    throw new StripeMarketplaceError(
      'STRIPE_SECRET_KEY is not set on the server. Add the existing RepairPlanet Stripe secret in Netlify.',
      503
    );
  }
  return secret;
}

export class StripeMarketplaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StripeMarketplaceError';
    this.status = status;
  }
}

function formBody(fields: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

async function stripeRequest(
  path: string,
  method: 'GET' | 'POST',
  fields?: Record<string, string | number | boolean | null | undefined>,
  idempotencyKey?: string
): Promise<StripeObject> {
  const secret = stripeSecretOrThrow();
  const url = path.startsWith('http') ? path : `https://api.stripe.com/v1/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
  };
  let body: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = formBody(fields || {});
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 255);
  }
  const res = await fetch(url, { method, headers, body });
  const data = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `Stripe ${path} failed (${res.status})`;
    throw new StripeMarketplaceError(msg, res.status >= 500 ? 502 : 400);
  }
  return data;
}

function productFields(listing: MarketplaceListingLike & { id?: string; title?: string; description?: string; notes?: string }, amountCents: number, includeDefaultPrice: boolean) {
  const title = String(listing.title || 'Marketplace part').slice(0, 120);
  const desc = String(listing.description || listing.notes || title).slice(0, 400);
  const images = listingImages(listing).filter((u) => /^https?:\/\//i.test(u)).slice(0, 8);
  const fields: Record<string, string | number | boolean> = {
    name: title,
    description: desc,
    [`metadata[${LISTING_META}]`]: String(listing.id),
    [`metadata[${KIND_META}]`]: 'part',
    [`metadata[source]`]: 'repairplanet_marketplace',
    'active': 'true',
  };
  images.forEach((url, i) => {
    fields[`images[${i}]`] = url;
  });
  if (includeDefaultPrice) {
    fields['default_price_data[currency]'] = 'usd';
    fields['default_price_data[unit_amount]'] = amountCents;
    fields[`default_price_data[metadata][${LISTING_META}]`] = String(listing.id);
  }
  return fields;
}

async function retrieveProduct(productId: string): Promise<StripeObject | null> {
  try {
    const product = await stripeRequest(
      `products/${encodeURIComponent(productId)}?expand[]=default_price`,
      'GET'
    );
    if (product?.deleted) return null;
    return product;
  } catch {
    return null;
  }
}

async function searchProductByListingId(listingId: string): Promise<StripeObject | null> {
  const query = `metadata['${LISTING_META}']:'${listingId}'`;
  try {
    const found = await stripeRequest(
      `products/search?query=${encodeURIComponent(query)}&limit=1&expand[]=data.default_price`,
      'GET'
    );
    const product = found?.data?.[0];
    if (product?.id && !product.deleted) return product;
  } catch (e) {
    console.warn('[stripe-marketplace] product search unavailable', e);
  }
  return null;
}

function priceAmount(price: StripeObject | null | undefined): number | null {
  if (!price) return null;
  const amount = Number(price.unit_amount);
  return Number.isFinite(amount) ? amount : null;
}

async function matchingPriceId(product: StripeObject, amountCents: number): Promise<string | null> {
  const def = product.default_price;
  const defObj = typeof def === 'object' && def ? def : null;
  if (defObj?.id && defObj.active !== false && priceAmount(defObj) === amountCents) {
    return String(defObj.id);
  }
  try {
    const listed = await stripeRequest(
      `prices?product=${encodeURIComponent(String(product.id || ''))}&active=true&limit=20`,
      'GET'
    );
    const match = (listed?.data || []).find(
      (p: StripeObject) => p?.id && priceAmount(p) === amountCents
    );
    if (match?.id) return String(match.id);
  } catch (e) {
    console.warn('[stripe-marketplace] list prices failed', e);
  }
  if (typeof def === 'string' && defObj == null) {
    try {
      const retrieved = await stripeRequest(`prices/${encodeURIComponent(def)}`, 'GET');
      if (retrieved?.id && retrieved.active !== false && priceAmount(retrieved) === amountCents) {
        return String(retrieved.id);
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function createPrice(productId: string, amountCents: number, listingId: string): Promise<string> {
  const price = await stripeRequest(
    'prices',
    'POST',
    {
      product: productId,
      currency: 'usd',
      unit_amount: amountCents,
      [`metadata[${LISTING_META}]`]: listingId,
      [`metadata[${KIND_META}]`]: 'part',
    },
    `rp-mp-price-${listingId}-${amountCents}`
  );
  if (!price?.id) throw new StripeMarketplaceError('Stripe did not return a price id', 502);
  try {
    await stripeRequest(`products/${encodeURIComponent(productId)}`, 'POST', {
      default_price: String(price.id),
    });
  } catch {
    /* default_price update is best-effort */
  }
  return String(price.id);
}

async function persistStripeIds(
  listing: MarketplaceListingLike & { id?: string },
  productId: string,
  priceId: string,
  amountCents: number
): Promise<void> {
  if (!hasServiceRole()) return;
  const prev =
    listing.details && typeof listing.details === 'object' && !Array.isArray(listing.details)
      ? { ...listing.details }
      : {};
  const details = {
    ...prev,
    stripe_product_id: productId,
    stripe_price_id: priceId,
    stripe_price_cents: amountCents,
  };
  const admin = getSupabaseAdmin();
  const withCols = await admin
    .from('marketplace_listings')
    .update({
      stripe_product_id: productId,
      stripe_price_id: priceId,
      details,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listing.id);
  if (withCols.error && /column|does not exist|schema cache/i.test(withCols.error.message || '')) {
    const fallback = await admin
      .from('marketplace_listings')
      .update({ details, updated_at: new Date().toISOString() })
      .eq('id', listing.id);
    if (fallback.error) console.warn('[stripe-marketplace] persist details failed', fallback.error.message);
    return;
  }
  if (withCols.error) {
    console.warn('[stripe-marketplace] persist columns failed', withCols.error.message);
  }
}

export async function syncPartStripeCatalog(listing: MarketplaceListingLike & { id?: string; title?: string; description?: string; notes?: string }): Promise<StripeCatalogResult> {
  if (!isPartListing(listing)) {
    throw new StripeMarketplaceError('Refusing to create a Stripe product for a non-parts listing', 400);
  }
  const avail = listingAvailability(listing);
  if (!avail.purchasable) {
    throw new StripeMarketplaceError(avail.reason || 'Listing is not purchaseable', 409);
  }
  const amountCents = listingPriceCents(listing);
  if (amountCents == null) {
    throw new StripeMarketplaceError('Listing has no purchase price', 409);
  }

  const stored = storedStripeIds(listing as MarketplaceListingLike);
  let product: StripeObject | null = stored.productId ? await retrieveProduct(stored.productId) : null;
  if (!product) product = await searchProductByListingId(String(listing.id));

  let reused = true;
  if (!product) {
    reused = false;
    product = await stripeRequest(
      'products',
      'POST',
      productFields(listing, amountCents, true),
      `rp-mp-product-${listing.id}`
    );
  } else {
    try {
      await stripeRequest(`products/${encodeURIComponent(product.id)}`, 'POST', productFields(listing, amountCents, false));
    } catch (e) {
      console.warn('[stripe-marketplace] product update skipped', e);
    }
    if (!product.default_price) {
      const refreshed = await retrieveProduct(String(product.id));
      if (refreshed) product = refreshed;
    }
  }

  if (!product?.id) throw new StripeMarketplaceError('Stripe did not return a product id', 502);

  let priceId =
    (stored.priceId && stored.productId === product.id ? stored.priceId : null) ||
    (await matchingPriceId(product, amountCents));

  if (priceId && stored.priceId === priceId) {
    try {
      const existing = await stripeRequest(`prices/${encodeURIComponent(priceId)}`, 'GET');
      if (existing?.deleted || existing?.active === false || priceAmount(existing) !== amountCents) {
        priceId = null;
      }
    } catch {
      priceId = null;
    }
  }

  if (!priceId) {
    reused = false;
    priceId = await createPrice(String(product.id), amountCents, String(listing.id));
  }

  await persistStripeIds(listing, String(product.id), priceId, amountCents);
  return { productId: String(product.id), priceId, amountCents, reused };
}

export async function createPartCheckoutSession(input: {
  listing: MarketplaceListingLike & { id?: string; title?: string; description?: string; notes?: string };
  customerEmail?: string | null;
  quantity?: number;
}): Promise<PartCheckoutResult> {
  const catalog = await syncPartStripeCatalog(input.listing);
  const avail = listingAvailability(input.listing);
  if (!avail.purchasable) {
    throw new StripeMarketplaceError(avail.reason || 'Not purchaseable', 409);
  }
  const maxQty = listingQuantity(input.listing);
  const qty = Math.max(1, Math.min(input.quantity || 1, maxQty == null ? 1 : maxQty));
  const site = stripeSiteOrigin();
  const id = String(input.listing.id);
  const success = `${site}/marketplace/parts/${encodeURIComponent(id)}?paid=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${site}/marketplace/parts/${encodeURIComponent(id)}?paid=0`;
  const email = input.customerEmail ? String(input.customerEmail).trim() : '';

  const fields: Record<string, string | number | boolean> = {
    mode: 'payment',
    success_url: success,
    cancel_url: cancel,
    'line_items[0][price]': catalog.priceId,
    'line_items[0][quantity]': qty,
    [`metadata[${LISTING_META}]`]: id,
    [`metadata[${KIND_META}]`]: 'part',
    'payment_intent_data[metadata][marketplace_listing_id]': id,
    'payment_intent_data[metadata][marketplace_kind]': 'part',
    'shipping_address_collection[allowed_countries][0]': 'US',
    'billing_address_collection': 'auto',
  };
  if (maxQty != null && maxQty > 1) {
    fields['line_items[0][adjustable_quantity][enabled]'] = 'true';
    fields['line_items[0][adjustable_quantity][minimum]'] = 1;
    fields['line_items[0][adjustable_quantity][maximum]'] = maxQty;
  }
  if (email && email.includes('@')) {
    fields.customer_email = email;
  }

  const session = await stripeRequest('checkout/sessions', 'POST', fields);
  if (!session?.url) {
    throw new StripeMarketplaceError('Stripe Checkout session did not return a URL', 502);
  }
  return {
    url: String(session.url),
    sessionId: String(session.id),
    productId: catalog.productId,
    priceId: catalog.priceId,
    amountCents: catalog.amountCents,
  };
}

const LISTING_SELECTS = [
  'id, title, description, notes, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, qty, listing_type, category, city, state, images, photos, details, created_at, organization_id, stripe_product_id, stripe_price_id, currency',
  'id, title, description, notes, status, condition, price, price_type, manufacturer, model, serial_number, part_number, quantity, listing_type, category, city, state, images, photos, details, created_at, organization_id',
  'id, title, description, status, condition, price, manufacturer, model, serial_number, part_number, quantity, listing_type, category, images, details, created_at, organization_id',
  'id, title, description, status, condition, price, manufacturer, model, listing_type, images, details, created_at',
];

export async function loadMarketplaceListing(id: string): Promise<(MarketplaceListingLike & { id: string; title?: string }) | null> {
  if (!hasServiceRole()) {
    throw new StripeMarketplaceError(
      'SUPABASE_SERVICE_ROLE_KEY is required to load listings for checkout.',
      503
    );
  }
  const admin = getSupabaseAdmin();
  let lastErr: string | null = null;
  for (const cols of LISTING_SELECTS) {
    const { data, error } = await admin.from('marketplace_listings').select(cols).eq('id', id).maybeSingle();
    if (!error && data) return data as MarketplaceListingLike & { id: string; title?: string };
    if (error) lastErr = error.message;
    if (error && !/column|does not exist|schema cache/i.test(error.message || '')) {
      throw new StripeMarketplaceError(error.message, 500);
    }
  }
  if (lastErr) console.warn('[stripe-marketplace] listing load', lastErr);
  return null;
}

export async function resolveSellerName(listing: MarketplaceListingLike & { organization_id?: number | string | null }): Promise<string | null> {
  const details = listing?.details && typeof listing.details === 'object' ? listing.details : null;
  const fromDetails = details?.seller_org_name || details?.seller_name;
  if (fromDetails) return String(fromDetails);
  if (!listing?.organization_id || !hasServiceRole()) return null;
  try {
    const { data } = await getSupabaseAdmin()
      .from('organizations')
      .select('name')
      .eq('id', listing.organization_id)
      .maybeSingle();
    return data?.name ? String(data.name) : null;
  } catch {
    return null;
  }
}
