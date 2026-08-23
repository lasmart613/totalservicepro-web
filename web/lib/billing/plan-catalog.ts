/**
 * Paid plan catalog copied from the Android paywall
 * (app/src/main/assets/paywall.html PRICES + BillingManager SKUs).
 * Web checkout uses these amounts; do not invent new prices here.
 */

export const PLAN_SKUS = [
  'premium_monthly',
  'premium_annual',
  'team_monthly',
  'team_annual',
] as const;

export type PlanSku = (typeof PLAN_SKUS)[number];
export type PaidPlanId = 'premium' | 'team';
export type BillingCycle = 'monthly' | 'annual';

export type PlanOffer = {
  sku: PlanSku;
  plan: PaidPlanId;
  cycle: BillingCycle;
  /** Amount charged on the Stripe invoice (cents). */
  unitAmountCents: number;
  interval: 'month' | 'year';
  /** Android paywall display, e.g. "$9.99". */
  displayAmount: string;
  displayPeriod: string;
  /** Crossed-out monthly*12 list price on the annual toggle. */
  displayOrig: string | null;
  productName: string;
  lookupKey: PlanSku;
};

export const PLAN_OFFERS: Record<PlanSku, PlanOffer> = {
  premium_monthly: {
    sku: 'premium_monthly',
    plan: 'premium',
    cycle: 'monthly',
    unitAmountCents: 999,
    interval: 'month',
    displayAmount: '$9.99',
    displayPeriod: '/ month',
    displayOrig: null,
    productName: 'Total Service Pro Premium',
    lookupKey: 'premium_monthly',
  },
  premium_annual: {
    sku: 'premium_annual',
    plan: 'premium',
    cycle: 'annual',
    // Android shows $6.66/month billed annually → $79.92/year
    unitAmountCents: 7992,
    interval: 'year',
    displayAmount: '$6.66',
    displayPeriod: '/ month',
    displayOrig: '$119.88',
    productName: 'Total Service Pro Premium',
    lookupKey: 'premium_annual',
  },
  team_monthly: {
    sku: 'team_monthly',
    plan: 'team',
    cycle: 'monthly',
    unitAmountCents: 3999,
    interval: 'month',
    displayAmount: '$39.99',
    displayPeriod: '/ month',
    displayOrig: null,
    productName: 'Total Service Pro Team',
    lookupKey: 'team_monthly',
  },
  team_annual: {
    sku: 'team_annual',
    plan: 'team',
    cycle: 'annual',
    // Android shows $24.99/month billed annually → $299.88/year
    unitAmountCents: 29988,
    interval: 'year',
    displayAmount: '$24.99',
    displayPeriod: '/ month',
    displayOrig: '$479.88',
    productName: 'Total Service Pro Team',
    lookupKey: 'team_annual',
  },
};

export function isPlanSku(value: unknown): value is PlanSku {
  return (PLAN_SKUS as readonly string[]).includes(String(value || ''));
}

export function getPlanOffer(sku: string): PlanOffer | null {
  return isPlanSku(sku) ? PLAN_OFFERS[sku] : null;
}

export function skuFor(plan: PaidPlanId, cycle: BillingCycle): PlanSku {
  return `${plan}_${cycle}` as PlanSku;
}
