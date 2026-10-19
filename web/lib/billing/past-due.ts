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
 * PAST_DUE_DOWNGRADE_DISABLED (1, true or yes, any case) turns both callers
 * off without a deploy (past_due then keeps Premium, the pre-000928
 * behaviour). The clock keeps running while it is on: turning it off again
 * downgrades every subscription already 14+ days past_due on the next sweep,
 * so check the candidate count first (see the PR runbook).
 *
 * Races with a recovery (QA L-1): right before the plan write the
 * subscription is re-read from Stripe and the ledger row is compare-and-set
 * on (status grace_period, the same past_due_since). Right after it Stripe is
 * read once more; if the subscription recovered in between, Premium is
 * re-applied through applyPaidSubscriptionRecord (the normal recovery path).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PAST_DUE_DOWNGRADE_DAYS = 14;
/** The sweep looks at a refused row again only after this many hours. */
export const PAST_DUE_RECHECK_HOURS = 23;
/** Same budget as the manual-index catch-up; Netlify stops scheduled functions at 30 s. */
export const PAST_DUE_SWEEP_BUDGET_MS = 18_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let disabledWarned = false;

/** Same parsing as DIRECTORY_TURNSTILE_ENABLED: 1, true or yes, any case, trimmed. */
export function pastDueDowngradeDisabled(): boolean {
  const value = String(process.env.PAST_DUE_DOWNGRADE_DISABLED ?? '').trim().toLowerCase();
  const on = value === '1' || value === 'true' || value === 'yes';
  if (on && !disabledWarned) {
    disabledWarned = true;
    console.warn(
      '[billing] PAST_DUE_DOWNGRADE_DISABLED is on: past_due subscriptions keep Premium. The 14-day clock keeps running; turning this off downgrades every subscription already 14+ days past_due on the next sweep.'
    );
  }
  return on;
}

/** Tests only: let the next pastDueDowngradeDisabled() warn again. */
export function resetPastDueDisabledWarning(): void {
  disabledWarned = false;
}

export type NetlifyDeployContextLike = { deploy?: { context?: string | null } | null } | null | undefined;

/**
 * The sweep acts only on the production deploy. "Run now" on a Deploy
 * Preview or branch deploy runs with the site's production env (same
 * Supabase, same Stripe key), so anything but production does nothing.
 * Netlify passes the deploy context to the handler (context.deploy.context);
 * CONTEXT=production is accepted as the equivalent env flag.
 */
export function isProductionDeploy(
  context?: NetlifyDeployContextLike,
  env: Record<string, string | undefined> = process.env
): boolean {
  const fromContext = String(context?.deploy?.context ?? '').trim().toLowerCase();
  if (fromContext) return fromContext === 'production';
  return String(env.CONTEXT ?? '').trim().toLowerCase() === 'production';
}

/** ISO time before which a refused row may be looked at again. */
export function pastDueRecheckCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - PAST_DUE_RECHECK_HOURS * 60 * 60 * 1000).toISOString();
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
  return /past_due_since|past_due_checked_at/i.test(String(message || ''));
}

/**
 * Compare-and-set on the ledger row: succeeds only while the row is still in
 * grace_period with exactly the clock that was read. A recovery (ledger set
 * to active, which clears the clock) or a new subscription id makes it fail.
 * fields are written only when it matches.
 */
export async function compareAndSetPastDueLedger(
  writer: SupabaseClient,
  subscriptionId: string,
  pastDueSince: string,
  fields: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await writer
    .from('subscriptions')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscriptionId)
    .eq('status', 'grace_period')
    .eq('past_due_since', pastDueSince)
    .select('stripe_subscription_id');
  if (error) throw new Error(error.message || 'past_due ledger compare-and-set failed');
  return Array.isArray(data) ? data.length > 0 : data != null;
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
