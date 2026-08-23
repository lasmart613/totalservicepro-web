/**
 * Org-plan Stripe Checkout using products that already exist on the
 * RepairPlanet / TSP account. Never creates products or prices.
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
import { isStripePriceId, livePlanFromStripePrice, type LivePlanPrice } from '@/lib/billing/plan-catalog';
import {
  buildUpgradeCheckoutFields,
  type UpgradeSessionOwner,
} from '@/lib/billing/upgrade-session';

type StripeObject = Record<string, unknown> & {
  id?: string;
  url?: string;
  livemode?: boolean;
  lookup_key?: string | null;
  unit_amount?: number;
  currency?: string;
  type?: string;
  active?: boolean;
  recurring?: { interval?: string } | null;
  product?: string | StripeObject | null;
  metadata?: Record<string, string>;
  data?: StripeObject[];
  error?: { message?: string };
  message?: string;
  customer?: string | StripeObject | null;
  subscription?: string | StripeObject | null;
  payment_status?: string;
  status?: string;
  mode?: string;
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
  fields?: Record<string, string | number | boolean | null | undefined>
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
  }
  const res = await fetch(url, { method, headers, body });
  const data = (await res.json().catch(() => ({}))) as StripeObject;
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `Stripe ${path} failed (${res.status})`;
    throw new StripeSubscriptionError(msg, res.status >= 500 ? 502 : 400);
  }
  return data;
}

/** Existing recurring prices only. Does not create Products or Prices. */
export async function listLivePlanPrices(): Promise<LivePlanPrice[]> {
  const listed = await stripeRequest(
    'prices?active=true&type=recurring&limit=100&expand[]=data.product',
    'GET'
  );
  const out: LivePlanPrice[] = [];
  for (const row of listed.data || []) {
    const plan = livePlanFromStripePrice(row);
    if (plan) out.push(plan);
  }
  return out;
}

export async function requireLivePlanPrice(priceId: string): Promise<LivePlanPrice> {
  if (!isStripePriceId(priceId)) {
    throw new StripeSubscriptionError('Not an existing Stripe price', 400);
  }
  const price = await stripeRequest(
    `prices/${encodeURIComponent(priceId)}?expand[]=product`,
    'GET'
  );
  const plan = livePlanFromStripePrice(price);
  if (!plan) {
    throw new StripeSubscriptionError(
      'That Stripe price is not an existing recurring plan on this account.',
      404
    );
  }
  return plan;
}

export type OrgUpgradeCheckoutResult = {
  url: string;
  sessionId: string;
  livemode: boolean | null;
  priceId: string;
  organizationId: string;
};

export async function createOrgUpgradeCheckoutSession(input: {
  priceId: string;
  owner: UpgradeSessionOwner;
  customerId?: string | null;
  customerEmail?: string | null;
}): Promise<OrgUpgradeCheckoutResult> {
  const offer = await requireLivePlanPrice(input.priceId);
  const site = stripeSiteOrigin();
  const fields = buildUpgradeCheckoutFields({
    priceId: offer.priceId,
    productId: offer.productId,
    owner: input.owner,
    successUrl: `${site}/plans?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${site}/plans?paid=0`,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
  });

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
    priceId: offer.priceId,
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
