/**
 * Turn a Stripe-paid organization back to Free when the subscription is
 * actually over. A failed renewal stays on Premium for 14 days so Stripe can
 * retry.
 *
 * Downgrade on customer.subscription.deleted, and on
 * customer.subscription.updated when the retrieved status is canceled,
 * unpaid, or incomplete_expired. past_due keeps Premium until the
 * subscription has been past_due for 14 days (subscriptions.past_due_since,
 * migration 000928; see past-due.ts), then downgrades exactly like unpaid.
 * invoice.payment_failed retrieves the subscription: canceled, unpaid, or
 * incomplete_expired downgrades exactly like the events above (a backstop
 * when the updated/deleted event is missed or not subscribed); past_due
 * records the grace status and applies the same 14-day check. Any other
 * status is logged and returns 200 with no plan write. The hourly
 * past-due-downgrade scheduled function covers past_due subscriptions that
 * get no further Stripe events.
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
/** Stripe status whose 14-day clock can downgrade (past-due.ts). */
const PAST_DUE_STATUS = 'past_due';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isComplimentaryGrant } from '../complimentary-premium.ts';
import {
  compareAndSetPastDueLedger,
  pastDueDays,
  pastDueDowngradeDisabled,
  pastDueDowngradeDue,
  readPastDueSince,
} from './past-due.ts';
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
import { isStripeResourceMissing, type StripeObject } from './stripe-subscription.ts';
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

export async function writeSubscriptionLedgerStatus(
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
  /**
   * Last check right before the plan write (14-day past_due path only).
   * Returns a refusal reason to write nothing, or null to go ahead.
   */
  beforeWrite?: () => Promise<string | null>;
  /** The caller writes the ledger itself (14-day past_due path only). */
  skipLedgerWrite?: boolean;
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

  const org = await loadOrgPlanRow(input.writer as unknown as Parameters<typeof loadOrgPlanRow>[0], organizationId);
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

  if (input.beforeWrite) {
    const refused = await input.beforeWrite();
    if (refused) return { downgraded: false, organizationId, reason: refused };
  }

  await writeOrgColumns(input.writer, organizationId, orgFreePlanFields());

  if (linked.subscriptionId && !input.skipLedgerWrite) {
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

export function subscriptionStatusEndsPremium(status: unknown): boolean {
  return SUBSCRIPTION_DOWNGRADE_STATUSES.has(String(status || '').trim().toLowerCase());
}

function keptPremium(status: string, pastDue?: PastDueCheck | null): BillingEventResult {
  const body: Record<string, unknown> = { ok: true, handled: true, downgraded: false, status };
  if (pastDue) {
    body.pastDueSince = pastDue.pastDueSince;
    body.pastDueDays = pastDue.pastDueDays;
    body.pastDueKept = pastDue.reason || 'past_due_grace';
  }
  return { httpStatus: 200, body };
}

export type PastDueCheck = {
  downgraded: boolean;
  organizationId?: string | null;
  reason?: string;
  pastDueSince: string | null;
  pastDueDays: number | null;
};

function isPastDueStatus(status: unknown): boolean {
  return String(status || '').trim().toLowerCase() === PAST_DUE_STATUS;
}

/**
 * 14-day past_due rule. Call after the ledger row has been written as
 * grace_period (the 000928 trigger has then started or kept the clock).
 * Before day 14, with no stored clock, or with PAST_DUE_DOWNGRADE_DISABLED=1
 * nothing is written. From day 14 the org is downgraded through
 * applyStripePremiumDowngrade, the same path as unpaid: complimentary,
 * unanchored and still-live-elsewhere orgs are refused there.
 */
export async function applyPastDueDowngradeIfDue(input: {
  writer: SupabaseClient;
  subscription: StripeSubscriptionLike & StripeObject;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  /** Required: Stripe is re-read right before and right after the write. */
  retrieveSubscription: (subscriptionId: string) => Promise<StripeObject>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
  now?: Date;
}): Promise<PastDueCheck> {
  const subscriptionId =
    typeof input.subscription.id === 'string' && input.subscription.id.startsWith('sub_')
      ? input.subscription.id
      : null;
  const none = { pastDueSince: null, pastDueDays: null };
  if (!subscriptionId) return { downgraded: false, reason: 'missing_subscription_id', ...none };
  if (!isPastDueStatus(input.subscription.status)) return { downgraded: false, reason: 'not_past_due', ...none };
  if (pastDueDowngradeDisabled()) return { downgraded: false, reason: 'past_due_downgrade_disabled', ...none };

  const now = input.now || new Date();
  const pastDueSince = await readPastDueSince(input.writer, subscriptionId);
  const days = pastDueDays(pastDueSince, now);
  if (!pastDueSince) return { downgraded: false, reason: 'no_past_due_clock', ...none };
  if (!pastDueDowngradeDue(pastDueSince, now)) {
    return { downgraded: false, reason: 'past_due_grace', pastDueSince, pastDueDays: days };
  }

  const seenSince = pastDueSince;
  const result = await applyStripePremiumDowngrade({
    writer: input.writer,
    subscription: input.subscription,
    listLiveSubscriptions: input.listLiveSubscriptions,
    retrieveSubscription: input.retrieveSubscription,
    retrieveCustomer: input.retrieveCustomer,
    skipLedgerWrite: true,
    // L-1: last checks right before the plan write. Stripe must still say
    // past_due, and the ledger row must still be grace_period with the clock
    // read above (a recovery sets it active and clears the clock).
    beforeWrite: async () => {
      let fresh: StripeObject;
      try {
        fresh = await input.retrieveSubscription(subscriptionId);
      } catch (err) {
        if (isStripeResourceMissing(err)) return 'subscription_missing';
        throw err;
      }
      if (!isPastDueStatus(fresh?.status)) return 'stripe_status_changed';
      const still = await compareAndSetPastDueLedger(input.writer, subscriptionId, seenSince, {});
      return still ? null : 'past_due_clock_changed';
    },
  });
  if (result.downgraded) {
    // Ledger tier follows only while the row is still the same past_due
    // episode; a recovery that landed after the plan write keeps its row.
    await compareAndSetPastDueLedger(input.writer, subscriptionId, seenSince, { tier: 'free' });
    // L-1: a recovery that landed while we wrote. Stripe is read once more;
    // active or trialing re-applies Premium through the normal recovery path.
    let after: StripeObject | null = null;
    try {
      after = await input.retrieveSubscription(subscriptionId);
    } catch (err) {
      console.warn('[billing] past_due post-write Stripe check skipped', { subscriptionId, err });
    }
    if (after && subscriptionGrantsPremium(typeof after.status === 'string' ? after.status : null)) {
      const healed = await applyPaidSubscriptionRecord({
        writer: input.writer,
        subscription: after as StripeSubscriptionLike & StripeObject,
      });
      console.warn('[billing] past_due downgrade undone; the subscription recovered during the write', {
        subscriptionId,
        organizationId: result.organizationId ?? null,
        reapplied: healed.ok,
      });
      return {
        downgraded: false,
        organizationId: result.organizationId,
        reason: 'recovered_during_write',
        pastDueSince,
        pastDueDays: days,
      };
    }
  }
  console.info('[billing] past_due 14-day check', {
    subscriptionId,
    organizationId: result.organizationId ?? null,
    pastDueSince,
    pastDueDays: days,
    downgraded: result.downgraded,
    reason: result.reason ?? null,
  });
  return { ...result, pastDueSince, pastDueDays: days };
}

function pastDueDowngradeBody(check: PastDueCheck, extra: Record<string, unknown> = {}): BillingEventResult {
  const body = downgradeBody(check);
  return {
    httpStatus: body.httpStatus,
    body: {
      ...body.body,
      reason: 'past_due_14_days',
      pastDueSince: check.pastDueSince,
      pastDueDays: check.pastDueDays,
      ...extra,
    },
  };
}

/**
 * customer.subscription.created/updated/deleted and invoice.payment_failed.
 * Active and trialing still upgrade (this is also how a past_due or unpaid
 * downgrade recovers). Deleted, and updated to canceled, unpaid, or
 * incomplete_expired, downgrade unless another live subscription remains.
 * invoice.payment_failed downgrades when the retrieved subscription is
 * already canceled, unpaid, or incomplete_expired. past_due (either event)
 * records grace_period and downgrades only once it has been past_due for 14
 * days (applyPastDueDowngradeIfDue).
 */
export async function applyBillingSubscriptionEvent(input: {
  writer: SupabaseClient;
  event: StripeWebhookEventLike;
  retrieveSubscription: (subscriptionId: string) => Promise<StripeObject>;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
  /** Clock for the 14-day past_due check (tests). Defaults to the current time. */
  now?: () => Date;
}): Promise<BillingEventResult> {
  const now = input.now ? input.now() : new Date();
  if (isInvoicePaymentFailed(input.event.type)) {
    const invoice = stripeWebhookObject(input.event);
    const subId = subscriptionIdFromInvoice(invoice);
    const attemptCount = attemptCountFromInvoice(invoice);
    let organizationId: string | null = null;
    let subscriptionId: string | null = subId;
    let status: string | null = null;
    if (subId) {
      // A transient failed retrieve throws so the webhook answers non-2xx and
      // Stripe retries this event; the handler is idempotent. A permanent
      // "No such subscription" (404 resource_missing: deleted, or another
      // mode's id) is logged and answered 200 so Stripe stops retrying.
      let subscription: StripeObject;
      try {
        subscription = await input.retrieveSubscription(subId);
      } catch (err) {
        if (!isStripeResourceMissing(err)) throw err;
        console.warn('[billing] invoice.payment_failed subscription missing in Stripe', {
          subscriptionId: subId,
          attemptCount,
        });
        return {
          httpStatus: 200,
          body: {
            ok: true,
            handled: true,
            logged: true,
            downgraded: false,
            ignored: 'subscription_missing',
            subscriptionId: subId,
            attemptCount,
          },
        };
      }
      if (!customerIdOf(subscription.customer) && invoice) {
        const fromInvoice = customerIdOf(invoice.customer);
        if (fromInvoice) subscription.customer = fromInvoice;
      }
      status = typeof subscription.status === 'string' ? subscription.status : null;
      if (subscriptionStatusEndsPremium(status)) {
        // The subscription itself is already over (unpaid, canceled or
        // incomplete_expired). Same anchoring, complimentary and
        // live-subscription guards as customer.subscription.deleted.
        // past_due never reaches this branch (see the 14-day check below).
        const result = await applyStripePremiumDowngrade({
          writer: input.writer,
          subscription,
          listLiveSubscriptions: input.listLiveSubscriptions,
          retrieveSubscription: input.retrieveSubscription,
          retrieveCustomer: input.retrieveCustomer,
        });
        console.info('[billing] invoice.payment_failed', {
          organizationId: result.organizationId ?? null,
          subscriptionId: subId,
          attemptCount,
          status,
          downgraded: result.downgraded,
        });
        const body = downgradeBody(result);
        return {
          httpStatus: body.httpStatus,
          body: { ...body.body, trigger: 'invoice.payment_failed', status, subscriptionId: subId, attemptCount },
        };
      }
      try {
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
      if (isPastDueStatus(status)) {
        // past_due: record grace (starts or keeps the 000928 clock), then the
        // 14-day rule. Before day 14 this stays Premium and is only logged.
        await writeSubscriptionLedgerStatus(input.writer, subId, PAST_DUE_STATUS);
        const check = await applyPastDueDowngradeIfDue({
          writer: input.writer,
          subscription,
          listLiveSubscriptions: input.listLiveSubscriptions,
          retrieveSubscription: input.retrieveSubscription,
          retrieveCustomer: input.retrieveCustomer,
          now,
        });
        if (check.downgraded) {
          console.info('[billing] invoice.payment_failed', {
            organizationId: check.organizationId ?? null,
            subscriptionId: subId,
            attemptCount,
            status,
            downgraded: true,
          });
          return pastDueDowngradeBody(check, {
            trigger: 'invoice.payment_failed',
            status,
            subscriptionId: subId,
            attemptCount,
          });
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
            pastDueSince: check.pastDueSince,
            pastDueDays: check.pastDueDays,
            pastDueKept: check.reason || 'past_due_grace',
          },
        };
      }
    }
    // Any other status (active, trialing, incomplete): logged only.
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
      // past_due: the grace write starts (or keeps) the 000928 clock; from
      // day 14 the org is downgraded the same way as unpaid.
      await writeSubscriptionLedgerStatus(input.writer, subId, status);
      const check = await applyPastDueDowngradeIfDue({
        writer: input.writer,
        subscription,
        listLiveSubscriptions: input.listLiveSubscriptions,
        retrieveSubscription: input.retrieveSubscription,
        retrieveCustomer: input.retrieveCustomer,
        now,
      });
      if (check.downgraded) return pastDueDowngradeBody(check, { status });
      return keptPremium(status, check);
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
