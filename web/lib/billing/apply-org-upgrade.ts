/**
 * Apply a real paid Stripe Checkout session (or active subscription) to
 * the existing organization. Idempotent. Never creates a second account.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlanOffer } from './plan-catalog.ts';
import { persistPaidOrgUpgrade } from './persist-org-upgrade.ts';
import {
  buildUpgradeReceipt,
  evaluateUpgradeSession,
  parsePaidSubscriptionRecord,
  parsePaidUpgradeSession,
  type StripeCheckoutLike,
  type StripeSubscriptionLike,
  type UpgradeSessionOwner,
} from './upgrade-session.ts';
import {
  cancelStripeSubscription,
  stripeCustomerIdFromSession,
  stripeSubscriptionIdFromSession,
  type StripeObject,
} from './stripe-subscription.ts';

export type AppliedOrgUpgrade = {
  organizationId: string;
  plan: string;
  sku: string | null;
  org: Record<string, unknown>;
  receipt: ReturnType<typeof buildUpgradeReceipt>;
};

async function maybeCancelPrior(
  plan: string,
  priorSubscriptionId: string | null,
  subscriptionId: string | null
): Promise<void> {
  if (plan !== 'team' || !priorSubscriptionId || !subscriptionId) return;
  if (priorSubscriptionId === subscriptionId) return;
  try {
    await cancelStripeSubscription(priorSubscriptionId);
  } catch (cancelErr) {
    console.warn('[billing] prior subscription cancel skipped', cancelErr);
  }
}

export async function applyPaidCheckoutSession(input: {
  writer: SupabaseClient;
  session: StripeCheckoutLike & StripeObject;
  expectedOwner?: UpgradeSessionOwner | null;
  allowMissingUser?: boolean;
  allowMissingOrg?: boolean;
  userEmail?: string | null;
}): Promise<{ ok: true; applied: AppliedOrgUpgrade } | { ok: false; reason: string }> {
  const parsed = input.expectedOwner
    ? evaluateUpgradeSession(input.session, input.expectedOwner, {
        allowMissingUser: input.allowMissingUser,
        allowMissingOrg: input.allowMissingOrg,
      })
    : parsePaidUpgradeSession(input.session);
  if (!parsed.ok) return parsed;

  const organizationId =
    ('organizationId' in parsed && parsed.organizationId) ||
    input.expectedOwner?.organizationId ||
    null;
  const userId =
    ('userId' in parsed && parsed.userId) || input.expectedOwner?.userId || null;
  if (!organizationId) return { ok: false, reason: 'missing_org' };

  const customerId = stripeCustomerIdFromSession(input.session);
  const subscriptionId = stripeSubscriptionIdFromSession(input.session);
  const { org, priorSubscriptionId } = await persistPaidOrgUpgrade({
    writer: input.writer,
    organizationId,
    userId,
    userEmail: input.userEmail || null,
    plan: parsed.plan,
    sku: parsed.sku,
    customerId,
    subscriptionId,
  });
  await maybeCancelPrior(parsed.plan, priorSubscriptionId, subscriptionId);

  const offer = parsed.sku ? getPlanOffer(parsed.sku) : null;
  const fallbackAmountLabel = offer
    ? `${offer.displayAmount} ${offer.displayPeriod}`.replace(/\s+/g, ' ').trim()
    : null;
  const receipt = buildUpgradeReceipt({
    plan: parsed.plan,
    sku: parsed.sku || parsed.plan,
    session: input.session,
    fallbackAmountLabel,
  });

  return {
    ok: true,
    applied: {
      organizationId,
      plan: parsed.plan,
      sku: parsed.sku,
      org,
      receipt,
    },
  };
}

export async function applyPaidSubscriptionRecord(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  expectedOwner?: UpgradeSessionOwner | null;
  userEmail?: string | null;
}): Promise<{ ok: true; applied: AppliedOrgUpgrade } | { ok: false; reason: string }> {
  const parsed = parsePaidSubscriptionRecord(input.subscription);
  if (!parsed.ok) return parsed;
  if (input.expectedOwner) {
    const expectedOrg = String(input.expectedOwner.organizationId || '').trim();
    const expectedUser = String(input.expectedOwner.userId || '').trim();
    if (parsed.organizationId && parsed.organizationId !== expectedOrg) {
      return { ok: false, reason: 'org_mismatch' };
    }
    if (parsed.userId && parsed.userId !== expectedUser) {
      return { ok: false, reason: 'user_mismatch' };
    }
  }
  const organizationId = parsed.organizationId || input.expectedOwner?.organizationId || null;
  const userId = parsed.userId || input.expectedOwner?.userId || null;
  if (!organizationId) return { ok: false, reason: 'missing_org' };

  const customer = input.subscription.customer;
  const customerId =
    typeof customer === 'string' && customer.startsWith('cus_')
      ? customer
      : customer && typeof customer === 'object' && typeof customer.id === 'string'
        ? customer.id
        : null;
  const subscriptionId =
    typeof input.subscription.id === 'string' && input.subscription.id.startsWith('sub_')
      ? input.subscription.id
      : null;

  const { org, priorSubscriptionId } = await persistPaidOrgUpgrade({
    writer: input.writer,
    organizationId,
    userId,
    userEmail: input.userEmail || null,
    plan: parsed.plan,
    sku: parsed.sku,
    customerId,
    subscriptionId,
  });
  await maybeCancelPrior(parsed.plan, priorSubscriptionId, subscriptionId);

  const receipt = buildUpgradeReceipt({
    plan: parsed.plan,
    sku: parsed.sku || parsed.plan,
    session: null,
  });
  return {
    ok: true,
    applied: {
      organizationId,
      plan: parsed.plan,
      sku: parsed.sku,
      org,
      receipt,
    },
  };
}
