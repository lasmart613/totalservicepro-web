/**
 * Pure helpers for signed-in org upgrade Checkout.
 * Checkout must attach to the current org and must not create a second account.
 */

import { getPlanOffer, isPlanSku, PLAN_OFFERS, type PlanOffer, type PlanSku } from './plan-catalog.ts';
import {
  PAID_SUBSCRIPTION_TIERS,
  PREMIUM_MANUAL_SLOTS,
  TEAM_MANUAL_SLOTS,
  UNLIMITED_MANUAL_SLOTS,
} from '../org-plan.ts';

export const UPGRADE_KIND = 'org_plan';

export type UpgradeSessionOwner = {
  userId: string;
  organizationId: string;
};

export type UpgradeSessionFields = {
  mode: 'subscription';
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
  'line_items[0][price]': string;
  'line_items[0][quantity]': 1;
  'metadata[kind]': typeof UPGRADE_KIND;
  'metadata[organization_id]': string;
  'metadata[user_id]': string;
  'metadata[plan]': string;
  'metadata[sku]': PlanSku;
  'subscription_data[metadata][kind]': typeof UPGRADE_KIND;
  'subscription_data[metadata][organization_id]': string;
  'subscription_data[metadata][user_id]': string;
  'subscription_data[metadata][plan]': string;
  'subscription_data[metadata][sku]': PlanSku;
  customer?: string;
  customer_email?: string;
};

export function normalizeOrgId(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  return id === '' ? null : id;
}

export function buildUpgradeCheckoutFields(input: {
  offer: PlanOffer;
  priceId: string;
  owner: UpgradeSessionOwner;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
}): UpgradeSessionFields {
  const orgId = normalizeOrgId(input.owner.organizationId);
  const userId = String(input.owner.userId || '').trim();
  if (!orgId) throw new Error('organization_id is required to start checkout');
  if (!userId) throw new Error('user_id is required to start checkout');

  const fields: UpgradeSessionFields = {
    mode: 'subscription',
    client_reference_id: orgId,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': 1,
    'metadata[kind]': UPGRADE_KIND,
    'metadata[organization_id]': orgId,
    'metadata[user_id]': userId,
    'metadata[plan]': input.offer.plan,
    'metadata[sku]': input.offer.sku,
    'subscription_data[metadata][kind]': UPGRADE_KIND,
    'subscription_data[metadata][organization_id]': orgId,
    'subscription_data[metadata][user_id]': userId,
    'subscription_data[metadata][plan]': input.offer.plan,
    'subscription_data[metadata][sku]': input.offer.sku,
  };

  const customerId = String(input.customerId || '').trim();
  const email = String(input.customerEmail || '').trim();
  if (customerId) {
    fields.customer = customerId;
  } else if (email.includes('@')) {
    fields.customer_email = email;
  }
  return fields;
}

export type StripeCheckoutLike = {
  id?: string;
  mode?: string | null;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  created?: number | null;
  amount_total?: number | null;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string | undefined> | null;
};

export type ParsedPaidUpgrade = {
  sku: PlanSku | null;
  plan: string;
  organizationId: string | null;
  userId: string | null;
};

function exactPaidPlanName(value: unknown): string | null {
  const name = String(value || '')
    .toLowerCase()
    .trim();
  return (PAID_SUBSCRIPTION_TIERS as readonly string[]).includes(name) ? name : null;
}

function planFromMetadata(meta: Record<string, string | undefined> | null | undefined): {
  sku: PlanSku | null;
  plan: string | null;
} {
  const rawSku = meta?.sku;
  const offer = getPlanOffer(String(rawSku || ''));
  if (offer) return { sku: offer.sku, plan: offer.plan };
  const plan = exactPaidPlanName(meta?.plan);
  const sku = isPlanSku(rawSku) ? rawSku : null;
  return { sku, plan };
}

/** Identify a catalog plan from a real Stripe amount. Does not invent a charge. */
export function planFromPaidAmount(amountCents: unknown): { sku: PlanSku; plan: string } | null {
  if (typeof amountCents !== 'number' || !Number.isFinite(amountCents)) return null;
  for (const offer of Object.values(PLAN_OFFERS)) {
    if (offer.unitAmountCents === amountCents) {
      return { sku: offer.sku, plan: offer.plan };
    }
  }
  return null;
}

/**
 * A complete paid subscription Checkout session. Does not invent a plan —
 * sku/plan must be a catalog sku or exact premium|team|enterprise.
 */
export function parsePaidUpgradeSession(
  session: StripeCheckoutLike | null | undefined
): { ok: true } & ParsedPaidUpgrade | { ok: false; reason: string } {
  if (!session) return { ok: false, reason: 'missing_session' };
  if (session.mode !== 'subscription') return { ok: false, reason: 'not_subscription' };
  if (session.status !== 'complete') return { ok: false, reason: 'not_complete' };
  const pay = String(session.payment_status || '');
  if (pay && pay !== 'paid' && pay !== 'no_payment_required') {
    return { ok: false, reason: 'not_paid' };
  }

  const meta = session.metadata || {};
  if (meta.kind && meta.kind !== UPGRADE_KIND) return { ok: false, reason: 'wrong_kind' };

  let { sku, plan } = planFromMetadata(meta);
  if (!plan) {
    const fromAmount = planFromPaidAmount(session.amount_total);
    if (fromAmount) {
      sku = fromAmount.sku;
      plan = fromAmount.plan;
    }
  }
  if (!plan) return { ok: false, reason: 'unknown_sku' };

  return {
    ok: true,
    sku,
    plan,
    organizationId: normalizeOrgId(meta.organization_id) || normalizeOrgId(session.client_reference_id),
    userId: String(meta.user_id || '').trim() || null,
  };
}

export type StripeSubscriptionLike = {
  id?: string;
  status?: string | null;
  customer?: string | { id?: string } | null;
  metadata?: Record<string, string | undefined> | null;
};

const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

/** Active Stripe subscription with org-plan metadata. Does not invent a plan. */
export function parsePaidSubscriptionRecord(
  sub: StripeSubscriptionLike | null | undefined
): { ok: true } & ParsedPaidUpgrade | { ok: false; reason: string } {
  if (!sub) return { ok: false, reason: 'missing_subscription' };
  if (!LIVE_SUBSCRIPTION_STATUSES.has(String(sub.status || ''))) {
    return { ok: false, reason: 'not_active' };
  }
  const meta = sub.metadata || {};
  if (meta.kind && meta.kind !== UPGRADE_KIND) return { ok: false, reason: 'wrong_kind' };
  const { sku, plan } = planFromMetadata(meta);
  if (!plan) return { ok: false, reason: 'unknown_sku' };
  return {
    ok: true,
    sku,
    plan,
    organizationId: normalizeOrgId(meta.organization_id),
    userId: String(meta.user_id || '').trim() || null,
  };
}

export function evaluateUpgradeSession(
  session: StripeCheckoutLike | null | undefined,
  expected: UpgradeSessionOwner,
  opts?: { allowMissingUser?: boolean; allowMissingOrg?: boolean }
): { ok: true; sku: PlanSku | null; plan: string } | { ok: false; reason: string } {
  const parsed = parsePaidUpgradeSession(session);
  if (!parsed.ok) return parsed;

  const expectedOrg = normalizeOrgId(expected.organizationId);
  const expectedUser = String(expected.userId || '').trim();
  if (!expectedOrg || !expectedUser) return { ok: false, reason: 'missing_expected_owner' };
  if (parsed.organizationId) {
    if (parsed.organizationId !== expectedOrg) return { ok: false, reason: 'org_mismatch' };
  } else if (!opts?.allowMissingOrg) {
    return { ok: false, reason: 'org_mismatch' };
  }
  if (parsed.userId) {
    if (parsed.userId !== expectedUser) return { ok: false, reason: 'user_mismatch' };
  } else if (!opts?.allowMissingUser) {
    return { ok: false, reason: 'user_mismatch' };
  }

  return { ok: true, sku: parsed.sku, plan: parsed.plan };
}

export function orgUpgradeFields(plan: string): Record<string, unknown> {
  const name = String(plan || '')
    .toLowerCase()
    .trim();
  let slots = PREMIUM_MANUAL_SLOTS;
  if (name === 'team') slots = TEAM_MANUAL_SLOTS;
  if (name === 'enterprise') slots = UNLIMITED_MANUAL_SLOTS;
  return {
    is_premium: true,
    subscription_tier: name,
    plan: name,
    manual_slots: slots,
  };
}

export function planDisplayName(plan: string): string {
  const name = String(plan || '')
    .toLowerCase()
    .trim();
  if (name === 'premium') return 'Premium';
  if (name === 'team') return 'Team';
  if (name === 'enterprise') return 'Enterprise';
  return name;
}

/** Only a real https URL from Stripe — never a made-up receipt number. */
export function firstHttpsUrl(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    if (/^https:\/\//i.test(url)) return url;
  }
  return null;
}

export function formatCheckoutAmountCents(cents: unknown, currency: unknown): string | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return null;
  const cur = String(currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

type ReceiptInvoiceLike = {
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  receipt_number?: string | null;
  number?: string | null;
};

type ReceiptChargeLike = {
  receipt_url?: string | null;
};

export type StripeReceiptSessionLike = {
  amount_total?: number | null;
  currency?: string | null;
  invoice?: string | ReceiptInvoiceLike | null;
  payment_intent?:
    | string
    | {
        latest_charge?: string | ReceiptChargeLike | null;
      }
    | null;
};

export type UpgradeReceiptFields = {
  plan: string;
  planLabel: string;
  sku: string;
  amountTotalCents: number | null;
  currency: string | null;
  amountLabel: string | null;
  stripeReceiptUrl: string | null;
  existingOrganizationUpgraded: true;
};

/**
 * Build the confirmation page payload from a paid Stripe session.
 * Does not invent a receipt number. Links only if Stripe returned a URL.
 */
export function buildUpgradeReceipt(input: {
  plan: string;
  sku: string;
  session?: StripeReceiptSessionLike | null;
  fallbackAmountLabel?: string | null;
}): UpgradeReceiptFields {
  const session = input.session || {};
  const invoice = session.invoice && typeof session.invoice === 'object' ? session.invoice : null;
  const intent = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
  const charge = intent?.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;

  const amountTotalCents =
    typeof session.amount_total === 'number' && Number.isFinite(session.amount_total)
      ? session.amount_total
      : null;
  const currency = session.currency ? String(session.currency) : null;
  const amountLabel =
    formatCheckoutAmountCents(amountTotalCents, currency) || input.fallbackAmountLabel || null;

  return {
    plan: String(input.plan || '').toLowerCase().trim(),
    planLabel: planDisplayName(input.plan),
    sku: String(input.sku || ''),
    amountTotalCents,
    currency,
    amountLabel,
    stripeReceiptUrl: firstHttpsUrl(
      invoice?.hosted_invoice_url,
      charge?.receipt_url,
      invoice?.invoice_pdf
    ),
    existingOrganizationUpgraded: true,
  };
}
