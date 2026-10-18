/**
 * 14-day past_due downgrade (Larry, 2026-10-18). Replaces the old rule
 * "past_due never changes the plan".
 *
 * A Stripe subscription that has been past_due for 14 days or more is
 * downgraded to Free exactly like an unpaid one: applyStripePremiumDowngrade
 * (same anchoring, complimentary guard and live-subscription guard). Before
 * day 14 the org keeps Premium so Stripe can retry the card.
 *
 * The clock is subscriptions.past_due_since (migration 000928). A database
 * trigger sets it when a Stripe ledger row enters 'grace_period' (Stripe
 * past_due), keeps it for the whole past_due episode, and clears it when the
 * row goes back to 'active' (active or trialing). Rows that were already
 * past_due when 000928 was applied start at the apply time, never earlier.
 * No stored clock means no downgrade.
 *
 * Two callers check the clock:
 * - the Stripe webhook, on customer.subscription.updated (past_due) and on
 *   invoice.payment_failed when the retrieved subscription is past_due;
 * - the hourly Netlify scheduled function past-due-downgrade, because Stripe
 *   may send nothing after its last retry.
 *
 * Recovery is unchanged: when the subscription goes back to active or
 * trialing, customer.subscription.updated re-applies Premium through
 * applyPaidSubscriptionRecord, the same path an unpaid recovery takes.
 *
 * Complimentary Premium (premium_grant complimentary_signup / complimentary_god,
 * or any other premium_grant) has no Stripe ledger row and is refused by
 * stripeDowngradeBlockedByComplimentary even if one is linked.
 *
 * PAST_DUE_DOWNGRADE_DISABLED=1 turns both callers off without a deploy
 * (past_due then keeps Premium, the pre-000928 behaviour).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PAST_DUE_DOWNGRADE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function pastDueDowngradeDisabled(): boolean {
  return String(process.env.PAST_DUE_DOWNGRADE_DISABLED ?? '').trim() === '1';
}

function toTime(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

/** ISO time before which a past_due clock is due (now minus 14 days). */
export function pastDueCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - PAST_DUE_DOWNGRADE_DAYS * DAY_MS).toISOString();
}

/**
 * True once the subscription has been past_due for 14 full days.
 * Missing, unparseable or future clocks are never due.
 */
export function pastDueDowngradeDue(
  pastDueSince: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  const since = toTime(pastDueSince);
  if (since == null) return false;
  const nowMs = now.getTime();
  if (since > nowMs) return false;
  return nowMs - since >= PAST_DUE_DOWNGRADE_DAYS * DAY_MS;
}

/** Whole days since the clock started (for logs and webhook bodies). */
export function pastDueDays(pastDueSince: string | Date | null | undefined, now: Date = new Date()): number | null {
  const since = toTime(pastDueSince);
  if (since == null) return null;
  return Math.max(0, Math.floor((now.getTime() - since) / DAY_MS));
}

export function missingPastDueColumn(message?: string | null): boolean {
  return /past_due_since/i.test(String(message || ''));
}

/**
 * Stored past_due clock for one Stripe subscription, or null.
 * A missing column (000928 not applied yet) is logged and read as null, so
 * nothing is downgraded. Other read errors throw so the webhook is retried.
 */
export async function readPastDueSince(
  writer: SupabaseClient,
  subscriptionId: string
): Promise<string | null> {
  const { data, error } = await writer
    .from('subscriptions')
    .select('stripe_subscription_id, past_due_since')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (error) {
    if (missingPastDueColumn(error.message)) {
      console.warn('[billing] past_due clock unavailable; 000928 not applied, past_due keeps Premium', {
        subscriptionId,
      });
      return null;
    }
    throw new Error(error.message || 'past_due clock lookup failed');
  }
  const value = (data as { past_due_since?: unknown } | null)?.past_due_since;
  return typeof value === 'string' && value.trim() ? value : null;
}
