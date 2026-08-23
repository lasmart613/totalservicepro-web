/** Exact paid plan names. "pro" is the product name, not a paid enum. */
export const PAID_SUBSCRIPTION_TIERS = ['premium', 'team', 'enterprise'] as const;

export type OrgPlanFields = {
  is_premium?: boolean | null;
  subscription_tier?: string | null;
  plan?: string | null;
};

function isExactPaidName(value: unknown): boolean {
  const name = String(value || '')
    .toLowerCase()
    .trim();
  return (PAID_SUBSCRIPTION_TIERS as readonly string[]).includes(name);
}

/**
 * Paid detection from PR #22: is_premium === true OR plan/tier exactly
 * premium | team | enterprise. Do not treat "pro" as paid.
 */
export function orgIsPaid(org: OrgPlanFields | null | undefined): boolean {
  if (!org) return false;
  if (org.is_premium === true) return true;
  return isExactPaidName(org.subscription_tier) || isExactPaidName(org.plan);
}
