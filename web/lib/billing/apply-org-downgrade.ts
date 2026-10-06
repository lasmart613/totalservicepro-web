/**
 * Turn a Stripe-paid organization back to Free when its subscription ends
 * or a renewal invoice fails.
 *
 * Complimentary and manual Premium are not Stripe subscriptions and are
 * never written here:
 * - premium_grant is complimentary_signup or complimentary_god
 *   (isComplimentaryGrant). Signup and the God grant set this with premium_until.
 * - premium_until set and no stripe_customers / subscriptions row for the
 *   event's customer or subscription. That is the complimentary window
 *   (and any manual grant stored the same way).
 * - any other non-empty premium_grant is treated as a manual grant.
 * Paid Stripe clears premium_until and premium_grant (orgUpgradeFields) and
 * stores stripe_customers.stripe_customer_id plus subscriptions.stripe_subscription_id.
 * Downgrade writes is_premium/plan/subscription_tier directly. It does not
 * set or trust premium_until.
 *
 * A second active or trialing subscription on the same Stripe customer blocks
 * the downgrade. That check uses subscriptions.list, not webhook delivery order.
 * invoice.payment_failed excludes the subscription on that invoice, because
 * Stripe often leaves it active while the renewal is failing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isComplimentaryGrant } from '../complimentary-premium.ts';
import type { OrgPlanFields } from '../org-plan.ts';
import { loadOrgPlanRow } from '../org-plan-load.ts';
import { applyPaidSubscriptionRecord } from './apply-org-upgrade.ts';
import { writeOrgColumns } from './persist-org-upgrade.ts';
import {
  isInvoicePaymentFailed,
  isSubscriptionDeleted,
  isSubscriptionLifecycle,
  stripeWebhookObject,
  type StripeWebhookEventLike,
} from './stripe-webhook.ts';
import type { StripeObject } from './stripe-subscription.ts';
import {
  normalizeOrgId,
  orgFreePlanFields,
  subscriptionGrantsPremium,
  UPGRADE_KIND,
  type StripeSubscriptionLike,
} from './upgrade-session.ts';

export type BillingEventResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export type StoredStripeLink = {
  subscriptionOrgId: string | null;
  customerOrgId: string | null;
  organizationIds: Set<string>;
};

export function liveSubscriptionRemains(
  subscriptions: StripeSubscriptionLike[] | null | undefined,
  exceptSubscriptionId?: string | null
): boolean {
  const except = String(exceptSubscriptionId || '').trim();
  for (const sub of subscriptions || []) {
    if (!subscriptionGrantsPremium(sub?.status)) continue;
    const id = String(sub?.id || '').trim();
    if (except && id === except) continue;
    return true;
  }
  return false;
}

/**
 * True when this org must keep Premium through a Stripe downgrade event.
 * Called only after a stored Stripe customer or subscription link matched.
 * premium_until alone does not block: Stripe-paid orgs are not expired that way.
 */
export function stripeDowngradeBlockedByComplimentary(org: OrgPlanFields | null | undefined): boolean {
  if (!org) return false;
  if (isComplimentaryGrant(org.premium_grant)) return true;
  const grant = String(org.premium_grant || '').trim();
  if (grant) return true;
  return false;
}

export function subscriptionIdFromInvoice(invoice: Record<string, unknown> | null | undefined): string | null {
  if (!invoice) return null;
  const direct = invoice.subscription;
  if (typeof direct === 'string' && direct.startsWith('sub_')) return direct;
  if (direct && typeof direct === 'object') {
    const id = (direct as { id?: unknown }).id;
    if (typeof id === 'string' && id.startsWith('sub_')) return id;
  }
  const parent = invoice.parent;
  if (parent && typeof parent === 'object') {
    const details = (parent as { subscription_details?: { subscription?: unknown } }).subscription_details;
    const nested = details?.subscription;
    if (typeof nested === 'string' && nested.startsWith('sub_')) return nested;
    if (nested && typeof nested === 'object') {
      const id = (nested as { id?: unknown }).id;
      if (typeof id === 'string' && id.startsWith('sub_')) return id;
    }
  }
  return null;
}

function customerIdOf(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('cus_')) return value;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.startsWith('cus_')) return id;
  }
  return null;
}

function metadataOrgId(meta: Record<string, string | undefined> | null | undefined): string | null {
  return normalizeOrgId(meta?.organization_id);
}

/** Prefer the subscription row we stored at checkout, then a metadata org that matches a stored link. */
export function linkedOrganizationId(
  metadataOrg: string | null,
  stored: StoredStripeLink
): string | null {
  if (stored.subscriptionOrgId) return stored.subscriptionOrgId;
  if (metadataOrg && stored.organizationIds.has(metadataOrg)) return metadataOrg;
  return stored.customerOrgId;
}

async function findStoredStripeLink(
  writer: SupabaseClient,
  customerId: string | null,
  subscriptionId: string | null
): Promise<StoredStripeLink> {
  const organizationIds = new Set<string>();
  let subscriptionOrgId: string | null = null;
  let customerOrgId: string | null = null;

  if (subscriptionId) {
    const { data, error } = await writer
      .from('subscriptions')
      .select('organization_id, user_id, stripe_subscription_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw new Error(error.message || 'subscription lookup failed');
    if (data?.organization_id != null && String(data.organization_id).trim() !== '') {
      subscriptionOrgId = String(data.organization_id);
      organizationIds.add(subscriptionOrgId);
    }
  }

  if (customerId) {
    const { data: cus, error: cusErr } = await writer
      .from('stripe_customers')
      .select('user_id, stripe_customer_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (cusErr) throw new Error(cusErr.message || 'stripe customer lookup failed');
    const userId = cus?.user_id ? String(cus.user_id) : '';
    if (userId) {
      const { data: profile, error: profileErr } = await writer
        .from('user_profiles')
        .select('id, organization_id')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw new Error(profileErr.message || 'profile lookup failed');
      if (profile?.organization_id != null && String(profile.organization_id).trim() !== '') {
        customerOrgId = String(profile.organization_id);
        organizationIds.add(customerOrgId);
      }
    }
  }

  return { subscriptionOrgId, customerOrgId, organizationIds };
}

function downgradeBody(result: {
  downgraded: boolean;
  organizationId?: string | null;
  reason?: string;
}): BillingEventResult {
  if (result.downgraded && result.organizationId) {
    return {
      httpStatus: 200,
      body: {
        ok: true,
        applied: true,
        downgraded: true,
        organizationId: result.organizationId,
        plan: 'free',
      },
    };
  }
  return {
    httpStatus: 200,
    body: { ok: true, ignored: result.reason || 'not_downgraded' },
  };
}

export async function applyStripePremiumDowngrade(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
  /**
   * invoice.payment_failed sets this to the invoice's subscription id.
   * That subscription may still be active while the renewal fails, so it
   * must not count as "another" live subscription.
   */
  excludeSubscriptionId?: string | null;
}): Promise<{ downgraded: boolean; organizationId?: string | null; reason?: string }> {
  const subscription = input.subscription;
  const meta = subscription.metadata || {};
  if (meta.kind && meta.kind !== UPGRADE_KIND) {
    return { downgraded: false, reason: 'wrong_kind' };
  }

  const customerId = customerIdOf(subscription.customer);
  if (!customerId) return { downgraded: false, reason: 'missing_customer' };

  let metadataOrg = metadataOrgId(meta);
  if (!metadataOrg && input.retrieveCustomer) {
    try {
      const customer = await input.retrieveCustomer(customerId);
      const customerMeta = (customer?.metadata || {}) as Record<string, string | undefined>;
      metadataOrg = metadataOrgId(customerMeta);
    } catch (err) {
      console.warn('[billing] customer metadata lookup skipped', err);
    }
  }

  const subscriptionId =
    typeof subscription.id === 'string' && subscription.id.startsWith('sub_') ? subscription.id : null;
  const stored = await findStoredStripeLink(input.writer, customerId, subscriptionId);
  const organizationId = linkedOrganizationId(metadataOrg, stored);
  if (!organizationId) return { downgraded: false, reason: 'no_stripe_link' };

  const org = await loadOrgPlanRow(input.writer, organizationId);
  if (!org) return { downgraded: false, reason: 'missing_org' };
  if (stripeDowngradeBlockedByComplimentary(org)) {
    return { downgraded: false, organizationId, reason: 'complimentary' };
  }

  const live = await input.listLiveSubscriptions(customerId);
  if (liveSubscriptionRemains(live, input.excludeSubscriptionId)) {
    return { downgraded: false, organizationId, reason: 'live_subscription_remains' };
  }

  await writeOrgColumns(input.writer, organizationId, orgFreePlanFields());

  if (subscriptionId) {
    const stripeStatus = String(subscription.status || '').toLowerCase();
    const ledgerStatus =
      input.excludeSubscriptionId && subscriptionGrantsPremium(stripeStatus)
        ? 'past_due'
        : stripeStatus || 'canceled';
    try {
      await input.writer
        .from('subscriptions')
        .update({
          status: ledgerStatus,
          tier: 'free',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId)
        .select('id')
        .maybeSingle();
    } catch (err) {
      console.warn('[billing] subscription ledger downgrade skipped', err);
    }
  }

  return { downgraded: true, organizationId };
}

/**
 * customer.subscription.created/updated/deleted and invoice.payment_failed.
 * Active and trialing still upgrade. Anything else, and a failed renewal
 * invoice, downgrade unless another live subscription remains.
 */
export async function applyBillingSubscriptionEvent(input: {
  writer: SupabaseClient;
  event: StripeWebhookEventLike;
  retrieveSubscription: (subscriptionId: string) => Promise<StripeObject>;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
}): Promise<BillingEventResult> {
  if (isInvoicePaymentFailed(input.event.type)) {
    const invoice = stripeWebhookObject(input.event);
    const subId = subscriptionIdFromInvoice(invoice);
    if (!subId) return { httpStatus: 200, body: { ok: true, ignored: 'not_subscription_invoice' } };
    const subscription = await input.retrieveSubscription(subId);
    if (!customerIdOf(subscription.customer) && invoice) {
      const fromInvoice = customerIdOf(invoice.customer);
      if (fromInvoice) subscription.customer = fromInvoice;
    }
    const result = await applyStripePremiumDowngrade({
      writer: input.writer,
      subscription,
      listLiveSubscriptions: input.listLiveSubscriptions,
      retrieveCustomer: input.retrieveCustomer,
      excludeSubscriptionId: subId,
    });
    return downgradeBody(result);
  }

  if (!isSubscriptionLifecycle(input.event.type) && !isSubscriptionDeleted(input.event.type)) {
    return { httpStatus: 200, body: { ok: true, ignored: input.event.type || 'unknown_event' } };
  }

  const obj = stripeWebhookObject(input.event);
  const subId = obj && typeof obj.id === 'string' ? obj.id : '';
  if (!subId) return { httpStatus: 200, body: { ok: true, ignored: 'missing_subscription_id' } };
  const subscription = await input.retrieveSubscription(subId);

  if (subscriptionGrantsPremium(typeof subscription.status === 'string' ? subscription.status : null)) {
    const result = await applyPaidSubscriptionRecord({
      writer: input.writer,
      subscription,
    });
    if (!result.ok) return { httpStatus: 200, body: { ok: true, ignored: result.reason } };
    return {
      httpStatus: 200,
      body: {
        ok: true,
        applied: true,
        organizationId: result.applied.organizationId,
        plan: result.applied.plan,
      },
    };
  }

  const result = await applyStripePremiumDowngrade({
    writer: input.writer,
    subscription,
    listLiveSubscriptions: input.listLiveSubscriptions,
    retrieveCustomer: input.retrieveCustomer,
  });
  return downgradeBody(result);
}
