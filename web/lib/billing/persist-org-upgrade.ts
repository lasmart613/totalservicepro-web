/**
 * Write paid flags onto an EXISTING organization. Never inserts an org or user.
 * Idempotent: re-applying the same plan updates the same row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlanOffer } from './plan-catalog.ts';
import { orgUpgradeFields } from './upgrade-session.ts';

/** subscriptions.status CHECK: active, expired, cancelled, grace_period. */
export type LedgerSubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'grace_period';

/** subscriptions.subscription_type CHECK: monthly, yearly, lifetime. */
export type LedgerSubscriptionType = 'monthly' | 'yearly';

/**
 * Map a Stripe subscription status onto the live subscriptions.status check.
 * active and trialing are a live paid plan. canceled uses the British spelling
 * the check allows. unpaid and incomplete_expired are over. past_due is the
 * grace window and does not by itself change the org plan.
 */
export function ledgerStatusForStripe(status: string | null | undefined): LedgerSubscriptionStatus | null {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'active' || value === 'trialing') return 'active';
  if (value === 'canceled' || value === 'cancelled') return 'cancelled';
  if (value === 'unpaid' || value === 'incomplete_expired') return 'expired';
  if (value === 'past_due') return 'grace_period';
  return null;
}

/** Price recurring.interval month/year → the subscription_type check values. */
export function subscriptionTypeFromRecurringInterval(
  interval: string | null | undefined
): LedgerSubscriptionType | null {
  const value = String(interval || '').trim().toLowerCase();
  if (value === 'month' || value === 'monthly') return 'monthly';
  if (value === 'year' || value === 'yearly' || value === 'annual') return 'yearly';
  return null;
}

type StripePriceAnchor = {
  priceId: string | null;
  productId: string | null;
  interval: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function productIdOf(product: unknown): string | null {
  if (typeof product === 'string' && product.startsWith('prod_')) return product;
  const record = asRecord(product);
  const id = record && typeof record.id === 'string' ? record.id : '';
  return id.startsWith('prod_') ? id : null;
}

/** Price id, product id, and recurring interval from a Subscription or Checkout Session. */
export function readStripePriceAnchor(record: unknown): StripePriceAnchor {
  const root = asRecord(record);
  const items: unknown[] = [];
  for (const key of ['items', 'line_items']) {
    const list = asRecord(root?.[key]);
    if (Array.isArray(list?.data)) items.push(...list.data);
  }
  const legacyPlan = asRecord(root?.plan);
  if (legacyPlan) items.push({ price: legacyPlan });

  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const price = asRecord(row.price) || asRecord(row.plan);
    if (!price) continue;
    const recurring = asRecord(price.recurring);
    const interval =
      (typeof recurring?.interval === 'string' && recurring.interval) ||
      (typeof price.interval === 'string' && price.interval) ||
      null;
    const priceId = typeof price.id === 'string' && price.id.startsWith('price_') ? price.id : null;
    const productId = productIdOf(price.product);
    if (priceId || productId || interval) return { priceId, productId, interval };
  }
  return { priceId: null, productId: null, interval: null };
}

type SupabaseError = { message?: string; code?: string } | null | undefined;

function logSupabaseWriteError(scope: string, error: SupabaseError, extra?: Record<string, unknown>): void {
  console.error(`[billing] ${scope}`, {
    message: error?.message || null,
    code: error?.code || null,
    ...extra,
  });
}

function throwIfSupabaseError(scope: string, error: SupabaseError, extra?: Record<string, unknown>): void {
  if (!error) return;
  logSupabaseWriteError(scope, error, extra);
  throw new Error(error.message || scope);
}

function isOtherBillingPlatform(platform: unknown): boolean {
  const value = String(platform || '').trim().toLowerCase();
  return value !== '' && value !== 'stripe';
}

export function missingOrgColumn(message?: string): string | null {
  return message?.match(/Could not find the '([^']+)' column/i)?.[1] || null;
}

export async function writeOrgColumns(
  client: SupabaseClient,
  orgId: string,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    ...fields,
    updated_at: fields.updated_at || new Date().toISOString(),
  };
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await client
      .from('organizations')
      .update(payload)
      .eq('id', orgId)
      .select('id')
      .maybeSingle();
    if (!error && data?.id != null) return { ...data, ...payload };
    lastError = error;
    const col = missingOrgColumn(error?.message);
    if (col && col in payload) {
      delete payload[col];
      continue;
    }
    break;
  }
  throw new Error(lastError?.message || 'Could not update the organization plan');
}

export async function writeOrgUpgrade(
  client: SupabaseClient,
  orgId: string,
  plan: string
): Promise<Record<string, unknown>> {
  return writeOrgColumns(client, orgId, orgUpgradeFields(plan));
}

export async function persistPaidOrgUpgrade(input: {
  writer: SupabaseClient;
  organizationId: string;
  userId?: string | null;
  userEmail?: string | null;
  plan: string;
  sku?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  /** Stripe subscription status. trialing is stored as active. */
  stripeStatus?: string | null;
  /** Subscription or Checkout Session, used for price id, product id, and interval. */
  stripeRecord?: unknown;
}): Promise<{ org: Record<string, unknown>; priorSubscriptionId: string | null }> {
  const orgId = String(input.organizationId || '').trim();
  if (!orgId) throw new Error('organization_id is required');

  let priorSubscriptionId: string | null = null;
  const userId = String(input.userId || '').trim() || null;
  if (userId) {
    const { data: priorSub, error: priorErr } = await input.writer
      .from('subscriptions')
      .select('stripe_subscription_id, platform')
      .eq('user_id', userId)
      .maybeSingle();
    throwIfSupabaseError('subscription lookup failed', priorErr, { userId });
    if (!isOtherBillingPlatform(priorSub?.platform)) {
      priorSubscriptionId =
        priorSub?.stripe_subscription_id != null ? String(priorSub.stripe_subscription_id) : null;
    }
  }

  const org = await writeOrgUpgrade(input.writer, orgId, input.plan);

  if (userId && input.customerId) {
    const { data: existing, error: readErr } = await input.writer
      .from('stripe_customers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    throwIfSupabaseError('stripe customer lookup failed', readErr, { userId });
    if (existing?.id) {
      const { error } = await input.writer
        .from('stripe_customers')
        .update({ stripe_customer_id: input.customerId, email: input.userEmail || null })
        .eq('id', existing.id);
      throwIfSupabaseError('stripe customer update failed', error, { userId });
    } else {
      const { error } = await input.writer.from('stripe_customers').insert({
        user_id: userId,
        stripe_customer_id: input.customerId,
        email: input.userEmail || null,
      });
      throwIfSupabaseError('stripe customer insert failed', error, { userId });
    }
  }

  if (userId) {
    await writeStripeSubscriptionLedger({
      writer: input.writer,
      userId,
      organizationId: orgId,
      plan: input.plan,
      sku: input.sku || null,
      subscriptionId: input.subscriptionId || null,
      stripeStatus: input.stripeStatus || null,
      stripeRecord: input.stripeRecord,
    });
  }

  return { org, priorSubscriptionId };
}

/**
 * One subscriptions row per user. Upsert the Stripe row by stripe_subscription_id.
 * A Google Play or manual row is left as-is: the org anchor is subscription metadata.
 */
async function writeStripeSubscriptionLedger(input: {
  writer: SupabaseClient;
  userId: string;
  organizationId: string;
  plan: string;
  sku: string | null;
  subscriptionId: string | null;
  stripeStatus: string | null;
  stripeRecord?: unknown;
}): Promise<void> {
  const price = readStripePriceAnchor(input.stripeRecord);
  const offer = input.sku ? getPlanOffer(input.sku) : null;
  const subscriptionType = subscriptionTypeFromRecurringInterval(price.interval || offer?.interval || null);
  if (!subscriptionType) {
    logSupabaseWriteError(
      'subscription ledger skipped; price interval is not monthly or yearly',
      { message: 'missing recurring interval' },
      { userId: input.userId, sku: input.sku, subscriptionId: input.subscriptionId }
    );
    throw new Error('subscription price interval is required');
  }

  const ledgerStatus = ledgerStatusForStripe(input.stripeStatus || 'active');
  if (!ledgerStatus) {
    logSupabaseWriteError(
      'subscription ledger skipped; Stripe status is not mapped',
      { message: 'unmapped status' },
      { userId: input.userId, stripeStatus: input.stripeStatus }
    );
    throw new Error('subscription status is not mapped');
  }

  const orgId = input.organizationId;
  const subRow: Record<string, unknown> = {
    user_id: input.userId,
    organization_id: Number.isFinite(Number(orgId)) ? Number(orgId) : orgId,
    tier: input.plan,
    status: ledgerStatus,
    sku: input.sku,
    platform: 'stripe',
    subscription_type: subscriptionType,
    package_name: input.plan,
    stripe_subscription_id: input.subscriptionId,
    stripe_price_id: price.priceId,
    stripe_product_id: price.productId,
    updated_at: new Date().toISOString(),
  };

  const byStripe = input.subscriptionId
    ? await input.writer
        .from('subscriptions')
        .select('id, user_id, platform, stripe_subscription_id')
        .eq('stripe_subscription_id', input.subscriptionId)
        .maybeSingle()
    : { data: null, error: null };
  throwIfSupabaseError('subscription lookup by stripe id failed', byStripe.error, {
    subscriptionId: input.subscriptionId,
  });

  const byUser = await input.writer
    .from('subscriptions')
    .select('id, user_id, platform, stripe_subscription_id')
    .eq('user_id', input.userId)
    .maybeSingle();
  throwIfSupabaseError('subscription lookup by user failed', byUser.error, { userId: input.userId });

  const stripeRow = byStripe.data;
  const userRow = byUser.data;
  if (stripeRow?.user_id && String(stripeRow.user_id) !== input.userId) {
    console.error('[billing] subscription ledger left unchanged; stripe subscription belongs to another user', {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      rowUserId: stripeRow.user_id,
    });
    return;
  }

  const otherPlatform = isOtherBillingPlatform(userRow?.platform);
  const sameStripeRow =
    stripeRow?.id != null && userRow?.id != null && String(stripeRow.id) === String(userRow.id);
  if (otherPlatform && !sameStripeRow) {
    console.error('[billing] subscription ledger left unchanged; user already has a non-Stripe row', {
      userId: input.userId,
      platform: userRow?.platform,
      organizationId: orgId,
      stripeSubscriptionId: input.subscriptionId,
    });
    return;
  }

  const targetId = stripeRow?.id ?? userRow?.id;
  if (targetId != null) {
    const { error } = await input.writer.from('subscriptions').update(subRow).eq('id', targetId);
    throwIfSupabaseError('subscription ledger update failed', error, {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
    });
    return;
  }

  const { error } = await input.writer.from('subscriptions').insert(subRow);
  throwIfSupabaseError('subscription ledger insert failed', error, {
    userId: input.userId,
    subscriptionId: input.subscriptionId,
  });
}
