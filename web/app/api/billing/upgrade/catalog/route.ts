import { NextResponse } from 'next/server';
import { formatStripeInterval, formatStripeMoney } from '@/lib/billing/plan-catalog';
import {
  listLivePlanPrices,
  StripeSubscriptionError,
} from '@/lib/billing/stripe-subscription';

export const dynamic = 'force-dynamic';

/**
 * Recurring prices that already exist on the RepairPlanet Stripe account.
 * Does not create products. Empty list means checkout must not start.
 */
export async function GET() {
  try {
    const plans = await listLivePlanPrices();
    return NextResponse.json({
      plans: plans.map((p) => ({
        ...p,
        displayAmount: formatStripeMoney(p.unitAmountCents, p.currency),
        displayPeriod: formatStripeInterval(p.interval),
      })),
    });
  } catch (e: unknown) {
    const status = e instanceof StripeSubscriptionError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Catalog failed';
    console.error('[billing/upgrade/catalog]', e);
    return NextResponse.json({ error: message, plans: [] }, { status });
  }
}
