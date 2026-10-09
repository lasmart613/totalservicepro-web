/**
 * Seller card-payment routing.
 *
 * STRIPE_CONNECT_ENFORCE defaults off. An unconnected company then keeps
 * today's platform charge: no transfer_data, application fee, or on_behalf_of.
 * A charges-enabled connected account uses a destination charge. Exempt orgs
 * (STRIPE_CONNECT_EXEMPT_ORG_IDS, default 4) always stay on the platform
 * charge. Missing Stripe columns fall back to that same platform charge.
 * With enforce on, an unconnected non-exempt org is refused.
 * If charges are enabled but bank payouts are not, the destination charge
 * still targets the connected account and the order is marked held.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isOwnerOrgType } from '../org-types.ts';
import { PRODUCTION_SITE_ORIGIN } from '../site-origin.ts';
import { safeRedirectPath } from '../safe-redirect.ts';
import { checkoutLooksLikeInvoicePay } from './apply-invoice-payment.ts';

export const STRIPE_PARTNER_REFERRAL_ENV = 'STRIPE_PARTNER_REFERRAL_URL';
export const STRIPE_PLATFORM_FEE_BPS_ENV = 'STRIPE_PLATFORM_FEE_BPS';
export const STRIPE_CONNECT_ENFORCE_ENV = 'STRIPE_CONNECT_ENFORCE';
export const STRIPE_CONNECT_EXEMPT_ORG_IDS_ENV = 'STRIPE_CONNECT_EXEMPT_ORG_IDS';
export const CONNECT_REQUIRED_CODE = 'stripe_connect_required';
export const CONNECT_PATH = '/api/billing/stripe/connect';
const DEFAULT_EXEMPT_ORG_IDS = '4';

const PARTNER_ADMIN_MESSAGE = 'Ask your platform admin for the Stripe partner signup link.';

export type PayoutStatus = 'transferred' | 'held';

export type PayoutAccount = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export type StripeConnectPrompt = {
  code: typeof CONNECT_REQUIRED_CODE;
  title: string;
  message: string;
  connectPath: typeof CONNECT_PATH;
  partnerUrl: string | null;
  partnerMissingMessage: string | null;
  audience: 'seller';
};

export type CardRoute =
  | {
      ok: true;
      accountId: string;
      applicationFeeCents: number;
      payoutStatus: PayoutStatus;
      fields: Record<string, string | number>;
    }
  | {
      ok: false;
      code: typeof CONNECT_REQUIRED_CODE;
      message: string;
      prompt: StripeConnectPrompt;
    };

export function emptyPayoutAccount(): PayoutAccount {
  return {
    accountId: null,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  };
}

/** Connected account ids only. Rejects blank, platform secrets, and placeholders. */
export function normalizeStripeAccountId(raw: unknown): string | null {
  const id = String(raw ?? '').trim();
  return /^acct_[A-Za-z0-9]+$/.test(id) ? id : null;
}

export function readPartnerReferralUrl(envValue: string | null | undefined): string | null {
  const raw = String(envValue ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function partnerReferralFromEnv(): string | null {
  return readPartnerReferralUrl(process.env[STRIPE_PARTNER_REFERRAL_ENV]);
}

/** Unset, empty, false, 0, and off leave enforcement off. */
export function stripeConnectEnforceEnabled(raw?: unknown): boolean {
  const value = raw === undefined ? process.env[STRIPE_CONNECT_ENFORCE_ENV] : raw;
  const token = String(value ?? '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

/** Comma-separated org ids. Unset or blank defaults to org 4. */
export function stripeConnectExemptOrgIds(raw?: unknown): Set<string> {
  const value = raw === undefined ? process.env[STRIPE_CONNECT_EXEMPT_ORG_IDS_ENV] : raw;
  const text = value == null || String(value).trim() === '' ? DEFAULT_EXEMPT_ORG_IDS : String(value);
  return new Set(
    text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

export function isStripeConnectExemptOrg(
  orgId: string | number | null | undefined,
  raw?: unknown
): boolean {
  if (orgId == null || orgId === '') return false;
  return stripeConnectExemptOrgIds(raw).has(String(orgId).trim());
}

/**
 * Basis points of the charge kept by the platform. Default 0.
 * A fee that would consume the whole charge is omitted.
 */
export function platformFeeCents(amountCents: number, bpsRaw?: unknown): number {
  const amount = Math.round(Number(amountCents) || 0);
  const raw = bpsRaw === undefined ? process.env[STRIPE_PLATFORM_FEE_BPS_ENV] : bpsRaw;
  const bps = Number(String(raw ?? '').trim() || '0');
  if (!Number.isFinite(bps) || bps <= 0 || amount < 50) return 0;
  const fee = Math.round((amount * bps) / 10000);
  if (fee <= 0 || fee >= amount) return 0;
  return fee;
}

export function sellerConnectPrompt(input: {
  partnerUrl: string | null;
  hasAccount: boolean;
  chargesEnabled: boolean;
}): StripeConnectPrompt {
  const title = input.hasAccount ? 'Finish Stripe setup' : 'Connect Stripe to take card payments';
  const message = input.chargesEnabled
    ? 'Card payments go to your connected Stripe account.'
    : input.hasAccount
      ? 'Finish Stripe setup so invoice and parts card payments reach your account. We will not charge them on the platform account.'
      : 'Connect Stripe before you take a card payment. Invoice and marketplace payments go to your Stripe account. We will not charge them on the platform account.';
  return {
    code: CONNECT_REQUIRED_CODE,
    title,
    message,
    connectPath: CONNECT_PATH,
    partnerUrl: input.partnerUrl,
    partnerMissingMessage: input.partnerUrl ? null : PARTNER_ADMIN_MESSAGE,
    audience: 'seller',
  };
}

export function buyerConnectBlockedMessage(): string {
  return 'This seller has not connected Stripe for card payments. Your card was not charged.';
}

/** Only an admin or company_admin of the org may start Connect onboarding. */
export function canStartStripeConnect(role: string | null | undefined, orgType: string | null | undefined): boolean {
  if (isOwnerOrgType(orgType)) return false;
  const r = String(role || '').toLowerCase().trim();
  return r === 'admin' || r === 'company_admin';
}

/** Card visibility matches who may start Connect: admin and company_admin only. */
export function orgTakesCardPayments(role: string | null | undefined, orgType: string | null | undefined): boolean {
  return canStartStripeConnect(role, orgType);
}

export function destinationChargeFields(input: {
  accountId: string;
  applicationFeeCents: number;
  payoutStatus: PayoutStatus;
}): Record<string, string | number> {
  const accountId = normalizeStripeAccountId(input.accountId);
  if (!accountId) {
    throw new Error('destinationChargeFields requires a connected account id');
  }
  const fields: Record<string, string | number> = {
    'payment_intent_data[transfer_data][destination]': accountId,
    'payment_intent_data[on_behalf_of]': accountId,
    'metadata[stripe_destination_account]': accountId,
    'payment_intent_data[metadata][stripe_destination_account]': accountId,
    'metadata[payout_status]': input.payoutStatus,
    'payment_intent_data[metadata][payout_status]': input.payoutStatus,
  };
  if (input.applicationFeeCents > 0) {
    fields['payment_intent_data[application_fee_amount]'] = input.applicationFeeCents;
  }
  return fields;
}

/**
 * Route a seller card payment. Never returns fields that charge only the platform.
 * chargesEnabled is required. payoutsEnabled false still uses the connected account
 * and marks the payout held until Stripe can pay their bank.
 */
export function routeSellerCardPayment(input: {
  account: PayoutAccount;
  amountCents: number;
  partnerUrl?: string | null;
}): CardRoute {
  const accountId = normalizeStripeAccountId(input.account.accountId);
  const partnerUrl = input.partnerUrl === undefined ? partnerReferralFromEnv() : input.partnerUrl;
  if (!accountId || !input.account.chargesEnabled) {
    const prompt = sellerConnectPrompt({
      partnerUrl,
      hasAccount: Boolean(accountId),
      chargesEnabled: false,
    });
    return { ok: false, code: CONNECT_REQUIRED_CODE, message: prompt.message, prompt };
  }
  const payoutStatus: PayoutStatus = input.account.payoutsEnabled ? 'transferred' : 'held';
  const applicationFeeCents = platformFeeCents(input.amountCents);
  return {
    ok: true,
    accountId,
    applicationFeeCents,
    payoutStatus,
    fields: destinationChargeFields({ accountId, applicationFeeCents, payoutStatus }),
  };
}

export type SellerChargeDecision =
  | { mode: 'legacy' }
  | {
      mode: 'destination';
      accountId: string;
      applicationFeeCents: number;
      payoutStatus: PayoutStatus;
      fields: Record<string, string | number>;
    }
  | {
      mode: 'refuse';
      code: typeof CONNECT_REQUIRED_CODE;
      message: string;
      prompt: StripeConnectPrompt;
    };

/**
 * Legacy platform charge when the columns are missing, the org is exempt,
 * or enforce is off and the seller is not charges-enabled. Destination
 * charge when a non-exempt seller can take charges. Refuse only when
 * enforce is on, the schema is ready, and that seller is not connected.
 */
export function decideSellerChargeRoute(input: {
  organizationId?: string | number | null;
  account: PayoutAccount;
  amountCents: number;
  schemaReady: boolean;
  partnerUrl?: string | null;
  enforce?: boolean;
  exemptOrgIds?: string | null;
}): SellerChargeDecision {
  const enforce = input.enforce === undefined ? stripeConnectEnforceEnabled() : input.enforce;
  if (!input.schemaReady || isStripeConnectExemptOrg(input.organizationId, input.exemptOrgIds)) {
    return { mode: 'legacy' };
  }
  const routed = routeSellerCardPayment({
    account: input.account,
    amountCents: input.amountCents,
    partnerUrl: input.partnerUrl,
  });
  if (routed.ok) {
    return {
      mode: 'destination',
      accountId: routed.accountId,
      applicationFeeCents: routed.applicationFeeCents,
      payoutStatus: routed.payoutStatus,
      fields: routed.fields,
    };
  }
  if (!enforce) return { mode: 'legacy' };
  return { mode: 'refuse', code: routed.code, message: routed.message, prompt: routed.prompt };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function checkoutMetadata(session: unknown): Record<string, string> {
  const meta = asRecord(session)?.metadata;
  const row = asRecord(meta);
  if (!row) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

export function checkoutKind(session: unknown): 'part' | 'invoice' | 'other' {
  const meta = checkoutMetadata(session);
  if (String(meta.marketplace_kind || '') === 'part') return 'part';
  const row = asRecord(session);
  if (
    checkoutLooksLikeInvoicePay({
      mode: typeof row?.mode === 'string' ? row.mode : null,
      metadata: meta,
    })
  ) {
    return 'invoice';
  }
  return 'other';
}

/** Parts checkouts are recorded. They are not plan upgrades. */
export function webhookCheckoutAction(session: unknown): 'part' | 'invoice' | 'upgrade' {
  const kind = checkoutKind(session);
  if (kind === 'part') return 'part';
  if (kind === 'invoice') return 'invoice';
  return 'upgrade';
}

export type PartOrderDraft = {
  listingId: string;
  sellerOrganizationId: string | null;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeAccountId: string | null;
  amountCents: number;
  applicationFeeCents: number;
  currency: string;
  quantity: number;
  buyerEmail: string | null;
  status: 'paid';
  payoutStatus: PayoutStatus;
};

function paymentIntentId(session: Record<string, unknown>): string | null {
  const pi = session.payment_intent;
  if (typeof pi === 'string' && pi.trim()) return pi.trim();
  const row = asRecord(pi);
  if (row && typeof row.id === 'string') return row.id;
  return null;
}

function checkoutQuantity(session: Record<string, unknown>): number {
  const lineItems = asRecord(session.line_items);
  const data = Array.isArray(lineItems?.data) ? lineItems.data : [];
  const first = asRecord(data[0]);
  const fromLine = Number(first?.quantity);
  if (Number.isFinite(fromLine) && fromLine >= 1) return Math.floor(fromLine);
  const fromMeta = Number(checkoutMetadata(session).quantity);
  if (Number.isFinite(fromMeta) && fromMeta >= 1) return Math.floor(fromMeta);
  return 1;
}

/**
 * Build the parts order for a paid Checkout session.
 * A paid part session is always an order. Missing destination is held, not dropped,
 * and is not treated as a completed transfer to the seller.
 */
export function partOrderFromCheckoutSession(
  session: unknown
): { ok: true; order: PartOrderDraft } | { ok: false; reason: string } {
  if (checkoutKind(session) !== 'part') return { ok: false, reason: 'not_part' };
  const row = asRecord(session);
  if (!row) return { ok: false, reason: 'not_part' };
  if (String(row.status || '') !== 'complete') return { ok: false, reason: 'not_complete' };
  const pay = String(row.payment_status || '');
  if (pay && pay !== 'paid' && pay !== 'no_payment_required') return { ok: false, reason: 'not_paid' };

  const meta = checkoutMetadata(row);
  const listingId = String(meta.marketplace_listing_id || '').trim();
  if (!listingId) return { ok: false, reason: 'missing_listing' };
  const sessionId = String(row.id || '').trim();
  if (!sessionId) return { ok: false, reason: 'missing_session' };
  const amountCents = Number(row.amount_total);
  if (!Number.isFinite(amountCents) || amountCents < 50) return { ok: false, reason: 'bad_amount' };

  const stripeAccountId = normalizeStripeAccountId(meta.stripe_destination_account);
  const payoutStatus: PayoutStatus =
    stripeAccountId && meta.payout_status !== 'held' ? 'transferred' : 'held';
  const orgRaw = String(meta.seller_organization_id || meta.organization_id || '').trim();
  const fee = Number(meta.application_fee_cents);
  const details = asRecord(row.customer_details);
  const email =
    String(details?.email || row.customer_email || meta.buyer_email || '').trim() || null;

  return {
    ok: true,
    order: {
      listingId,
      sellerOrganizationId: orgRaw || null,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId(row),
      stripeAccountId,
      amountCents: Math.round(amountCents),
      applicationFeeCents: Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0,
      currency: String(row.currency || 'usd').toLowerCase(),
      quantity: checkoutQuantity(row),
      buyerEmail: email,
      status: 'paid',
      payoutStatus,
    },
  };
}

export function invoicePayoutRecord(meta: Record<string, string | undefined> | null | undefined): {
  stripe_destination_account: string | null;
  payout_status: PayoutStatus;
} {
  const dest = normalizeStripeAccountId(meta?.stripe_destination_account);
  const held = !dest || meta?.payout_status === 'held';
  return {
    stripe_destination_account: dest,
    payout_status: held ? 'held' : 'transferred',
  };
}

export function listingQuantityAfterSale(
  current: number | null,
  sold: number
): { quantity: number | null; soldOut: boolean } {
  if (current == null) return { quantity: null, soldOut: false };
  const next = Math.max(0, current - Math.max(1, Math.floor(sold) || 1));
  return { quantity: next, soldOut: next === 0 };
}

const CONNECT_NEXT_EXACT = new Set([
  '/company',
  '/onboarding',
  '/marketplace/my-listings',
  '/invoices/new',
]);

export function safeConnectNext(next: string | null | undefined): string {
  const safe = safeRedirectPath(next, PRODUCTION_SITE_ORIGIN, '');
  if (!safe) return '/company';
  const path = safe.split('?')[0].split('#')[0];
  if (CONNECT_NEXT_EXACT.has(path) || path.startsWith('/marketplace/parts/')) return path;
  return '/company';
}

type ConnectState = { orgId: string; accountId: string; next: string; exp: number; userId?: string };

export function signConnectState(
  input: { orgId: string; accountId: string; next: string; userId?: string | null },
  secret: string,
  nowMs = Date.now()
): string {
  const payload: ConnectState = {
    orgId: String(input.orgId),
    accountId: String(input.accountId),
    next: safeConnectNext(input.next),
    exp: nowMs + 2 * 60 * 60 * 1000,
    ...(input.userId ? { userId: String(input.userId) } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyConnectState(token: string, secret: string, nowMs = Date.now()): ConnectState | null {
  if (!secret) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const got = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (got.length !== expBuf.length || !timingSafeEqual(got, expBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConnectState;
    if (!parsed?.orgId || !parsed.accountId || !Number.isFinite(parsed.exp) || parsed.exp < nowMs) return null;
    if (!normalizeStripeAccountId(parsed.accountId)) return null;
    return {
      orgId: String(parsed.orgId),
      accountId: String(parsed.accountId),
      next: safeConnectNext(parsed.next),
      exp: parsed.exp,
      ...(parsed.userId ? { userId: String(parsed.userId) } : {}),
    };
  } catch {
    return null;
  }
}

export type ConnectCallbackActor = {
  userId: string;
  orgId: string | number;
  role: string | null | undefined;
  orgType?: string | null;
};

/**
 * Return and refresh may save flags or mint an Account Link only for a
 * signed-in admin or company_admin of the org named in the state. When the
 * state names the user who started Connect, that same user is required.
 */
export function authorizeConnectCallback(
  state: { orgId: string; userId?: string | null },
  actor: ConnectCallbackActor | null | undefined
): { ok: true } | { ok: false; reason: 'signed_out' | 'other_org' | 'not_admin' | 'not_starter' } {
  if (!actor?.userId) return { ok: false, reason: 'signed_out' };
  if (actor.orgId == null || String(actor.orgId) !== String(state.orgId)) {
    return { ok: false, reason: 'other_org' };
  }
  if (!canStartStripeConnect(actor.role, actor.orgType)) return { ok: false, reason: 'not_admin' };
  if (state.userId && String(state.userId) !== String(actor.userId)) {
    return { ok: false, reason: 'not_starter' };
  }
  return { ok: true };
}
