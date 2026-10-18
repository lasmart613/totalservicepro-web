/**
 * Netlify scheduled function: the 14-day past_due downgrade backstop.
 * See web/lib/billing/past-due-sweep.ts and web/lib/billing/past-due.ts.
 *
 * Schedule: hourly at :23 (UTC cron). Netlify does not expose scheduled
 * functions at a URL in production, so this cannot be called publicly; it
 * only runs on schedule for the published deploy, or from "Run now" in the
 * Netlify UI. It runs no work in Deploy Previews unless someone presses
 * Run now there.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 * and the Stripe secret (STRIPE_SECRET_KEY or STRIPE_SECRET), all with the
 * Functions scope, and migration 000928 applied. Without the Supabase env it
 * logs an error and writes nothing; without 000928 it finds no candidates.
 * Set PAST_DUE_DOWNGRADE_DISABLED=1 to turn the 14-day downgrade off (here
 * and in the webhook) without a deploy.
 *
 * Imports are relative (no @/ alias) so the default function bundler can
 * resolve the whole module graph. No [functions] block in netlify.toml.
 */

import { createNodeServiceClient } from '../../lib/supabase/node-service-client.ts';
import { pastDueDowngradeDisabled } from '../../lib/billing/past-due.ts';
import { runPastDueSweep } from '../../lib/billing/past-due-sweep.ts';
import { listLiveSubscriptionsForCustomer, retrieveStripeSubscription } from '../../lib/billing/stripe-subscription.ts';

const pastDueDowngrade = async (): Promise<void> => {
  if (pastDueDowngradeDisabled()) {
    console.log(JSON.stringify({ event: 'past-due-downgrade', ok: true, disabled: true }));
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error(JSON.stringify({ event: 'past-due-downgrade', ok: false, error: 'missing Supabase URL or service role key' }));
    return;
  }
  // Node 20 runtime: needs the ws realtime transport (see node-service-client.ts).
  const admin = createNodeServiceClient(url, key);
  const summary = await runPastDueSweep({
    writer: admin,
    retrieveSubscription: retrieveStripeSubscription,
    listLiveSubscriptions: listLiveSubscriptionsForCustomer,
  });
  const line = JSON.stringify({ event: 'past-due-downgrade', ...summary });
  if (summary.ok) console.log(line);
  else console.error(line);
};

export default pastDueDowngrade;

export const config = {
  schedule: '23 * * * *',
};
