/**
 * Turn a Stripe-paid organization back to Free when the subscription is
 * actually over. The first failed renewal stays on Premium so Stripe can retry.
 *
 * Downgrade only on customer.subscription.deleted, and on
 * customer.subscription.updated when the retrieved status is canceled,
 * unpaid, or incomplete_expired. past_due does not change the plan.
 * invoice.payment_failed is logged and returns 200 with no plan write.
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
 */

const SUBSCRIPTION_DOWNGRADE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

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

async function lookupStripeOrganization(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
}): Promise<{ organizationId: string | null; subscriptionId: string | null; customerId: string | null; reason?: string }> {
  const subscription = input.subscription;
  const meta = subscription.metadata || {};
  if (meta.kind && meta.kind !== UPGRADE_KIND) {
    return { organizationId: null, subscriptionId: null, customerId: null, reason: 'wrong_kind' };
  }

  const customerId = customerIdOf(subscription.customer);
  if (!customerId) return { organizationId: null, subscriptionId: null, customerId: null, reason: 'missing_customer' };

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
  if (!organizationId) {
    return { organizationId: null, subscriptionId, customerId, reason: 'no_stripe_link' };
  }
  return { organizationId, subscriptionId, customerId };
}

function attemptCountFromInvoice(invoice: Record<string, unknown> | null): number | null {
  const raw = invoice?.attempt_count;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export async function applyStripePremiumDowngrade(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
}): Promise<{ downgraded: boolean; organizationId?: string | null; reason?: string }> {
  const subscription = input.subscription;
  const linked = await lookupStripeOrganization({
    writer: input.writer,
    subscription,
    retrieveCustomer: input.retrieveCustomer,
  });
  if (!linked.organizationId || !linked.customerId) {
    return { downgraded: false, reason: linked.reason || 'no_stripe_link' };
  }
  const organizationId = linked.organizationId;

  const org = await loadOrgPlanRow(input.writer, organizationId);
  if (!org) return { downgraded: false, reason: 'missing_org' };
  if (stripeDowngradeBlockedByComplimentary(org)) {
    return { downgraded: false, organizationId, reason: 'complimentary' };
  }

  const live = await input.listLiveSubscriptions(linked.customerId);
  if (liveSubscriptionRemains(live)) {
    return { downgraded: false, organizationId, reason: 'live_subscription_remains' };
  }

  await writeOrgColumns(input.writer, organizationId, orgFreePlanFields());

  if (linked.subscriptionId) {
    const stripeStatus = String(subscription.status || '').toLowerCase();
    try {
      await input.writer
        .from('subscriptions')
        .update({
          status: stripeStatus || 'canceled',
          tier: 'free',
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', linked.subscriptionId)
        .select('id')
        .maybeSingle();
    } catch (err) {
      console.warn('[billing] subscription ledger downgrade skipped', err);
    }
  }

  return { downgraded: true, organizationId };
}

function subscriptionStatusEndsPremium(status: unknown): boolean {
  return SUBSCRIPTION_DOWNGRADE_STATUSES.has(String(status || '').trim().toLowerCase());
}

function keptPremium(status: string): BillingEventResult {
  return {
    httpStatus: 200,
    body: { ok: true, handled: true, downgraded: false, status },
  };
}

/**
 * customer.subscription.created/updated/deleted and invoice.payment_failed.
 * Active and trialing still upgrade. Deleted, and updated to canceled,
 * unpaid, or incomplete_expired, downgrade unless another live subscription
 * remains. past_due and a failed invoice do not change the plan.
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
    const attemptCount = attemptCountFromInvoice(invoice);
    let organizationId: string | null = null;
    let subscriptionId: string | null = subId;
    if (subId) {
      try {
        const subscription = await input.retrieveSubscription(subId);
        if (!customerIdOf(subscription.customer) && invoice) {
          const fromInvoice = customerIdOf(invoice.customer);
          if (fromInvoice) subscription.customer = fromInvoice;
        }
        const linked = await lookupStripeOrganization({
          writer: input.writer,
          subscription,
          retrieveCustomer: input.retrieveCustomer,
        });
        organizationId = linked.organizationId;
        subscriptionId = linked.subscriptionId || subId;
      } catch (err) {
        console.warn('[billing] invoice.payment_failed lookup skipped', err);
      }
    }
    console.info('[billing] invoice.payment_failed', {
      organizationId,
      subscriptionId,
      attemptCount,
    });
    return {
      httpStatus: 200,
      body: {
        ok: true,
        handled: true,
        logged: true,
        downgraded: false,
        organizationId,
        subscriptionId,
        attemptCount,
      },
    };
  }

  if (!isSubscriptionLifecycle(input.event.type) && !isSubscriptionDeleted(input.event.type)) {
    return { httpStatus: 200, body: { ok: true, ignored: input.event.type || 'unknown_event' } };
  }

  const obj = stripeWebhookObject(input.event);
  const subId = obj && typeof obj.id === 'string' ? obj.id : '';
  if (!subId) return { httpStatus: 200, body: { ok: true, ignored: 'missing_subscription_id' } };
  const subscription = await input.retrieveSubscription(subId);

  const status = typeof subscription.status === 'string' ? subscription.status : '';
  if (subscriptionGrantsPremium(status)) {
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

  const deleted = isSubscriptionDeleted(input.event.type);
  const ended =
    input.event.type === 'customer.subscription.updated' && subscriptionStatusEndsPremium(status);
  if (!deleted && !ended) return keptPremium(status || 'unknown');

  const result = await applyStripePremiumDowngrade({
    writer: input.writer,
    subscription,
    listLiveSubscriptions: input.listLiveSubscriptions,
    retrieveCustomer: input.retrieveCustomer,
  });
  return downgradeBody(result);
}
