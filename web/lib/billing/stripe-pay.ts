/**
 * Create a one-time Stripe Checkout Session URL for an invoice balance.
 *
 * Invoice pay links and marketplace parts Purchase share one Stripe account.
 * Production (repairplanet.net / Netlify CONTEXT=production) must use the
 * existing live RepairPlanet / TSP invoice secret — never a sandbox key.
 *
 * Netlify env names (values stay in the dashboard; never commit them):
 *   STRIPE_SECRET_KEY  (preferred)
 *   STRIPE_SECRET      (fallback alias)
 */

export const STRIPE_SECRET_ENV_NAMES = ['STRIPE_SECRET_KEY', 'STRIPE_SECRET'] as const;

export type StripeSecretEnvName = (typeof STRIPE_SECRET_ENV_NAMES)[number];

export type ResolvedStripeSecret = {
  secret: string | null;
  envName: StripeSecretEnvName | null;
  livemode: boolean | null;
};

/** Read env at runtime (bracket access avoids webpack inlining a build-time test key). */
function readEnv(name: string): string {
  return String(process.env[name] ?? '').trim();
}

/** true = sk_live_/rk_live_, false = sk_test_/rk_test_, null = unknown format. */
export function stripeSecretLivemode(secret: string): boolean | null {
  const key = String(secret || '').trim();
  if (/^(sk|rk)_live_/.test(key)) return true;
  if (/^(sk|rk)_test_/.test(key)) return false;
  return null;
}

/**
 * Production Checkout must be live. Deploy Preview / branch deploys may stay on test.
 */
export function stripeLiveRequired(): boolean {
  const ctx = readEnv('CONTEXT').toLowerCase() || readEnv('NETLIFY_CONTEXT').toLowerCase();
  if (ctx === 'deploy-preview' || ctx === 'branch-deploy' || ctx === 'dev') return false;
  if (ctx === 'production') return true;
  const url = readEnv('URL') || readEnv('DEPLOY_PRIME_URL') || readEnv('NEXT_PUBLIC_SITE_URL');
  return /repairplanet\.net/i.test(url);
}

/**
 * Resolve the RepairPlanet Stripe secret. If both env names are set and one is
 * live, prefer live so a leftover sk_test_ STRIPE_SECRET_KEY cannot override
 * the live invoice STRIPE_SECRET.
 */
export function resolveStripeSecret(): ResolvedStripeSecret {
  const found: ResolvedStripeSecret[] = [];
  for (const envName of STRIPE_SECRET_ENV_NAMES) {
    const secret = readEnv(envName);
    if (!secret) continue;
    found.push({ secret, envName, livemode: stripeSecretLivemode(secret) });
  }
  if (found.length === 0) {
    return { secret: null, envName: null, livemode: null };
  }
  const live = found.find((item) => item.livemode === true);
  return live || found[0];
}

/** Existing RepairPlanet / TSP Stripe secret — never invent a second account. */
export function getStripeSecret(): string | null {
  return resolveStripeSecret().secret;
}

export function stripeMissingSecretMessage(): string {
  return (
    'STRIPE_SECRET_KEY is not set on the server. Add the existing RepairPlanet ' +
    'invoice Stripe secret (STRIPE_SECRET_KEY, or alias STRIPE_SECRET) in Netlify.'
  );
}

export function stripeTestKeyOnProductionMessage(): string {
  return (
    'Production Stripe is in test/sandbox mode. Set Netlify STRIPE_SECRET_KEY ' +
    '(or STRIPE_SECRET) to the existing live RepairPlanet invoice secret ' +
    '(starts with sk_live_). Redeploy after changing it. Do not use sk_test_.'
  );
}

/** Why Checkout cannot run. Null if the resolved secret is usable. */
export function stripeSecretProblem(): string | null {
  const resolved = resolveStripeSecret();
  if (!resolved.secret) return stripeMissingSecretMessage();
  if (stripeLiveRequired() && resolved.livemode === false) {
    return stripeTestKeyOnProductionMessage();
  }
  return null;
}

export function stripeSiteOrigin(): string {
  return (readEnv('NEXT_PUBLIC_SITE_URL') || 'https://repairplanet.net').replace(/\/$/, '');
}

export type InvoicePayLinkInput = {
  amountCents: number;
  currency?: string;
  description: string;
  invoiceId?: string | number | null;
  invoiceNumber?: string | null;
  customerEmail?: string | null;
  companyName?: string | null;
};

export type InvoicePayLinkResult = {
  url: string;
  sessionId: string;
  livemode: boolean | null;
};

export async function createInvoiceCheckoutSession(
  input: InvoicePayLinkInput
): Promise<InvoicePayLinkResult | null> {
  const resolved = resolveStripeSecret();
  const secret = resolved.secret;
  if (!secret) {
    console.warn('createInvoiceCheckoutSession: STRIPE_SECRET_KEY not set');
    return null;
  }
  if (stripeLiveRequired() && resolved.livemode === false) {
    console.error('createInvoiceCheckoutSession: refusing sk_test_ on production');
    return null;
  }
  const amount = Math.round(Number(input.amountCents) || 0);
  if (amount < 50) {
    // Stripe minimum is typically $0.50 USD
    return null;
  }

  const site = stripeSiteOrigin();
  const currency = (input.currency || 'usd').toLowerCase();
  const desc =
    input.description ||
    `Invoice ${input.invoiceNumber || ''}`.trim() ||
    'Service invoice';

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${site}/invoices?paid=1&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${site}/invoices?paid=0`);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', currency);
  params.set('line_items[0][price_data][unit_amount]', String(amount));
  params.set('line_items[0][price_data][product_data][name]', desc.slice(0, 120));
  if (input.companyName) {
    params.set(
      'line_items[0][price_data][product_data][description]',
      `Payment to ${input.companyName}`.slice(0, 500)
    );
  }
  if (input.customerEmail) {
    params.set('customer_email', String(input.customerEmail).trim());
  }
  if (input.invoiceId != null) {
    params.set('metadata[invoice_id]', String(input.invoiceId));
  }
  if (input.invoiceNumber) {
    params.set('metadata[invoice_number]', String(input.invoiceNumber));
  }
  params.set('payment_intent_data[metadata][invoice_id]', String(input.invoiceId || ''));
  params.set('payment_intent_data[metadata][invoice_number]', String(input.invoiceNumber || ''));

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) {
    console.error('Stripe checkout session failed', data);
    return null;
  }
  const livemode = typeof data.livemode === 'boolean' ? data.livemode : resolved.livemode;
  if (stripeLiveRequired() && livemode === false) {
    console.error('createInvoiceCheckoutSession: Stripe returned a test session on production');
    return null;
  }
  return { url: data.url as string, sessionId: data.id as string, livemode };
}
