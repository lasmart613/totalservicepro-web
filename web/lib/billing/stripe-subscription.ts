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

export type StripeObject = Record<string, unknown> & {
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
  method: 'GET' | 'POST' | 'DELETE',
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
    successUrl: `${site}/checkout/receipt?session_id={CHECKOUT_SESSION_ID}`,
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
  return stripeRequest(
    `checkout/sessions/${encodeURIComponent(id)}?expand[]=invoice`,
    'GET'
  );
}

function stripeSearchQuote(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export async function listCompleteCheckoutSessionsForCustomer(
  customerId: string,
  limit = 20
): Promise<StripeObject[]> {
  const id = String(customerId || '').trim();
  if (!id || !id.startsWith('cus_')) return [];
  const listed = await stripeRequest(
    `checkout/sessions?customer=${encodeURIComponent(id)}&status=complete&limit=${Math.min(limit, 100)}`,
    'GET'
  );
  return Array.isArray(listed.data) ? listed.data : [];
}

export async function searchCheckoutSessions(query: string, limit = 20): Promise<StripeObject[]> {
  const q = String(query || '').trim();
  if (!q) return [];
  try {
    const listed = await stripeRequest(
      `checkout/sessions/search?query=${encodeURIComponent(q)}&limit=${Math.min(limit, 100)}`,
      'GET'
    );
    return Array.isArray(listed.data) ? listed.data : [];
  } catch {
    return [];
  }
}

export function checkoutSessionSearchQuery(input: {
  organizationId?: string | null;
  userId?: string | null;
}): string | null {
  const parts = [`status:'complete'`, `metadata['kind']:'org_plan'`];
  const orgId = String(input.organizationId || '').trim();
  const userId = String(input.userId || '').trim();
  if (orgId) parts.push(`metadata['organization_id']:${stripeSearchQuote(orgId)}`);
  else if (userId) parts.push(`metadata['user_id']:${stripeSearchQuote(userId)}`);
  else return null;
  return parts.join(' AND ');
}

export async function listCustomersByEmail(email: string): Promise<StripeObject[]> {
  const value = String(email || '').trim();
  if (!value.includes('@')) return [];
  const listed = await stripeRequest(
    `customers?email=${encodeURIComponent(value)}&limit=5`,
    'GET'
  );
  return Array.isArray(listed.data) ? listed.data : [];
}

export async function listActiveSubscriptionsForCustomer(
  customerId: string,
  limit = 10
): Promise<StripeObject[]> {
  const id = String(customerId || '').trim();
  if (!id || !id.startsWith('cus_')) return [];
  const listed = await stripeRequest(
    `subscriptions?customer=${encodeURIComponent(id)}&status=active&limit=${Math.min(limit, 100)}`,
    'GET'
  );
  return Array.isArray(listed.data) ? listed.data : [];
}

export async function retrieveStripeSubscription(subscriptionId: string): Promise<StripeObject> {
  const id = String(subscriptionId || '').trim();
  if (!id || !/^sub_/.test(id)) {
    throw new StripeSubscriptionError('Invalid subscription id', 400);
  }
  return stripeRequest(`subscriptions/${encodeURIComponent(id)}`, 'GET');
}

export async function retrieveStripeInvoice(invoiceId: string): Promise<StripeObject> {
  const id = String(invoiceId || '').trim();
  if (!id || !/^in_/.test(id)) {
    throw new StripeSubscriptionError('Invalid invoice id', 400);
  }
  return stripeRequest(`invoices/${encodeURIComponent(id)}`, 'GET');
}

/** Cancel a replaced Premium subscription after Team checkout so the org is not double-billed. */
export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
  const id = String(subscriptionId || '').trim();
  if (!id || !/^sub_/.test(id)) return;
  await stripeRequest(`subscriptions/${encodeURIComponent(id)}`, 'DELETE');
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
