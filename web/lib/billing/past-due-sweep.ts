/**
 * Hourly backstop for the 14-day past_due downgrade (see past-due.ts).
 * Stripe may send no event after its last retry, so the webhook alone would
 * leave a long-past_due subscription on Premium. Run by the Netlify scheduled
 * function netlify/functions/past-due-downgrade.mts.
 *
 * Candidates: Stripe ledger rows (platform 'stripe', id 'sub_...') in
 * 'grace_period' whose tier is not yet 'free' and whose past_due_since is at
 * least 14 days old. Each one is re-read from Stripe first:
 * - past_due: applyPastDueDowngradeIfDue (same guards as unpaid);
 * - canceled / unpaid / incomplete_expired: applyStripePremiumDowngrade,
 *   exactly as the webhook would have done;
 * - active / trialing: Stripe recovered and the webhook was missed; the
 *   ledger row is set back to 'active' (which clears the clock). The org is
 *   not downgraded and its plan is not rewritten here;
 * - missing in Stripe (404 resource_missing): skipped and logged;
 * - any other error: recorded, and the next row is tried.
 * Complimentary Premium has no Stripe ledger row, so it is never a
 * candidate, and the downgrade refuses any premium_grant org regardless.
 * No stored clock (000928 not applied) means no candidates.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyPastDueDowngradeIfDue,
  applyStripePremiumDowngrade,
  subscriptionStatusEndsPremium,
  writeSubscriptionLedgerStatus,
} from './apply-org-downgrade.ts';
import { missingPastDueColumn, pastDueCutoffIso, pastDueDowngradeDisabled, pastDueDowngradeDue } from './past-due.ts';
import { isStripeResourceMissing, type StripeObject } from './stripe-subscription.ts';
import { subscriptionGrantsPremium, type StripeSubscriptionLike } from './upgrade-session.ts';

export const PAST_DUE_SWEEP_LIMIT = 50;

export type PastDueSweepRowResult = {
  subscriptionId: string;
  organizationId: string | null;
  outcome: 'downgraded' | 'kept' | 'ledger_recovered' | 'skipped' | 'error';
  reason?: string;
  stripeStatus?: string | null;
};

export type PastDueSweepSummary = {
  ok: boolean;
  disabled?: boolean;
  skipped?: string;
  error?: string;
  candidates: number;
  downgraded: number;
  results: PastDueSweepRowResult[];
};

type LedgerRow = {
  stripe_subscription_id?: string | null;
  organization_id?: string | number | null;
  status?: string | null;
  tier?: string | null;
  platform?: string | null;
  past_due_since?: string | null;
};

function orgIdText(value: unknown): string | null {
  return value == null || String(value).trim() === '' ? null : String(value);
}

export async function runPastDueSweep(input: {
  writer: SupabaseClient;
  retrieveSubscription: (subscriptionId: string) => Promise<StripeObject>;
  listLiveSubscriptions: (customerId: string) => Promise<StripeSubscriptionLike[]>;
  retrieveCustomer?: (customerId: string) => Promise<StripeObject | null>;
  now?: Date;
  limit?: number;
}): Promise<PastDueSweepSummary> {
  const summary: PastDueSweepSummary = { ok: true, candidates: 0, downgraded: 0, results: [] };
  if (pastDueDowngradeDisabled()) return { ...summary, disabled: true };

  const now = input.now || new Date();
  const limit = Math.max(1, Math.min(input.limit ?? PAST_DUE_SWEEP_LIMIT, 200));
  const { data, error } = await input.writer
    .from('subscriptions')
    .select('stripe_subscription_id, organization_id, status, tier, platform, past_due_since')
    .eq('platform', 'stripe')
    .eq('status', 'grace_period')
    .neq('tier', 'free')
    .not('past_due_since', 'is', null)
    .lte('past_due_since', pastDueCutoffIso(now))
    .order('past_due_since', { ascending: true })
    .limit(limit);
  if (error) {
    if (missingPastDueColumn(error.message)) return { ...summary, skipped: 'past_due_clock_missing' };
    return { ...summary, ok: false, error: error.message || 'past_due candidate lookup failed' };
  }

  const rows = (Array.isArray(data) ? data : []) as LedgerRow[];
  for (const row of rows) {
    const subscriptionId = String(row.stripe_subscription_id || '').trim();
    // Re-check in code: the query is the filter, this is the guard.
    if (
      !subscriptionId.startsWith('sub_') ||
      row.platform !== 'stripe' ||
      row.status !== 'grace_period' ||
      String(row.tier || '').toLowerCase() === 'free' ||
      !pastDueDowngradeDue(row.past_due_since, now)
    ) {
      continue;
    }
    summary.candidates += 1;
    const organizationId = orgIdText(row.organization_id);
    try {
      let subscription: StripeObject;
      try {
        subscription = await input.retrieveSubscription(subscriptionId);
      } catch (err) {
        if (!isStripeResourceMissing(err)) throw err;
        summary.results.push({ subscriptionId, organizationId, outcome: 'skipped', reason: 'subscription_missing' });
        continue;
      }
      const stripeStatus = typeof subscription.status === 'string' ? subscription.status : null;

      if (stripeStatus === 'past_due') {
        const check = await applyPastDueDowngradeIfDue({
          writer: input.writer,
          subscription,
          listLiveSubscriptions: input.listLiveSubscriptions,
          retrieveSubscription: input.retrieveSubscription,
          retrieveCustomer: input.retrieveCustomer,
          now,
        });
        if (check.downgraded) summary.downgraded += 1;
        summary.results.push({
          subscriptionId,
          organizationId: check.organizationId ?? organizationId,
          outcome: check.downgraded ? 'downgraded' : 'kept',
          reason: check.downgraded ? 'past_due_14_days' : check.reason,
          stripeStatus,
        });
        continue;
      }

      if (subscriptionStatusEndsPremium(stripeStatus)) {
        const result = await applyStripePremiumDowngrade({
          writer: input.writer,
          subscription,
          listLiveSubscriptions: input.listLiveSubscriptions,
          retrieveSubscription: input.retrieveSubscription,
          retrieveCustomer: input.retrieveCustomer,
        });
        if (result.downgraded) summary.downgraded += 1;
        summary.results.push({
          subscriptionId,
          organizationId: result.organizationId ?? organizationId,
          outcome: result.downgraded ? 'downgraded' : 'kept',
          reason: result.downgraded ? `stripe_${stripeStatus}` : result.reason,
          stripeStatus,
        });
        continue;
      }

      if (subscriptionGrantsPremium(stripeStatus)) {
        await writeSubscriptionLedgerStatus(input.writer, subscriptionId, String(stripeStatus));
        summary.results.push({ subscriptionId, organizationId, outcome: 'ledger_recovered', stripeStatus });
        continue;
      }

      summary.results.push({ subscriptionId, organizationId, outcome: 'skipped', reason: 'unhandled_status', stripeStatus });
    } catch (err) {
      summary.ok = false;
      summary.results.push({
        subscriptionId,
        organizationId,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}
