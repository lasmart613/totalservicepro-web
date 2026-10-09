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
 * stores stripe_customers.stripe_customer_id plus subscriptions.stripe_subscription_id
 * and subscriptions.organization_id.
 * Downgrade writes is_premium/plan/subscription_tier directly. It does not
 * set or trust premium_until.
 *
 * The paid org is the subscriptions.organization_id stored for this Stripe
 * subscription. Metadata organization_id is used only when that column is
 * empty and the customer user is or was a member of that org. The payer's
 * current profile org is never the fallback. A stored org and metadata org
 * that disagree, or no anchor at all, changes nothing.
 *
 * Any active or trialing Stripe subscription still anchored to that org
 * blocks the downgrade. The check lists every anchored customer, not only
 * the customer on the event.
 */

const SUBSCRIPTION_DOWNGRADE_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

import type { SupabaseClient } from '@supabase/supabase-js';
import { isComplimentaryGrant } from '../complimentary-premium.ts';
import type { OrgPlanFields } from '../org-plan.ts';
import { loadOrgPlanRow } from '../org-plan-load.ts';
import { applyPaidSubscriptionRecord } from './apply-org-upgrade.ts';
import { ledgerStatusForStripe, writeOrgColumns } from './persist-org-upgrade.ts';
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
  userId: string | null;
};

export type AnchoredOrganization = {
  organizationId: string | null;
  reason: 'stored_subscription' | 'metadata_membership' | 'anchor_mismatch' | 'not_a_member' | 'no_stripe_link';
};

/**
 * Paid org for a downgrade. Profile organization_id is not an input.
 * Stored subscriptions.organization_id wins. Metadata is accepted only when
 * there is no stored org and the user is (or was) a member of that org.
 * Disagreement, or nothing that resolves, refuses the plan change.
 */
export function resolveAnchoredOrganization(input: {
  storedOrganizationId: string | null;
  metadataOrganizationId: string | null;
  memberOrganizationIds: ReadonlySet<string>;
  userId: string | null;
}): AnchoredOrganization {
  const stored = input.storedOrganizationId;
  const metadata = input.metadataOrganizationId;
  if (stored && metadata && stored !== metadata) {
    return { organizationId: null, reason: 'anchor_mismatch' };
  }
  if (stored) return { organizationId: stored, reason: 'stored_subscription' };
  if (metadata) {
    if (input.userId && input.memberOrganizationIds.has(metadata)) {
      return { organizationId: metadata, reason: 'metadata_membership' };
    }
    if (input.userId) return { organizationId: null, reason: 'not_a_member' };
    return { organizationId: null, reason: 'no_stripe_link' };
  }
  return { organizationId: null, reason: 'no_stripe_link' };
}

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

async function findStoredStripeLink(
  writer: SupabaseClient,
  customerId: string | null,
  subscriptionId: string | null
): Promise<StoredStripeLink> {
  let subscriptionOrgId: string | null = null;
  let userId: string | null = null;

  if (subscriptionId) {
    const { data, error } = await writer
      .from('subscriptions')
      .select('organization_id, user_id, stripe_subscription_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw new Error(error.message || 'subscription lookup failed');
    if (data?.organization_id != null && String(data.organization_id).trim() !== '') {
      subscriptionOrgId = String(data.organization_id);
    }
    if (data?.user_id) userId = String(data.user_id);
  }

  if (customerId) {
    const { data: cus, error: cusErr } = await writer
      .from('stripe_customers')
      .select('user_id, stripe_customer_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (cusErr) throw new Error(cusErr.message || 'stripe customer lookup failed');
    if (!userId && cus?.user_id) userId = String(cus.user_id);
  }

  return { subscriptionOrgId, userId };
}

async function memberOrganizationIds(writer: SupabaseClient, userId: string | null): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!userId) return ids;
  const { data, error } = await writer
    .from('organization_memberships')
    .select('organization_id, user_id')
    .eq('user_id', userId);
  if (error) throw new Error(error.message || 'membership lookup failed');
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (row?.organization_id != null && String(row.organization_id).trim() !== '') {
      ids.add(String(row.organization_id));
    }
  }
  return ids;
}

type OrgStripeAnchors = {
  customerIds: string[];
  subscriptionIds: string[];
};

/** Stripe customers and subscription ids tied to this org, including member payers. */
async function orgStripeAnchors(
  writer: SupabaseClient,
  organizationId: string,
  eventCustomerId: string | null
): Promise<OrgStripeAnchors> {
  const customerIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  const userIds = new Set<string>();
  if (eventCustomerId) customerIds.add(eventCustomerId);

  const { data: subs, error: subErr } = await writer
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, organization_id, platform')
    .eq('organization_id', organizationId);
  if (subErr) throw new Error(subErr.message || 'subscription anchor lookup failed');
  for (const row of Array.isArray(subs) ? subs : []) {
    if (row?.user_id) userIds.add(String(row.user_id));
    const subId = row?.stripe_subscription_id != null ? String(row.stripe_subscription_id).trim() : '';
    if (subId.startsWith('sub_')) subscriptionIds.add(subId);
  }

  const { data: members, error: memErr } = await writer
    .from('organization_memberships')
    .select('user_id, organization_id')
    .eq('organization_id', organizationId);
  if (memErr) throw new Error(memErr.message || 'membership anchor lookup failed');
  for (const row of Array.isArray(members) ? members : []) {
    if (row?.user_id) userIds.add(String(row.user_id));
  }

  for (const userId of userIds) {
    const { data: cus, error } = await writer
      .from('stripe_customers')
      .select('stripe_customer_id, user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message || 'stripe customer lookup failed');
    const customerId = cus?.stripe_customer_id != null ? String(cus.stripe_customer_id).trim() : '';
    if (customerId.startsWith('cus_')) customerIds.add(customerId);
  }

  return { customerIds: [...customerIds], subscriptionIds: [...subscriptionIds] };
}

async function writeSubscriptionLedgerStatus(
  writer: SupabaseClient,
  subscriptionId: string,
  stripeStatus: string,
  opts?: { clearTier?: boolean }
): Promise<void> {
  const status = ledgerStatusForStripe(stripeStatus);
  if (!status) {
    console.error('[billing] subscription ledger status not written; Stripe status is not mapped', {
      subscriptionId,
      stripeStatus,
    });
    return;
  }
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (opts?.clearTier) patch.tier = 'free';
  const { error } = await writer.from('subscriptions').update(patch).eq('stripe_subscription_id', subscriptionId);
  if (error) {
    console.error('[billing] subscription ledger status update failed', {
      message: error.message,
      subscriptionId,
      status,
    });
    throw new Error(error.message || 'subscription ledger status update failed');
  }
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
  const members = await memberOrganizationIds(input.writer, stored.userId);
  const anchored = resolveAnchoredOrganization({
    storedOrganizationId: stored.subscriptionOrgId,
    metadataOrganizationId: metadataOrg,
    memberOrganizationIds: members,
    userId: stored.userId,
  });
  if (!anchored.organizationId) {
    return { organizationId: null, subscriptionId, customerId, reason: anchored.reason };
  }
  return { organizationId: anchored.organizationId, subscriptionId, customerId };
}

function attemptCountFromInvoice(invoice: Record<string, unknown> | null): number | null {
  const raw = invoice?.attempt_count;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export async function applyStripePremiumDowngrade(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveSubscription?: (subscriptionId: string) => Promise<StripeObject>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
}): Promise<{ downgraded: boolean; organizationId?: string | null; reason?: string }> {
  const subscription = input.subscription;
  const linked = await lookupStripeOrganization({
    writer: input.writer,
    subscription,
    retrieveCustomer: input.retrieveCustomer,
  });
  if (!linked.organizationId || !linked.customerId) {
    console.error('[billing] refusing org plan change; subscription is not anchored', {
      reason: linked.reason || 'no_stripe_link',
      subscriptionId: linked.subscriptionId,
      customerId: linked.customerId,
    });
    return { downgraded: false, reason: linked.reason || 'no_stripe_link' };
  }
  const organizationId = linked.organizationId;

  const org = await loadOrgPlanRow(input.writer, organizationId);
  if (!org) return { downgraded: false, reason: 'missing_org' };
  if (stripeDowngradeBlockedByComplimentary(org)) {
    return { downgraded: false, organizationId, reason: 'complimentary' };
  }

  if (await orgStillHasLiveStripeSubscription({
    writer: input.writer,
    organizationId,
    eventCustomerId: linked.customerId,
    eventSubscriptionId: linked.subscriptionId,
    listLiveSubscriptions: input.listLiveSubscriptions,
    retrieveSubscription: input.retrieveSubscription,
  })) {
    return { downgraded: false, organizationId, reason: 'live_subscription_remains' };
  }

  await writeOrgColumns(input.writer, organizationId, orgFreePlanFields());

  if (linked.subscriptionId) {
    const stripeStatus = String(subscription.status || '').toLowerCase() || 'canceled';
    await writeSubscriptionLedgerStatus(input.writer, linked.subscriptionId, stripeStatus, { clearTier: true });
  }

  return { downgraded: true, organizationId };
}

async function orgStillHasLiveStripeSubscription(input: {
  writer: SupabaseClient;
  organizationId: string;
  eventCustomerId: string;
  eventSubscriptionId: string | null;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveSubscription?: (subscriptionId: string) => Promise<StripeObject>;
}): Promise<boolean> {
  const anchors = await orgStripeAnchors(input.writer, input.organizationId, input.eventCustomerId);
  const seenLive = new Set<string>();
  for (const customerId of anchors.customerIds) {
    const live = await input.listLiveSubscriptions(customerId);
    for (const sub of live || []) {
      if (!subscriptionGrantsPremium(sub?.status)) continue;
      const id = String(sub?.id || '').trim();
      if (id) seenLive.add(id);
    }
    if (liveSubscriptionRemains(live)) return true;
  }

  if (!input.retrieveSubscription) return false;
  for (const subscriptionId of anchors.subscriptionIds) {
    if (!subscriptionId || subscriptionId === input.eventSubscriptionId || seenLive.has(subscriptionId)) continue;
    const other = await input.retrieveSubscription(subscriptionId);
    if (subscriptionGrantsPremium(typeof other?.status === 'string' ? other.status : null)) return true;
  }
  return false;
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
  if (!deleted && !ended) {
    if (ledgerStatusForStripe(status) === 'grace_period' && subId) {
      await writeSubscriptionLedgerStatus(input.writer, subId, status);
    }
    return keptPremium(status || 'unknown');
  }

  const result = await applyStripePremiumDowngrade({
    writer: input.writer,
    subscription,
    listLiveSubscriptions: input.listLiveSubscriptions,
    retrieveSubscription: input.retrieveSubscription,
    retrieveCustomer: input.retrieveCustomer,
  });
  return downgradeBody(result);
}
