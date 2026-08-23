/**
 * Org-plan Stripe Checkout on the existing RepairPlanet / TSP account.
 * Reuses STRIPE_SECRET_KEY / STRIPE_SECRET (same as invoice + parts).
 * Cancel URL is unpaid — Checkout does not charge until the customer confirms.
 */

import {
  getStripeSecret,
  resolveStripeSecret,
  stripeLiveRequired,
  stripeMissingSecretMessage,
  stripeSecretProblem,
  stripeSiteOrigin,
  stripeTestKeyOnProductionMessage,
} from '@/lib/billing/stripe-pay';
import { PLAN_OFFERS, type PlanOffer, type PlanSku } from '@/lib/billing/plan-catalog';
import {
  buildUpgradeCheckoutFields,
  type UpgradeSessionOwner,
} from '@/lib/billing/upgrade-session';

type StripeObject = Record<string, unknown> & {
  id?: string;
  url?: string;
  livemode?: boolean;
  lookup_key?: string;
  unit_amount?: number;
  recurring?: { interval?: string } | null;
  data?: StripeObject[];
  error?: { message?: string };
  message?: string;
  customer?: string | StripeObject | null;
  subscription?: string | StripeObject | null;
  payment_status?: string;
  status?: string;
  mode?: string;
  metadata?: Record<string, string>;
  client_reference_id?: string;
};

export class StripeSubscriptionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StripeSubscriptionError';
    this.status = status;
  }
}

function stripeSecretOrThrow(): string {
  const problem = stripeSecretProblem();
  if (problem) throw new StripeSubscriptionError(problem, 503);
  const secret = getStripeSecret();
  if (!secret) throw new StripeSubscriptionError(stripeMissingSecretMessage(), 503);
  return secret;
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
  stripeSecretOrThrow();
  const secret = getStripeSecret() as string;
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
    throw new StripeSubscriptionError(msg, res.status >= 500 ? 502 : 400);
  }
  return data;
}

function envPriceId(sku: PlanSku): string | null {
  const envName = `STRIPE_PRICE_${sku.toUpperCase()}`;
  const value = String(process.env[envName] ?? '').trim();
  return value || null;
}

async function findPriceByLookupKey(offer: PlanOffer): Promise<string | null> {
  const listed = await stripeRequest(
    `prices?lookup_keys[]=${encodeURIComponent(offer.lookupKey)}&active=true&limit=1`,
    'GET'
  );
  const found = listed.data?.[0];
  if (found?.id) return String(found.id);
  return null;
}

async function findProductId(offer: PlanOffer): Promise<string | null> {
  try {
    const search = await stripeRequest(
      `products/search?query=${encodeURIComponent(`metadata['tsp_sku_family']:'${offer.plan}'`)}&limit=1`,
      'GET'
    );
    const hit = search.data?.[0];
    if (hit?.id) return String(hit.id);
  } catch {
    /* search may be unavailable on some keys */
  }
  return null;
}

async function ensureProduct(offer: PlanOffer): Promise<string> {
  const existing = await findProductId(offer);
  if (existing) return existing;
  const created = await stripeRequest(
    'products',
    'POST',
    {
      name: offer.productName,
      description: `${offer.productName} subscription`,
      active: 'true',
      'metadata[tsp_sku_family]': offer.plan,
      'metadata[source]': 'totalservicepro_subscription',
    },
    `tsp-plan-product-${offer.plan}`
  );
  if (!created.id) throw new StripeSubscriptionError('Stripe did not return a product id', 502);
  return String(created.id);
}

export async function resolvePlanPriceId(sku: PlanSku): Promise<{ priceId: string; offer: PlanOffer }> {
  const offer = PLAN_OFFERS[sku];
  const fromEnv = envPriceId(sku);
  if (fromEnv) return { priceId: fromEnv, offer };

  const byLookup = await findPriceByLookupKey(offer);
  if (byLookup) return { priceId: byLookup, offer };

  const productId = await ensureProduct(offer);
  const price = await stripeRequest(
    'prices',
    'POST',
    {
      product: productId,
      currency: 'usd',
      unit_amount: offer.unitAmountCents,
      'recurring[interval]': offer.interval,
      lookup_key: offer.lookupKey,
      active: 'true',
      'metadata[sku]': offer.sku,
      'metadata[plan]': offer.plan,
      'metadata[source]': 'totalservicepro_subscription',
    },
    `tsp-plan-price-${offer.sku}-${offer.unitAmountCents}`
  );
  if (!price.id) throw new StripeSubscriptionError('Stripe did not return a price id', 502);
  return { priceId: String(price.id), offer };
}

export type OrgUpgradeCheckoutResult = {
  url: string;
  sessionId: string;
  livemode: boolean | null;
  sku: PlanSku;
  organizationId: string;
};

export async function createOrgUpgradeCheckoutSession(input: {
  sku: PlanSku;
  owner: UpgradeSessionOwner;
  customerId?: string | null;
  customerEmail?: string | null;
}): Promise<OrgUpgradeCheckoutResult> {
  const { priceId, offer } = await resolvePlanPriceId(input.sku);
  const site = stripeSiteOrigin();
  const fields = buildUpgradeCheckoutFields({
    offer,
    priceId,
    owner: input.owner,
    successUrl: `${site}/plans?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${site}/plans?paid=0`,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
  });

  // No idempotency key: cancel-then-retry must open a new unpaid session.
  const session = await stripeRequest('checkout/sessions', 'POST', fields);
  if (!session.url || !session.id) {
    throw new StripeSubscriptionError('Stripe Checkout session did not return a URL', 502);
  }
  const livemode =
    typeof session.livemode === 'boolean' ? session.livemode : resolveStripeSecret().livemode;
  if (stripeLiveRequired() && livemode === false) {
    throw new StripeSubscriptionError(stripeTestKeyOnProductionMessage(), 503);
  }
  return {
    url: String(session.url),
    sessionId: String(session.id),
    livemode,
    sku: offer.sku,
    organizationId: input.owner.organizationId,
  };
}

export async function retrieveCheckoutSession(sessionId: string): Promise<StripeObject> {
  const id = String(sessionId || '').trim();
  if (!id || !/^cs_(test|live)_/.test(id)) {
    throw new StripeSubscriptionError('Invalid Checkout session id', 400);
  }
  return stripeRequest(`checkout/sessions/${encodeURIComponent(id)}`, 'GET');
}

export function stripeCustomerIdFromSession(session: StripeObject): string | null {
  const customer = session.customer;
  if (typeof customer === 'string' && customer.startsWith('cus_')) return customer;
  if (customer && typeof customer === 'object' && typeof customer.id === 'string') {
    return customer.id;
  }
  return null;
}

export function stripeSubscriptionIdFromSession(session: StripeObject): string | null {
  const sub = session.subscription;
  if (typeof sub === 'string' && sub.startsWith('sub_')) return sub;
  if (sub && typeof sub === 'object' && typeof sub.id === 'string') return sub.id;
  return null;
}
